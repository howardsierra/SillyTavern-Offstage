const EXTENSION_KEY = 'offstage';
const ANALYZER_VERSION = '0.4.0';
const SETTINGS_BLOCK_ID = 'offstage-analyzer-settings';

let initialized = false;
let analysisInFlight = false;
let lastAutoTimer = null;
let captureBound = false;

const context = () => globalThis.SillyTavern?.getContext?.();

function uid(prefix = 'off-ai') {
    return globalThis.crypto?.randomUUID?.()
        ? `${prefix}-${globalThis.crypto.randomUUID()}`
        : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function norm(value = '') {
    return String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function clamp(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function getSettings() {
    const ctx = context();
    if (!ctx?.extensionSettings) return null;

    ctx.extensionSettings[EXTENSION_KEY] ??= { schemaVersion: 1, profiles: {}, ui: { lastTab: 'profile' } };
    const root = ctx.extensionSettings[EXTENSION_KEY];
    root.profiles ??= {};
    root.analysis ??= {};
    root.analysis.enabled ??= true;
    root.analysis.interval ??= 5;
    root.analysis.contextMessages ??= 24;
    root.analysis.updateTransient ??= true;
    root.analysis.history ??= {};
    root.analysis.lastStatus ??= 'Ready';
    return root;
}

function save() {
    context()?.saveSettingsDebounced?.();
}

function currentCharacter() {
    const ctx = context();
    if (!ctx || ctx.groupId || ctx.characterId === undefined || ctx.characterId === null) return null;
    return ctx.characters?.[ctx.characterId] ?? null;
}

function characterKey(character = currentCharacter()) {
    const ctx = context();
    if (!character) return null;
    return character.avatar || character.name || `character-${ctx?.characterId ?? 'unknown'}`;
}

function currentProfile(create = true) {
    const settings = getSettings();
    const character = currentCharacter();
    const key = characterKey(character);
    if (!settings || !key) return null;

    if (!settings.profiles[key] && create) {
        settings.profiles[key] = {
            schemaVersion: 1,
            tagline: '',
            mood: 'Unwritten',
            currentState: 'Waiting to be discovered',
            energy: 50,
            theme: 'rosewater',
            personality: { public: [], private: [], hidden: [] },
            favorites: [],
            discoveries: [],
            journal: [],
            social: [],
            playlists: [],
        };
    }

    const profile = settings.profiles[key];
    profile.personality ??= { public: [], private: [], hidden: [] };
    profile.favorites ??= [];
    profile.discoveries ??= [];
    profile.analysisMeta ??= {};
    return profile;
}

function historyKey() {
    const ctx = context();
    const key = characterKey();
    if (!ctx || !key) return null;
    return `${key}::${ctx.chatId || ctx.getCurrentChatId?.() || 'default-chat'}`;
}

function cardField(character, key) {
    return character?.[key] ?? character?.data?.[key] ?? '';
}

function clip(value, max = 5000) {
    const text = String(value ?? '').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
}

function buildCardContext(character) {
    const parts = [
        ['Description', cardField(character, 'description')],
        ['Personality', cardField(character, 'personality')],
        ['Scenario', cardField(character, 'scenario')],
        ['Example dialogue', cardField(character, 'mes_example')],
    ];
    return parts
        .filter(([, value]) => String(value ?? '').trim())
        .map(([label, value]) => `${label}:\n${clip(value, 4500)}`)
        .join('\n\n');
}

function buildTranscript(limit) {
    const ctx = context();
    const character = currentCharacter();
    const name = character?.name || 'CHARACTER';
    const messages = Array.isArray(ctx?.chat) ? ctx.chat : [];
    const usable = messages.filter(message => !message?.is_system && String(message?.mes ?? '').trim());
    const recent = usable.slice(-limit);

    let total = 0;
    const rows = [];
    for (let index = recent.length - 1; index >= 0; index--) {
        const message = recent[index];
        const role = message.is_user ? 'USER' : (message.name || name).toUpperCase();
        const text = clip(message.mes, 3500);
        const row = `${role}:\n${text}`;
        if (total + row.length > 22000 && rows.length >= 6) break;
        rows.unshift(row);
        total += row.length;
    }
    return rows.join('\n\n');
}

function buildExistingState(profile) {
    const traitRows = ['public', 'private', 'hidden'].flatMap(section =>
        (profile.personality?.[section] || []).map(item =>
            `${section}: ${item.name} (${item.provenance || 'unknown'}, ${item.value ?? 50})`
        )
    );
    const favoriteRows = (profile.favorites || []).map(item =>
        `${item.category || 'favorite'}: ${item.value || 'unknown'} (${item.provenance || 'unknown'})`
    );
    const queuedRows = (profile.discoveries || []).map(item => `${item.target || item.type || 'discovery'}: ${item.title}`);

    return [
        traitRows.length ? `Known traits:\n- ${traitRows.join('\n- ')}` : '',
        favoriteRows.length ? `Known favorites:\n- ${favoriteRows.join('\n- ')}` : '',
        queuedRows.length ? `Already queued discoveries:\n- ${queuedRows.join('\n- ')}` : '',
    ].filter(Boolean).join('\n\n');
}

function systemPrompt() {
    return `You are Offstage, a conservative character-continuity analyst for SillyTavern.
Analyze ONLY the supplied character card and recent roleplay transcript for the named character.

Your job is to maintain a living character profile without inventing facts.

Rules:
- Return JSON only. No markdown, prose, or code fences.
- Do not treat a single joke, isolated line, or one-off action as a stable personality trait.
- Prefer repeated behavioral evidence. Be conservative.
- A favorite should be explicit or strongly/repeatedly supported. Never invent a favorite just to fill a category.
- Keep suggestions setting-aware. Do not invent modern media, brands, technology, foods, or institutions in fantasy/historical settings unless the supplied material supports them.
- "canon" = explicitly stated in the character card.
- "established" = explicitly stated in roleplay.
- "inferred" = strongly suggested by repeated behavior.
- "emergent" = something that appears to have developed during this specific roleplay.
- Public/private/hidden describe how visible the trait is to others. Hidden can include a blind spot the character does not recognize.
- Transient mood/current state may change quickly and may be inferred from the most recent interaction.
- Do not overwrite known profile facts merely because the newest message differs.
- Maximum 6 durable discoveries.
- Confidence must be between 0 and 1.

Return exactly this shape:
{
  "transient": {
    "mood": "short phrase or empty string",
    "currentState": "short phrase or empty string",
    "energy": 0
  },
  "discoveries": [
    {
      "target": "trait",
      "title": "short trait name",
      "section": "public",
      "value": 0,
      "summary": "one concise sentence",
      "evidence": "specific concise evidence from supplied material",
      "provenance": "inferred",
      "confidence": 0.0
    },
    {
      "target": "favorite",
      "title": "Favorite drink",
      "section": "private",
      "category": "Drink",
      "favoriteValue": "black tea",
      "summary": "one concise sentence",
      "evidence": "specific concise evidence from supplied material",
      "provenance": "established",
      "confidence": 0.0
    }
  ]
}

Use only target "trait" or "favorite". Omit unsupported discoveries rather than guessing.`;
}

function userPrompt(character, profile, contextMessages) {
    return `CHARACTER: ${character.name || 'Unknown'}

CHARACTER CARD:
${buildCardContext(character) || '(No card details available.)'}

CURRENT OFFSTAGE STATE:
${buildExistingState(profile) || '(No accepted or queued Offstage facts yet.)'}

RECENT ROLEPLAY:
${buildTranscript(contextMessages) || '(No recent roleplay messages.)'}

Analyze this character now.`;
}

function parseJsonResponse(raw) {
    let text = String(raw ?? '').trim();
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) text = fenced[1].trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) text = text.slice(start, end + 1);
    return JSON.parse(text);
}

function sameDiscovery(a, b) {
    if ((a.target || '') !== (b.target || '')) return false;
    if (a.target === 'favorite') {
        return norm(a.category) === norm(b.category) && norm(a.favoriteValue) === norm(b.favoriteValue);
    }
    return norm(a.title) === norm(b.title);
}

function discoveryAlreadyKnown(profile, candidate) {
    if (candidate.target === 'favorite') {
        const exists = (profile.favorites || []).some(item =>
            norm(item.category) === norm(candidate.category) &&
            norm(item.value) === norm(candidate.favoriteValue)
        );
        if (exists) return true;
    } else {
        for (const section of ['public', 'private', 'hidden']) {
            if ((profile.personality?.[section] || []).some(item => norm(item.name) === norm(candidate.title))) {
                return true;
            }
        }
    }
    return (profile.discoveries || []).some(item => sameDiscovery(item, candidate));
}

function normalizeDiscovery(raw) {
    const target = raw?.target === 'favorite' ? 'favorite' : (raw?.target === 'trait' ? 'trait' : null);
    if (!target) return null;

    const provenance = ['canon', 'established', 'inferred', 'emergent'].includes(raw.provenance)
        ? raw.provenance
        : 'inferred';
    const section = ['public', 'private', 'hidden'].includes(raw.section)
        ? raw.section
        : 'private';
    const confidence = clamp(raw.confidence, 0, 1, 0);
    if (confidence < 0.65) return null;

    if (target === 'favorite') {
        const category = String(raw.category || '').trim();
        const favoriteValue = String(raw.favoriteValue || '').trim();
        if (!category || !favoriteValue) return null;
        return {
            id: uid('discovery'),
            source: 'ai-analysis',
            target,
            type: 'Favorite discovered',
            title: String(raw.title || `Favorite ${category}`).trim(),
            section,
            category,
            favoriteValue,
            summary: String(raw.summary || '').trim(),
            reason: String(raw.evidence || '').trim(),
            provenance,
            confidence,
            createdAt: Date.now(),
        };
    }

    const title = String(raw.title || '').trim();
    if (!title) return null;
    return {
        id: uid('discovery'),
        source: 'ai-analysis',
        target,
        type: section === 'hidden' ? 'Hidden trait' : 'Personality discovery',
        title,
        section,
        value: clamp(raw.value, 0, 100, 65),
        summary: String(raw.summary || '').trim(),
        reason: String(raw.evidence || '').trim(),
        provenance,
        confidence,
        createdAt: Date.now(),
    };
}

function refreshOpenOffstage() {
    const active = document.querySelector('#offstage-root.is-open .offstage-tab.is-active');
    if (active instanceof HTMLElement) {
        requestAnimationFrame(() => active.click());
    }
}

function updateStatus(text) {
    const settings = getSettings();
    if (settings) {
        settings.analysis.lastStatus = text;
        save();
    }
    const element = document.getElementById('offstage-analyzer-status');
    if (element) element.textContent = text;
}

function describeScanResult(count) {
    if (count === 0) return 'Scan complete — no new durable discoveries.';
    return `Scan complete — ${count} new ${count === 1 ? 'discovery' : 'discoveries'} queued.`;
}

async function analyzeCurrentCharacter({ manual = false } = {}) {
    if (analysisInFlight) {
        if (manual) globalThis.toastr?.info?.('Offstage is already analyzing this character.', 'Offstage');
        return false;
    }

    const ctx = context();
    const settings = getSettings();
    const character = currentCharacter();
    const profile = currentProfile();

    if (!ctx || !settings || !character || !profile) {
        if (manual) globalThis.toastr?.warning?.('Open a single-character chat first.', 'Offstage');
        updateStatus('Waiting for a single-character chat.');
        return false;
    }
    if (ctx.groupId) {
        if (manual) globalThis.toastr?.warning?.('Automatic analysis currently supports single-character chats.', 'Offstage');
        updateStatus('Group chat analysis is not enabled yet.');
        return false;
    }
    if (typeof ctx.generateRaw !== 'function') {
        globalThis.toastr?.error?.('The active SillyTavern build does not expose raw generation to Offstage.', 'Offstage');
        updateStatus('Model generation API unavailable.');
        return false;
    }
    if (!Array.isArray(ctx.chat) || ctx.chat.length < 2) {
        if (manual) globalThis.toastr?.info?.('There is not enough roleplay context to analyze yet.', 'Offstage');
        updateStatus('Not enough roleplay context yet.');
        return false;
    }

    analysisInFlight = true;
    updateStatus(`Analyzing ${character.name || 'character'}…`);
    const button = document.getElementById('offstage-analyze-now');
    if (button) {
        button.disabled = true;
        button.textContent = '✦ Analyzing…';
    }

    try {
        const raw = await ctx.generateRaw({
            prompt: userPrompt(character, profile, clamp(settings.analysis.contextMessages, 6, 80, 24)),
            systemPrompt: systemPrompt(),
            responseLength: 900,
        });
        const parsed = parseJsonResponse(raw);

        if (settings.analysis.updateTransient !== false && parsed?.transient && typeof parsed.transient === 'object') {
            const mood = String(parsed.transient.mood || '').trim();
            const currentState = String(parsed.transient.currentState || '').trim();
            const energy = Number(parsed.transient.energy);
            if (mood) profile.mood = mood.slice(0, 100);
            if (currentState) profile.currentState = currentState.slice(0, 160);
            if (Number.isFinite(energy)) profile.energy = clamp(energy, 0, 100, profile.energy ?? 50);
        }

        const candidates = Array.isArray(parsed?.discoveries)
            ? parsed.discoveries.map(normalizeDiscovery).filter(Boolean)
            : [];

        let added = 0;
        for (const candidate of candidates.slice(0, 6)) {
            if (discoveryAlreadyKnown(profile, candidate)) continue;
            profile.discoveries.push(candidate);
            added++;
        }

        const key = historyKey();
        if (key) {
            settings.analysis.history[key] = {
                lastIndex: ctx.chat.length - 1,
                lastAt: Date.now(),
                lastAdded: added,
            };
        }

        profile.analysisMeta.lastAnalyzedAt = Date.now();
        profile.analysisMeta.lastAnalyzedMessage = ctx.chat.length - 1;
        save();
        updateStatus(describeScanResult(added));
        refreshOpenOffstage();

        if (added > 0) {
            globalThis.toastr?.success?.(
                `Offstage noticed ${added} new ${added === 1 ? 'thing' : 'things'} about ${character.name}. Review the Discovery Inbox.`,
                'Offstage'
            );
        } else if (manual) {
            globalThis.toastr?.info?.('No new durable discoveries this time. Current mood/state may still have updated.', 'Offstage');
        }
        return true;
    } catch (error) {
        console.error('[Offstage Analyzer] Analysis failed:', error);
        updateStatus('Analysis failed — check your active model/API connection.');
        globalThis.toastr?.error?.('Character analysis failed. Check your model connection, then try again.', 'Offstage');
        return false;
    } finally {
        analysisInFlight = false;
        if (button) {
            button.disabled = false;
            button.textContent = '✦ Analyze current context now';
        }
    }
}

function assistantRepliesSince(lastIndex) {
    const chat = context()?.chat;
    if (!Array.isArray(chat)) return 0;
    return chat.slice(Math.max(0, Number(lastIndex) + 1)).filter(message =>
        !message?.is_user && !message?.is_system && String(message?.mes ?? '').trim()
    ).length;
}

async function maybeAutoAnalyze(messageIndex, source) {
    const settings = getSettings();
    const ctx = context();
    if (!settings?.analysis.enabled || !ctx || ctx.groupId || analysisInFlight) return;
    if (source === 'extension') return;

    const message = ctx.chat?.[messageIndex];
    if (message?.is_user || message?.is_system) return;

    const key = historyKey();
    if (!key) return;
    const state = settings.analysis.history[key] || { lastIndex: -1 };
    const required = clamp(settings.analysis.interval, 1, 50, 5);
    const count = assistantRepliesSince(state.lastIndex);

    if (count < required) {
        updateStatus(`${count}/${required} character replies until next automatic scan.`);
        return;
    }

    await analyzeCurrentCharacter({ manual: false });
}

function scheduleAutoAnalyze(messageIndex, source) {
    clearTimeout(lastAutoTimer);
    lastAutoTimer = setTimeout(() => void maybeAutoAnalyze(messageIndex, source), 1400);
}

function applyAiDiscovery(item, mode) {
    const profile = currentProfile();
    if (!profile || !item) return;

    if (item.target === 'favorite') {
        const hidden = mode === 'hidden';
        profile.favorites.push({
            id: uid('favorite'),
            category: item.category || item.title || 'Favorite',
            value: item.favoriteValue || item.title || 'Unknown',
            icon: '♡',
            provenance: item.provenance || 'inferred',
            hidden,
            revealed: !hidden,
            discovery: hidden ? Math.round((item.confidence || 0.7) * 100) : 100,
            note: item.summary || '',
            evidence: item.reason ? [item.reason] : [],
        });
    } else {
        const section = mode === 'hidden' ? 'hidden' : (item.section || 'private');
        profile.personality[section] ??= [];
        profile.personality[section].push({
            id: uid('trait'),
            name: item.title || 'Unnamed trait',
            value: clamp(item.value, 0, 100, 65),
            provenance: item.provenance || 'inferred',
            awareness: section === 'hidden' ? 'low' : 'moderate',
            note: item.summary || '',
            evidence: item.reason ? [item.reason] : [],
        });
    }

    profile.discoveries = profile.discoveries.filter(entry => entry.id !== item.id);
    save();
    refreshOpenOffstage();
}

function rejectAiDiscovery(item) {
    const profile = currentProfile();
    if (!profile || !item) return;
    profile.discoveries = profile.discoveries.filter(entry => entry.id !== item.id);
    save();
    refreshOpenOffstage();
}

function bindDiscoveryCapture() {
    if (captureBound) return;
    captureBound = true;

    document.addEventListener('click', event => {
        const button = event.target instanceof Element
            ? event.target.closest('.offstage-accept-discovery, .offstage-hide-discovery, .offstage-reject-discovery')
            : null;
        if (!(button instanceof HTMLElement)) return;

        const card = button.closest('[data-discovery-id]');
        if (!(card instanceof HTMLElement)) return;

        const profile = currentProfile(false);
        const item = profile?.discoveries?.find(entry => entry.id === card.dataset.discoveryId);
        if (!item || item.source !== 'ai-analysis') return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        if (button.classList.contains('offstage-reject-discovery')) {
            rejectAiDiscovery(item);
        } else if (button.classList.contains('offstage-hide-discovery')) {
            applyAiDiscovery(item, 'hidden');
        } else {
            applyAiDiscovery(item, 'accept');
        }
    }, true);
}

function settingsMarkup() {
    const settings = getSettings();
    const analysis = settings?.analysis || {};
    const enabled = analysis.enabled !== false ? 'checked' : '';
    const updateTransient = analysis.updateTransient !== false ? 'checked' : '';
    const interval = clamp(analysis.interval, 1, 50, 5);
    const contextMessages = clamp(analysis.contextMessages, 6, 80, 24);

    return `
        <div id="${SETTINGS_BLOCK_ID}" style="margin-top:6px;padding-top:12px;border-top:1px solid var(--SmartThemeBorderColor);">
            <div style="font-weight:700;margin-bottom:4px;">✦ AI Character Analysis</div>
            <small style="display:block;opacity:.78;margin-bottom:10px;">
                Uses your currently selected SillyTavern model to quietly scan recent RP. This consumes model/API tokens.
            </small>

            <label class="checkbox_label" for="offstage-analyzer-enabled">
                <input id="offstage-analyzer-enabled" type="checkbox" ${enabled}>
                <span>Automatically analyze the active character</span>
            </label>

            <label class="checkbox_label" for="offstage-analyzer-transient">
                <input id="offstage-analyzer-transient" type="checkbox" ${updateTransient}>
                <span>Automatically update Mood / Currently / Energy</span>
            </label>

            <div style="display:grid;grid-template-columns:1fr 92px;gap:10px;align-items:center;margin-top:9px;">
                <label for="offstage-analyzer-interval">Scan after this many character replies</label>
                <input id="offstage-analyzer-interval" class="text_pole" type="number" min="1" max="50" step="1" value="${interval}">
            </div>

            <div style="display:grid;grid-template-columns:1fr 92px;gap:10px;align-items:center;margin-top:9px;">
                <label for="offstage-analyzer-window">Recent messages sent to analyzer</label>
                <input id="offstage-analyzer-window" class="text_pole" type="number" min="6" max="80" step="1" value="${contextMessages}">
            </div>

            <button id="offstage-analyze-now" type="button" class="menu_button" style="margin-top:11px;width:100%;">
                ✦ Analyze current context now
            </button>

            <div style="margin-top:9px;padding:9px 10px;border:1px solid var(--SmartThemeBorderColor);border-radius:9px;">
                <small style="display:block;opacity:.68;">ANALYZER STATUS</small>
                <span id="offstage-analyzer-status">${String(analysis.lastStatus || 'Ready')}</span>
            </div>

            <small style="display:block;margin-top:8px;opacity:.72;">
                Durable traits and favorites go to the Discovery Inbox for approval. Transient mood/state can update automatically.
            </small>
        </div>`;
}

function mountSettings(attempt = 0) {
    if (document.getElementById(SETTINGS_BLOCK_ID)) {
        syncSettingsControls();
        return;
    }

    const host = document.querySelector('#offstage-settings-panel .inline-drawer-content .flex-container');
    if (!(host instanceof HTMLElement)) {
        if (attempt < 100) setTimeout(() => mountSettings(attempt + 1), 250);
        return;
    }

    host.insertAdjacentHTML('beforeend', settingsMarkup());

    document.getElementById('offstage-analyzer-enabled')?.addEventListener('change', event => {
        const settings = getSettings();
        if (!settings) return;
        settings.analysis.enabled = Boolean(event.target.checked);
        updateStatus(settings.analysis.enabled ? 'Automatic analysis enabled.' : 'Automatic analysis paused.');
    });

    document.getElementById('offstage-analyzer-transient')?.addEventListener('change', event => {
        const settings = getSettings();
        if (!settings) return;
        settings.analysis.updateTransient = Boolean(event.target.checked);
        save();
    });

    document.getElementById('offstage-analyzer-interval')?.addEventListener('change', event => {
        const settings = getSettings();
        if (!settings) return;
        settings.analysis.interval = clamp(event.target.value, 1, 50, 5);
        event.target.value = settings.analysis.interval;
        save();
    });

    document.getElementById('offstage-analyzer-window')?.addEventListener('change', event => {
        const settings = getSettings();
        if (!settings) return;
        settings.analysis.contextMessages = clamp(event.target.value, 6, 80, 24);
        event.target.value = settings.analysis.contextMessages;
        save();
    });

    document.getElementById('offstage-analyze-now')?.addEventListener('click', () => {
        void analyzeCurrentCharacter({ manual: true });
    });

    const versionLabel = [...document.querySelectorAll('#offstage-settings-panel small')]
        .find(element => /^Offstage v/i.test(element.textContent || ''));
    if (versionLabel) versionLabel.textContent = `Offstage v${ANALYZER_VERSION}`;

    syncSettingsControls();
}

function syncSettingsControls() {
    const settings = getSettings();
    if (!settings) return;

    const enabled = document.getElementById('offstage-analyzer-enabled');
    const transient = document.getElementById('offstage-analyzer-transient');
    const interval = document.getElementById('offstage-analyzer-interval');
    const windowInput = document.getElementById('offstage-analyzer-window');
    const status = document.getElementById('offstage-analyzer-status');

    if (enabled) enabled.checked = settings.analysis.enabled !== false;
    if (transient) transient.checked = settings.analysis.updateTransient !== false;
    if (interval) interval.value = clamp(settings.analysis.interval, 1, 50, 5);
    if (windowInput) windowInput.value = clamp(settings.analysis.contextMessages, 6, 80, 24);
    if (status) status.textContent = settings.analysis.lastStatus || 'Ready';
}

function bindEvents() {
    const ctx = context();
    const events = ctx?.eventTypes ?? ctx?.event_types;
    if (!ctx?.eventSource || !events) return false;

    if (events.MESSAGE_RECEIVED) {
        ctx.eventSource.on(events.MESSAGE_RECEIVED, (messageIndex, source) => scheduleAutoAnalyze(messageIndex, source));
    }
    if (events.CHAT_CHANGED) {
        ctx.eventSource.on(events.CHAT_CHANGED, () => {
            syncSettingsControls();
            updateStatus('Ready for this chat.');
        });
    }
    return true;
}

export function initAnalyzer() {
    if (initialized) {
        mountSettings();
        return;
    }
    initialized = true;

    getSettings();
    bindDiscoveryCapture();
    mountSettings();

    if (!bindEvents()) {
        setTimeout(() => {
            bindEvents();
            mountSettings();
        }, 1200);
    }

    console.info(`[Offstage Analyzer] v${ANALYZER_VERSION} initialized`);
}

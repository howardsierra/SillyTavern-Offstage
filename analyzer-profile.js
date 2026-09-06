const EXTENSION_KEY = 'offstage';
const ANALYZER_VERSION = '0.4.1';
const SETTINGS_BLOCK_ID = 'offstage-analyzer-settings';

let initialized = false;
let analysisInFlight = false;
let lastAutoTimer = null;
let captureBound = false;

const context = () => globalThis.SillyTavern?.getContext?.();
const clamp = (value, min, max, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};
const norm = (value = '') => String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const uid = (prefix = 'off-ai') => globalThis.crypto?.randomUUID?.()
    ? `${prefix}-${globalThis.crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

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

function save() { context()?.saveSettingsDebounced?.(); }

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
            tagline: '', mood: 'Unwritten', currentState: 'Waiting to be discovered', energy: 50,
            theme: 'rosewater', personality: { public: [], private: [], hidden: [] }, favorites: [], discoveries: [], journal: [], social: [], playlists: [],
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

function clip(value, max = 5000) {
    const text = String(value ?? '').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
}

function cardField(character, key) { return character?.[key] ?? character?.data?.[key] ?? ''; }

function buildCardContext(character) {
    return [
        ['Description', cardField(character, 'description')],
        ['Personality', cardField(character, 'personality')],
        ['Scenario', cardField(character, 'scenario')],
        ['Example dialogue', cardField(character, 'mes_example')],
    ].filter(([, v]) => String(v ?? '').trim())
      .map(([label, v]) => `${label}:\n${clip(v, 4500)}`)
      .join('\n\n');
}

function buildTranscript(limit) {
    const ctx = context();
    const character = currentCharacter();
    const name = character?.name || 'CHARACTER';
    const recent = (Array.isArray(ctx?.chat) ? ctx.chat : [])
        .filter(m => !m?.is_system && String(m?.mes ?? '').trim())
        .slice(-limit);
    let total = 0;
    const rows = [];
    for (let i = recent.length - 1; i >= 0; i--) {
        const m = recent[i];
        const role = m.is_user ? 'USER' : (m.name || name).toUpperCase();
        const row = `${role}:\n${clip(m.mes, 3500)}`;
        if (total + row.length > 22000 && rows.length >= 6) break;
        rows.unshift(row);
        total += row.length;
    }
    return rows.join('\n\n');
}

function buildExistingState(profile) {
    const traits = ['public', 'private', 'hidden'].flatMap(section =>
        (profile.personality?.[section] || []).map(x => `${section}: ${x.name} (${x.provenance || 'unknown'}, ${x.value ?? 50})`));
    const favorites = (profile.favorites || []).map(x => `${x.category || 'favorite'}: ${x.value || 'unknown'} (${x.provenance || 'unknown'})`);
    const queued = (profile.discoveries || []).map(x => `${x.target || x.type || 'discovery'}: ${x.title}`);
    return [
        traits.length ? `Known traits:\n- ${traits.join('\n- ')}` : '',
        favorites.length ? `Known favorites:\n- ${favorites.join('\n- ')}` : '',
        queued.length ? `Already queued discoveries:\n- ${queued.join('\n- ')}` : '',
    ].filter(Boolean).join('\n\n');
}

function systemPrompt() {
    return `You are Offstage, a conservative character-continuity analyst. Analyze ONLY the supplied character card and roleplay for the named character. Return JSON only. Do not invent facts. A single joke/action is not a stable trait. Prefer repeated evidence. Favorites must be explicit or strongly/repeatedly supported. Stay setting-aware. canon = explicit card fact; established = explicit RP fact; inferred = repeated behavior; emergent = developed in this RP. Hidden traits may be secrets or blind spots. Mood/current state may change quickly. Do not overwrite known facts because of one recent contradiction. Maximum 6 durable discoveries. Confidence 0 to 1.\n\nReturn exactly: {"transient":{"mood":"","currentState":"","energy":0},"discoveries":[{"target":"trait","title":"trait name","section":"public|private|hidden","value":0,"summary":"one sentence","evidence":"specific evidence","provenance":"canon|established|inferred|emergent","confidence":0.0},{"target":"favorite","title":"Favorite drink","section":"private","category":"Drink","favoriteValue":"black tea","summary":"one sentence","evidence":"specific evidence","provenance":"canon|established|inferred|emergent","confidence":0.0}]} Omit unsupported discoveries.`;
}

function userPrompt(character, profile, contextMessages) {
    return `CHARACTER: ${character.name || 'Unknown'}\n\nCHARACTER CARD:\n${buildCardContext(character) || '(No card details available.)'}\n\nCURRENT OFFSTAGE STATE:\n${buildExistingState(profile) || '(No accepted or queued Offstage facts yet.)'}\n\nRECENT ROLEPLAY:\n${buildTranscript(contextMessages) || '(No recent roleplay messages.)'}\n\nAnalyze this character now.`;
}

function getConnectionProfile() {
    const ctx = context();
    const manager = ctx?.extensionSettings?.connectionManager;
    const id = manager?.selectedProfile;
    if (!id) return null;
    const profile = Array.isArray(manager?.profiles) ? manager.profiles.find(p => p.id === id) : null;
    return profile ? { id, profile } : { id, profile: null };
}

function connectionLabel() {
    const selected = getConnectionProfile();
    if (!selected) return 'Active SillyTavern connection (no Connection Manager profile selected)';
    const p = selected.profile;
    return p ? `${p.name || 'Connection profile'} · ${p.model || p.api || 'model'}` : `Connection profile ${selected.id}`;
}

async function generateWithRoleplayConnection(system, prompt, maxTokens = 900) {
    const ctx = context();
    if (!ctx) throw new Error('SillyTavern context is unavailable.');

    const selected = getConnectionProfile();
    if (selected) {
        const Service = ctx.ConnectionManagerRequestService;
        if (!Service?.sendRequest) {
            throw new Error('A Connection Manager profile is selected, but ConnectionManagerRequestService is unavailable.');
        }
        const messages = [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
        ];
        const result = await Service.sendRequest(selected.id, messages, maxTokens, {
            stream: false,
            extractData: true,
            includePreset: true,
            includeInstruct: true,
        });
        const content = result?.content;
        if (!content || typeof content !== 'string') throw new Error('The selected connection profile returned an empty response.');
        return { content, connection: connectionLabel(), usedProfile: true };
    }

    if (typeof ctx.generateRaw !== 'function') throw new Error('No usable SillyTavern generation connection is available.');
    const content = await ctx.generateRaw({ prompt, systemPrompt: system, responseLength: maxTokens });
    if (!content || typeof content !== 'string') throw new Error('The active SillyTavern connection returned an empty response.');
    return { content, connection: connectionLabel(), usedProfile: false };
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

function normalizeDiscovery(raw) {
    const target = raw?.target === 'favorite' ? 'favorite' : raw?.target === 'trait' ? 'trait' : null;
    if (!target) return null;
    const provenance = ['canon', 'established', 'inferred', 'emergent'].includes(raw.provenance) ? raw.provenance : 'inferred';
    const section = ['public', 'private', 'hidden'].includes(raw.section) ? raw.section : 'private';
    const confidence = clamp(raw.confidence, 0, 1, 0);
    if (confidence < 0.65) return null;
    if (target === 'favorite') {
        const category = String(raw.category || '').trim();
        const favoriteValue = String(raw.favoriteValue || '').trim();
        if (!category || !favoriteValue) return null;
        return { id: uid('discovery'), source: 'ai-analysis', target, type: 'Favorite discovered', title: String(raw.title || `Favorite ${category}`).trim(), section, category, favoriteValue, summary: String(raw.summary || '').trim(), reason: String(raw.evidence || '').trim(), provenance, confidence, createdAt: Date.now() };
    }
    const title = String(raw.title || '').trim();
    if (!title) return null;
    return { id: uid('discovery'), source: 'ai-analysis', target, type: section === 'hidden' ? 'Hidden trait' : 'Personality discovery', title, section, value: clamp(raw.value, 0, 100, 65), summary: String(raw.summary || '').trim(), reason: String(raw.evidence || '').trim(), provenance, confidence, createdAt: Date.now() };
}

function sameDiscovery(a, b) {
    if ((a.target || '') !== (b.target || '')) return false;
    return a.target === 'favorite'
        ? norm(a.category) === norm(b.category) && norm(a.favoriteValue) === norm(b.favoriteValue)
        : norm(a.title) === norm(b.title);
}

function discoveryAlreadyKnown(profile, candidate) {
    if (candidate.target === 'favorite') {
        if ((profile.favorites || []).some(x => norm(x.category) === norm(candidate.category) && norm(x.value) === norm(candidate.favoriteValue))) return true;
    } else {
        for (const section of ['public', 'private', 'hidden']) {
            if ((profile.personality?.[section] || []).some(x => norm(x.name) === norm(candidate.title))) return true;
        }
    }
    return (profile.discoveries || []).some(x => sameDiscovery(x, candidate));
}

function updateStatus(text) {
    const settings = getSettings();
    if (settings) { settings.analysis.lastStatus = text; save(); }
    const el = document.getElementById('offstage-analyzer-status');
    if (el) el.textContent = text;
    const conn = document.getElementById('offstage-analyzer-connection');
    if (conn) conn.textContent = connectionLabel();
}

function refreshOpenOffstage() {
    const active = document.querySelector('#offstage-root.is-open .offstage-tab.is-active');
    if (active instanceof HTMLElement) requestAnimationFrame(() => active.click());
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
        updateStatus('Waiting for a single-character chat.');
        if (manual) globalThis.toastr?.warning?.('Open a single-character chat first.', 'Offstage');
        return false;
    }
    if (!Array.isArray(ctx.chat) || ctx.chat.length < 2) {
        updateStatus('Not enough roleplay context yet.');
        if (manual) globalThis.toastr?.info?.('There is not enough RP context to analyze yet.', 'Offstage');
        return false;
    }

    analysisInFlight = true;
    updateStatus(`Analyzing ${character.name} with ${connectionLabel()}…`);
    const button = document.getElementById('offstage-analyze-now');
    if (button) { button.disabled = true; button.textContent = '✦ Analyzing…'; }

    try {
        const generated = await generateWithRoleplayConnection(
            systemPrompt(),
            userPrompt(character, profile, clamp(settings.analysis.contextMessages, 6, 80, 24)),
            900,
        );
        const parsed = parseJsonResponse(generated.content);

        if (settings.analysis.updateTransient !== false && parsed?.transient && typeof parsed.transient === 'object') {
            const mood = String(parsed.transient.mood || '').trim();
            const currentState = String(parsed.transient.currentState || '').trim();
            const energy = Number(parsed.transient.energy);
            if (mood) profile.mood = mood.slice(0, 100);
            if (currentState) profile.currentState = currentState.slice(0, 160);
            if (Number.isFinite(energy)) profile.energy = clamp(energy, 0, 100, profile.energy ?? 50);
        }

        const candidates = Array.isArray(parsed?.discoveries) ? parsed.discoveries.map(normalizeDiscovery).filter(Boolean) : [];
        let added = 0;
        for (const candidate of candidates.slice(0, 6)) {
            if (discoveryAlreadyKnown(profile, candidate)) continue;
            profile.discoveries.push(candidate);
            added++;
        }

        const key = historyKey();
        if (key) settings.analysis.history[key] = { lastIndex: ctx.chat.length - 1, lastAt: Date.now(), lastAdded: added };
        profile.analysisMeta.lastAnalyzedAt = Date.now();
        profile.analysisMeta.lastAnalyzedMessage = ctx.chat.length - 1;
        profile.analysisMeta.lastConnection = generated.connection;
        save();
        updateStatus(added ? `Scan complete via ${generated.connection} — ${added} new ${added === 1 ? 'discovery' : 'discoveries'} queued.` : `Scan complete via ${generated.connection} — no new durable discoveries.`);
        refreshOpenOffstage();
        if (added) globalThis.toastr?.success?.(`Offstage noticed ${added} new ${added === 1 ? 'thing' : 'things'} about ${character.name}.`, 'Offstage');
        else if (manual) globalThis.toastr?.info?.(`Analysis completed using ${generated.connection}.`, 'Offstage');
        return true;
    } catch (error) {
        console.error('[Offstage Analyzer] Analysis failed:', error);
        const detail = error?.cause?.message || error?.message || 'Unknown request error';
        updateStatus(`Analysis failed on ${connectionLabel()}: ${detail}`);
        globalThis.toastr?.error?.(`Analysis failed using ${connectionLabel()}. ${detail}`, 'Offstage', { timeOut: 9000 });
        return false;
    } finally {
        analysisInFlight = false;
        if (button) { button.disabled = false; button.textContent = '✦ Analyze current context now'; }
    }
}

function assistantRepliesSince(lastIndex) {
    const chat = context()?.chat;
    if (!Array.isArray(chat)) return 0;
    return chat.slice(Math.max(0, Number(lastIndex) + 1)).filter(m => !m?.is_user && !m?.is_system && String(m?.mes ?? '').trim()).length;
}

async function maybeAutoAnalyze(messageIndex, source) {
    const settings = getSettings();
    const ctx = context();
    if (!settings?.analysis.enabled || !ctx || ctx.groupId || analysisInFlight || source === 'extension') return;
    const message = ctx.chat?.[messageIndex];
    if (message?.is_user || message?.is_system) return;
    const key = historyKey();
    if (!key) return;
    const state = settings.analysis.history[key] || { lastIndex: -1 };
    const required = clamp(settings.analysis.interval, 1, 50, 5);
    const count = assistantRepliesSince(state.lastIndex);
    if (count < required) { updateStatus(`${count}/${required} character replies until next automatic scan. Using ${connectionLabel()}.`); return; }
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
        profile.favorites.push({ id: uid('favorite'), category: item.category || item.title || 'Favorite', value: item.favoriteValue || item.title || 'Unknown', icon: '♡', provenance: item.provenance || 'inferred', hidden, revealed: !hidden, discovery: hidden ? Math.round((item.confidence || .7) * 100) : 100, note: item.summary || '', evidence: item.reason ? [item.reason] : [] });
    } else {
        const section = mode === 'hidden' ? 'hidden' : (item.section || 'private');
        profile.personality[section] ??= [];
        profile.personality[section].push({ id: uid('trait'), name: item.title || 'Unnamed trait', value: clamp(item.value, 0, 100, 65), provenance: item.provenance || 'inferred', awareness: section === 'hidden' ? 'low' : 'moderate', note: item.summary || '', evidence: item.reason ? [item.reason] : [] });
    }
    profile.discoveries = profile.discoveries.filter(x => x.id !== item.id);
    save(); refreshOpenOffstage();
}

function bindDiscoveryCapture() {
    if (captureBound) return;
    captureBound = true;
    document.addEventListener('click', event => {
        const button = event.target instanceof Element ? event.target.closest('.offstage-accept-discovery, .offstage-hide-discovery, .offstage-reject-discovery') : null;
        if (!(button instanceof HTMLElement)) return;
        const card = button.closest('[data-discovery-id]');
        if (!(card instanceof HTMLElement)) return;
        const profile = currentProfile(false);
        const item = profile?.discoveries?.find(x => x.id === card.dataset.discoveryId);
        if (!item || item.source !== 'ai-analysis') return;
        event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
        if (button.classList.contains('offstage-reject-discovery')) {
            profile.discoveries = profile.discoveries.filter(x => x.id !== item.id); save(); refreshOpenOffstage();
        } else applyAiDiscovery(item, button.classList.contains('offstage-hide-discovery') ? 'hidden' : 'accept');
    }, true);
}

function settingsMarkup() {
    const analysis = getSettings()?.analysis || {};
    return `<div id="${SETTINGS_BLOCK_ID}" style="margin-top:6px;padding-top:12px;border-top:1px solid var(--SmartThemeBorderColor);">
        <div style="font-weight:700;margin-bottom:4px;">✦ AI Character Analysis</div>
        <small style="display:block;opacity:.78;margin-bottom:8px;">Automatically uses the Connection Manager profile currently selected for your RP, including its provider, model, preset, API URL/secret, and instruct preset.</small>
        <div style="padding:9px 10px;border:1px solid var(--SmartThemeBorderColor);border-radius:9px;margin-bottom:9px;"><small style="display:block;opacity:.68;">RP CONNECTION PROFILE</small><strong id="offstage-analyzer-connection">${connectionLabel()}</strong></div>
        <label class="checkbox_label"><input id="offstage-analyzer-enabled" type="checkbox" ${analysis.enabled !== false ? 'checked' : ''}><span>Automatically analyze the active character</span></label>
        <label class="checkbox_label"><input id="offstage-analyzer-transient" type="checkbox" ${analysis.updateTransient !== false ? 'checked' : ''}><span>Automatically update Mood / Currently / Energy</span></label>
        <div style="display:grid;grid-template-columns:1fr 92px;gap:10px;align-items:center;margin-top:9px;"><label>Scan after this many character replies</label><input id="offstage-analyzer-interval" class="text_pole" type="number" min="1" max="50" value="${clamp(analysis.interval,1,50,5)}"></div>
        <div style="display:grid;grid-template-columns:1fr 92px;gap:10px;align-items:center;margin-top:9px;"><label>Recent messages sent to analyzer</label><input id="offstage-analyzer-window" class="text_pole" type="number" min="6" max="80" value="${clamp(analysis.contextMessages,6,80,24)}"></div>
        <button id="offstage-analyze-now" type="button" class="menu_button" style="margin-top:11px;width:100%;">✦ Analyze current context now</button>
        <div style="margin-top:9px;padding:9px 10px;border:1px solid var(--SmartThemeBorderColor);border-radius:9px;"><small style="display:block;opacity:.68;">ANALYZER STATUS</small><span id="offstage-analyzer-status">${String(analysis.lastStatus || 'Ready')}</span></div>
        <small style="display:block;margin-top:8px;opacity:.72;">Durable traits and favorites still go to the Discovery Inbox for approval.</small>
    </div>`;
}

function mountSettings(attempt = 0) {
    if (document.getElementById(SETTINGS_BLOCK_ID)) { syncSettingsControls(); return; }
    const host = document.querySelector('#offstage-settings-panel .inline-drawer-content .flex-container');
    if (!(host instanceof HTMLElement)) { if (attempt < 100) setTimeout(() => mountSettings(attempt + 1), 250); return; }
    host.insertAdjacentHTML('beforeend', settingsMarkup());
    document.getElementById('offstage-analyzer-enabled')?.addEventListener('change', e => { const s=getSettings(); if(s){s.analysis.enabled=!!e.target.checked; save(); updateStatus(s.analysis.enabled?'Automatic analysis enabled.':'Automatic analysis paused.');} });
    document.getElementById('offstage-analyzer-transient')?.addEventListener('change', e => { const s=getSettings(); if(s){s.analysis.updateTransient=!!e.target.checked; save();} });
    document.getElementById('offstage-analyzer-interval')?.addEventListener('change', e => { const s=getSettings(); if(s){s.analysis.interval=clamp(e.target.value,1,50,5); e.target.value=s.analysis.interval; save();} });
    document.getElementById('offstage-analyzer-window')?.addEventListener('change', e => { const s=getSettings(); if(s){s.analysis.contextMessages=clamp(e.target.value,6,80,24); e.target.value=s.analysis.contextMessages; save();} });
    document.getElementById('offstage-analyze-now')?.addEventListener('click', () => void analyzeCurrentCharacter({ manual:true }));
    const versionLabel=[...document.querySelectorAll('#offstage-settings-panel small')].find(el=>/^Offstage v/i.test(el.textContent||''));
    if(versionLabel) versionLabel.textContent=`Offstage v${ANALYZER_VERSION}`;
    syncSettingsControls();
}

function syncSettingsControls() {
    const s=getSettings(); if(!s) return;
    const enabled=document.getElementById('offstage-analyzer-enabled'); if(enabled) enabled.checked=s.analysis.enabled!==false;
    const transient=document.getElementById('offstage-analyzer-transient'); if(transient) transient.checked=s.analysis.updateTransient!==false;
    const interval=document.getElementById('offstage-analyzer-interval'); if(interval) interval.value=clamp(s.analysis.interval,1,50,5);
    const win=document.getElementById('offstage-analyzer-window'); if(win) win.value=clamp(s.analysis.contextMessages,6,80,24);
    const status=document.getElementById('offstage-analyzer-status'); if(status) status.textContent=s.analysis.lastStatus||'Ready';
    const conn=document.getElementById('offstage-analyzer-connection'); if(conn) conn.textContent=connectionLabel();
}

function bindEvents() {
    const ctx=context(); const events=ctx?.eventTypes??ctx?.event_types;
    if(!ctx?.eventSource||!events) return false;
    if(events.MESSAGE_RECEIVED) ctx.eventSource.on(events.MESSAGE_RECEIVED,(idx,source)=>scheduleAutoAnalyze(idx,source));
    if(events.CHAT_CHANGED) ctx.eventSource.on(events.CHAT_CHANGED,()=>{syncSettingsControls();updateStatus(`Ready. Using ${connectionLabel()}.`);});
    if(events.CONNECTION_PROFILE_LOADED) ctx.eventSource.on(events.CONNECTION_PROFILE_LOADED,()=>{syncSettingsControls();updateStatus(`Connection profile changed: ${connectionLabel()}.`);});
    if(events.CONNECTION_PROFILE_UPDATED) ctx.eventSource.on(events.CONNECTION_PROFILE_UPDATED,()=>syncSettingsControls());
    return true;
}

export function initAnalyzer() {
    if(initialized){mountSettings();return;}
    initialized=true;
    getSettings(); bindDiscoveryCapture(); mountSettings();
    if(!bindEvents()) setTimeout(()=>{bindEvents();mountSettings();},1200);
    updateStatus(`Ready. Using ${connectionLabel()}.`);
    console.info(`[Offstage Analyzer] v${ANALYZER_VERSION} initialized with RP connection-profile routing`);
}

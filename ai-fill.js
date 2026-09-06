const EXTENSION_KEY = 'offstage';
const AI_FILL_VERSION = '0.5.0';
const STYLE_ID = 'offstage-ai-fill-styles';
const SHEET_ID = 'offstage-ai-fill-sheet';

let initialized = false;
let observer = null;
let generating = false;

const context = () => globalThis.SillyTavern?.getContext?.();
const clamp = (value, min, max, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};
const norm = (value = '') => String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const uid = (prefix = 'off-ai-fill') => globalThis.crypto?.randomUUID?.()
    ? `${prefix}-${globalThis.crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const escapeHtml = (value = '') => String(value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

function getSettings() {
    const ctx = context();
    if (!ctx?.extensionSettings) return null;
    ctx.extensionSettings[EXTENSION_KEY] ??= { schemaVersion: 1, profiles: {}, ui: { lastTab: 'profile' } };
    const root = ctx.extensionSettings[EXTENSION_KEY];
    root.profiles ??= {};
    root.aiFill ??= { allowHeadcanon: true, contextMessages: 30 };
    root.aiFill.allowHeadcanon ??= true;
    root.aiFill.contextMessages ??= 30;
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
            theme: 'rosewater', personality: { public: [], private: [], hidden: [] },
            favorites: [], discoveries: [], journal: [], social: [], playlists: [],
        };
    }
    const profile = settings.profiles[key];
    profile.personality ??= { public: [], private: [], hidden: [] };
    profile.favorites ??= [];
    profile.discoveries ??= [];
    return profile;
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
        ['First message', cardField(character, 'first_mes')],
        ['Example dialogue', cardField(character, 'mes_example')],
    ].filter(([, v]) => String(v ?? '').trim())
      .map(([label, v]) => `${label}:\n${clip(v, 5000)}`)
      .join('\n\n');
}

function buildTranscript(limit = 30) {
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
        const row = `${role}:\n${clip(m.mes, 4000)}`;
        if (total + row.length > 26000 && rows.length >= 6) break;
        rows.unshift(row);
        total += row.length;
    }
    return rows.join('\n\n');
}

function buildExistingState(profile) {
    const traits = ['public', 'private', 'hidden'].flatMap(section =>
        (profile.personality?.[section] || []).map(x => `${section}: ${x.name} (${x.provenance || 'unknown'}, ${x.value ?? 50})`));
    const favorites = (profile.favorites || []).map(x => `${x.category || 'favorite'}: ${x.value || 'unknown'} (${x.provenance || 'unknown'})`);
    return [
        traits.length ? `Existing traits:\n- ${traits.join('\n- ')}` : '',
        favorites.length ? `Existing favorites:\n- ${favorites.join('\n- ')}` : '',
    ].filter(Boolean).join('\n\n');
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
    if (!selected) return 'Active SillyTavern connection';
    const p = selected.profile;
    return p ? `${p.name || 'Connection profile'} · ${p.model || p.api || 'model'}` : `Connection profile ${selected.id}`;
}

async function generateWithRoleplayConnection(system, prompt, maxTokens = 1100) {
    const ctx = context();
    if (!ctx) throw new Error('SillyTavern context is unavailable.');

    const selected = getConnectionProfile();
    if (selected) {
        const Service = ctx.ConnectionManagerRequestService;
        if (!Service?.sendRequest) throw new Error('The selected RP connection profile cannot be used by extensions on this build.');
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
        if (!result?.content || typeof result.content !== 'string') throw new Error('The RP connection profile returned an empty response.');
        return result.content;
    }

    if (typeof ctx.generateRaw !== 'function') throw new Error('No usable SillyTavern generation connection is available.');
    const result = await ctx.generateRaw({ prompt, systemPrompt: system, responseLength: maxTokens });
    if (!result || typeof result !== 'string') throw new Error('The active connection returned an empty response.');
    return result;
}

function parseJson(raw) {
    let text = String(raw ?? '').trim();
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) text = fenced[1].trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) text = text.slice(start, end + 1);
    return JSON.parse(text);
}

function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
        .offstage-ai-fill-trigger{white-space:nowrap!important;display:inline-flex!important;align-items:center!important;gap:6px!important}
        #${SHEET_ID}{position:fixed;top:10px;right:10px;bottom:10px;width:min(580px,calc(100vw - 20px));z-index:100020;display:flex;align-items:stretch;justify-content:stretch;pointer-events:auto}
        #${SHEET_ID} .offstage-ai-fill-card{width:100%;height:100%;overflow:auto;color:var(--off-ink,#2f2028);background:linear-gradient(145deg,rgba(255,250,252,.98),rgba(242,225,233,.97));border:1px solid rgba(255,255,255,.42);border-radius:28px;box-shadow:-24px 20px 80px rgba(0,0,0,.42);backdrop-filter:blur(34px) saturate(1.2);padding:26px 22px 34px}
        #${SHEET_ID} .offstage-ai-fill-top{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:18px}
        #${SHEET_ID} h2{font:500 34px/1.05 Georgia,serif;margin:5px 0 7px;color:inherit}
        #${SHEET_ID} .offstage-ai-kicker{text-transform:uppercase;letter-spacing:.17em;font-size:10px;font-weight:850;color:var(--off-accent,#a8556d)}
        #${SHEET_ID} .offstage-ai-close{border:1px solid rgba(90,50,65,.16);background:rgba(255,255,255,.56);border-radius:999px;min-width:42px;height:42px;font-size:23px;color:inherit}
        #${SHEET_ID} .offstage-ai-form{display:grid;gap:14px}
        #${SHEET_ID} label{display:grid;gap:6px;font-weight:700;font-size:13px}
        #${SHEET_ID} input,#${SHEET_ID} select,#${SHEET_ID} textarea{width:100%;box-sizing:border-box;border:1px solid rgba(90,50,65,.16);border-radius:13px;padding:11px 12px;background:rgba(255,255,255,.72);color:#2f2028;font:500 14px/1.35 system-ui,sans-serif}
        #${SHEET_ID} textarea{min-height:88px;resize:vertical}
        #${SHEET_ID} .offstage-ai-row{display:grid;grid-template-columns:1fr 110px;gap:12px}
        #${SHEET_ID} .offstage-ai-check{display:flex;grid-template-columns:none;align-items:flex-start;gap:9px;font-weight:600}
        #${SHEET_ID} .offstage-ai-check input{width:auto;margin-top:2px}
        #${SHEET_ID} .offstage-ai-note{padding:11px 12px;border-radius:14px;background:rgba(168,85,109,.08);border:1px solid rgba(168,85,109,.12);font-size:12px;line-height:1.45}
        #${SHEET_ID} .offstage-ai-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:3px}
        #${SHEET_ID} .offstage-ai-primary{flex:1;min-width:170px}
        #${SHEET_ID} .offstage-ai-results{display:grid;gap:11px;margin-top:18px}
        #${SHEET_ID} .offstage-ai-result{display:grid;grid-template-columns:auto 1fr;gap:11px;padding:14px;border-radius:17px;background:rgba(255,255,255,.62);border:1px solid rgba(90,50,65,.13)}
        #${SHEET_ID} .offstage-ai-result>input{width:auto;margin-top:6px}
        #${SHEET_ID} .offstage-ai-result-fields{display:grid;gap:8px}
        #${SHEET_ID} .offstage-ai-result-grid{display:grid;grid-template-columns:1fr 130px;gap:8px}
        #${SHEET_ID} .offstage-ai-meta{display:flex;gap:6px;flex-wrap:wrap;font-size:10px;text-transform:uppercase;letter-spacing:.08em;font-weight:800;color:var(--off-accent,#a8556d)}
        #${SHEET_ID} .offstage-ai-rationale{font-size:12px;line-height:1.45;color:#715d67}
        #${SHEET_ID} .offstage-ai-status{text-align:center;padding:16px 8px;color:#715d67;font-size:13px}
        @media(max-width:820px){#${SHEET_ID}{inset:0;width:100vw;height:100dvh}#${SHEET_ID} .offstage-ai-fill-card{border-radius:0;border:0;padding:calc(22px + env(safe-area-inset-top)) 16px calc(30px + env(safe-area-inset-bottom))}#${SHEET_ID} .offstage-ai-close{position:sticky;top:0;z-index:2;background:rgba(49,31,40,.88);color:#fff;min-width:84px;padding:0 13px;font-size:20px}#${SHEET_ID} .offstage-ai-close::after{content:' Close';font-size:12px;font-weight:800}#${SHEET_ID} .offstage-ai-row,#${SHEET_ID} .offstage-ai-result-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
}

function injectButtons() {
    const root = document.getElementById('offstage-root');
    if (!root) return;

    for (const heading of root.querySelectorAll('.offstage-section-heading')) {
        const title = heading.querySelector('h2')?.textContent?.trim().toLowerCase();
        let target = null;
        let label = '✦ AI Add';
        if (title === 'personality') target = 'personality';
        else if (title === 'favorites') target = 'favorites';
        else if (title?.includes("little world")) { target = 'profile'; label = '✦ AI Build'; }
        if (!target || heading.querySelector(`[data-offstage-ai-fill="${target}"]`)) continue;

        const existingAction = heading.querySelector('.menu_button');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'menu_button offstage-ai-fill-trigger';
        button.dataset.offstageAiFill = target;
        button.textContent = label;
        if (existingAction?.parentElement === heading) heading.insertBefore(button, existingAction);
        else heading.appendChild(button);
    }
}

function modeFields(target) {
    if (target === 'personality') {
        return `
            <div class="offstage-ai-row">
                <label>Trait visibility
                    <select id="offstage-ai-section">
                        <option value="auto">Let AI choose</option>
                        <option value="public">Public</option>
                        <option value="private">Private</option>
                        <option value="hidden">Hidden / blind spot</option>
                    </select>
                </label>
                <label>How many
                    <input id="offstage-ai-count" type="number" min="1" max="5" value="3">
                </label>
            </div>
            <label>Focus, if you have one
                <input id="offstage-ai-category" placeholder="e.g. romance, jealousy, social behavior — or leave blank">
            </label>`;
    }

    if (target === 'favorites') {
        return `
            <div class="offstage-ai-row">
                <label>Favorite / preference category
                    <input id="offstage-ai-category" list="offstage-ai-favorite-presets" placeholder="e.g. Food, Color, Favorite movie, Let AI choose">
                    <datalist id="offstage-ai-favorite-presets">
                        <option value="Let AI choose">
                        <option value="Food"><option value="Drink"><option value="Color"><option value="Scent">
                        <option value="Flower or plant"><option value="Season"><option value="Weather"><option value="Animal">
                        <option value="Hobby"><option value="Book or story"><option value="Art or entertainment">
                        <option value="Music or song"><option value="Clothing or style"><option value="Place">
                        <option value="Comfort item"><option value="Ideal gift"><option value="Pet peeve"><option value="Guilty pleasure">
                    </datalist>
                </label>
                <label>How many
                    <input id="offstage-ai-count" type="number" min="1" max="6" value="3">
                </label>
            </div>`;
    }

    return `
        <div class="offstage-ai-row">
            <label>Build focus
                <select id="offstage-ai-section">
                    <option value="balanced">Balanced mini-profile</option>
                    <option value="personality">Mostly personality</option>
                    <option value="favorites">Mostly favorites</option>
                    <option value="hidden">Secrets & hidden traits</option>
                </select>
            </label>
            <label>How many
                <input id="offstage-ai-count" type="number" min="2" max="8" value="6">
            </label>
        </div>
        <input id="offstage-ai-category" type="hidden" value="">`;
}

function openSheet(target) {
    closeSheet();
    ensureStyles();
    const character = currentCharacter();
    if (!character) {
        globalThis.toastr?.warning?.('Open a single-character chat first.', 'Offstage');
        return;
    }
    const settings = getSettings();
    const title = target === 'personality' ? 'Build personality' : target === 'favorites' ? 'Choose their tastes' : 'Build their little world';
    const subtitle = target === 'personality'
        ? 'Ask the RP model for traits that fit this character.'
        : target === 'favorites'
            ? 'Pick a category—or let the model choose something that suits them.'
            : 'Let the model propose a balanced set of traits and personal tastes.';

    const sheet = document.createElement('div');
    sheet.id = SHEET_ID;
    sheet.dataset.target = target;
    sheet.innerHTML = `
        <section class="offstage-ai-fill-card">
            <div class="offstage-ai-fill-top">
                <div><div class="offstage-ai-kicker">Offstage AI · ${escapeHtml(connectionLabel())}</div><h2>${escapeHtml(title)}</h2><div>${escapeHtml(subtitle)}</div></div>
                <button type="button" class="offstage-ai-close" aria-label="Close">×</button>
            </div>
            <div class="offstage-ai-form">
                ${modeFields(target)}
                <label>Extra guidance (optional)
                    <textarea id="offstage-ai-guidance" placeholder="Anything you want the model to consider—or leave this blank and let it decide."></textarea>
                </label>
                <label class="offstage-ai-check">
                    <input id="offstage-ai-headcanon" type="checkbox" ${settings?.aiFill?.allowHeadcanon !== false ? 'checked' : ''}>
                    <span><strong>Allow logical headcanon.</strong> If the card/RP doesn't explicitly answer the category, the model may make a plausible choice from personality, setting, habits, background, and context. It must label that choice as headcanon.</span>
                </label>
                <div class="offstage-ai-note">Canon and explicit RP facts take priority. Offstage will not overwrite things you've already accepted, and setting-inappropriate choices are forbidden.</div>
                <div class="offstage-ai-actions">
                    <button type="button" class="menu_button offstage-ai-primary" id="offstage-ai-generate">✦ Generate suggestions</button>
                    <button type="button" class="menu_button" id="offstage-ai-cancel">Cancel</button>
                </div>
            </div>
            <div id="offstage-ai-results"></div>
        </section>`;
    document.body.appendChild(sheet);
    sheet.querySelector('.offstage-ai-close')?.addEventListener('click', closeSheet);
    sheet.querySelector('#offstage-ai-cancel')?.addEventListener('click', closeSheet);
    sheet.querySelector('#offstage-ai-generate')?.addEventListener('click', () => void generateSuggestions(target));
}

function closeSheet() { document.getElementById(SHEET_ID)?.remove(); }

function systemPrompt(target, allowHeadcanon) {
    const headcanonRule = allowHeadcanon
        ? 'If a requested detail is not explicit, you MAY make a plausible, specific choice based on the character’s personality, setting, history, habits, values, and current RP. Mark such choices provenance="headcanon". This is deliberate creative extrapolation, not canon.'
        : 'If a detail is not explicitly stated or strongly supported, omit it. Do not invent headcanon.';

    return `You are Offstage's manual AI character builder. The user has intentionally asked you to fill part of a living character profile. Read the character card, recent roleplay, and existing Offstage state before choosing anything.\n\n${headcanonRule}\n\nRules:\n- Return JSON only, no markdown.\n- Never contradict explicit character-card canon or established RP.\n- Never duplicate existing Offstage facts.\n- Keep every choice appropriate to the setting. A fantasy character should get plays, ballads, books, foods, fabrics, festivals, etc. when appropriate—not modern movies/apps/brands unless the setting supports them.\n- Make choices CHARACTER-SPECIFIC, not generic archetype filler.\n- provenance must be one of canon, established, inferred, emergent, headcanon.\n- confidence is 0 to 1 and means confidence the choice fits the supplied character.\n- rationale should briefly explain the logic without pretending headcanon is established fact.\n- For traits, section must be public, private, or hidden; value is 0-100. Hidden includes secrets, blind spots, or traits they do not recognize in themselves.\n- For favorites, category should be natural and setting-aware.\n- Target mode is ${target}.\n\nReturn exactly: {"suggestions":[{"type":"trait","name":"","section":"private","value":65,"provenance":"headcanon","confidence":0.8,"rationale":""},{"type":"favorite","category":"Food","value":"","provenance":"headcanon","confidence":0.8,"rationale":""}]}. Return only suggestion types appropriate to the requested target.`;
}

function userPrompt(target, count, section, category, guidance, allowHeadcanon) {
    const character = currentCharacter();
    const profile = currentProfile();
    const settings = getSettings();
    const request = target === 'personality'
        ? `Suggest ${count} personality trait(s). Visibility preference: ${section || 'auto'}. Focus: ${category || 'use your judgment'}.`
        : target === 'favorites'
            ? `Suggest ${count} favorite/preference item(s). Requested category: ${category || 'Let AI choose'}. If one exact category is supplied, stay within that category unless multiple items would be redundant.`
            : `Suggest ${count} total profile additions. Build focus: ${section || 'balanced'}. Mix traits and favorites logically unless the focus says otherwise.`;

    return `CHARACTER: ${character?.name || 'Unknown'}\n\nUSER REQUEST:\n${request}\nAllow logical headcanon: ${allowHeadcanon ? 'yes' : 'no'}\nExtra guidance: ${guidance || '(none)'}\n\nCHARACTER CARD:\n${buildCardContext(character) || '(No card details available.)'}\n\nRECENT ROLEPLAY:\n${buildTranscript(clamp(settings?.aiFill?.contextMessages, 8, 80, 30)) || '(No recent RP context.)'}\n\nEXISTING OFFSTAGE STATE:\n${buildExistingState(profile) || '(Empty profile.)'}\n\nMake the most character-specific, logical choices you can.`;
}

function normalizeSuggestion(raw, target) {
    if (raw?.type === 'trait' && target !== 'favorites') {
        const name = String(raw.name || '').trim();
        if (!name) return null;
        return {
            id: uid('preview'), type: 'trait', name,
            section: ['public', 'private', 'hidden'].includes(raw.section) ? raw.section : 'private',
            value: clamp(raw.value, 0, 100, 65),
            provenance: ['canon', 'established', 'inferred', 'emergent', 'headcanon'].includes(raw.provenance) ? raw.provenance : 'headcanon',
            confidence: clamp(raw.confidence, 0, 1, 0.7),
            rationale: String(raw.rationale || '').trim(),
        };
    }
    if (raw?.type === 'favorite' && target !== 'personality') {
        const category = String(raw.category || '').trim();
        const value = String(raw.value || '').trim();
        if (!category || !value) return null;
        return {
            id: uid('preview'), type: 'favorite', category, value,
            provenance: ['canon', 'established', 'inferred', 'emergent', 'headcanon'].includes(raw.provenance) ? raw.provenance : 'headcanon',
            confidence: clamp(raw.confidence, 0, 1, 0.7),
            rationale: String(raw.rationale || '').trim(),
        };
    }
    return null;
}

function renderResults(items) {
    const host = document.getElementById('offstage-ai-results');
    if (!host) return;
    if (!items.length) {
        host.innerHTML = '<div class="offstage-ai-status">The model did not find a suggestion it could justify. Try different guidance or allow logical headcanon.</div>';
        return;
    }

    host.innerHTML = `<div class="offstage-ai-results">
        <div class="offstage-ai-kicker">Suggestions · edit anything before adding</div>
        ${items.map((item, index) => item.type === 'trait' ? `
            <article class="offstage-ai-result" data-result-index="${index}" data-type="trait">
                <input type="checkbox" class="offstage-ai-select" checked aria-label="Add this suggestion">
                <div class="offstage-ai-result-fields">
                    <div class="offstage-ai-result-grid">
                        <input class="offstage-ai-result-name" value="${escapeHtml(item.name)}" aria-label="Trait name">
                        <select class="offstage-ai-result-section">
                            ${['public','private','hidden'].map(s => `<option value="${s}" ${item.section === s ? 'selected' : ''}>${s}</option>`).join('')}
                        </select>
                    </div>
                    <div class="offstage-ai-result-grid">
                        <label>Strength <input class="offstage-ai-result-value" type="number" min="0" max="100" value="${item.value}"></label>
                        <div class="offstage-ai-meta"><span>${escapeHtml(item.provenance)}</span><span>${Math.round(item.confidence * 100)}% fit</span></div>
                    </div>
                    <div class="offstage-ai-rationale">${escapeHtml(item.rationale)}</div>
                    <input type="hidden" class="offstage-ai-result-provenance" value="${escapeHtml(item.provenance)}">
                    <input type="hidden" class="offstage-ai-result-rationale-hidden" value="${escapeHtml(item.rationale)}">
                </div>
            </article>` : `
            <article class="offstage-ai-result" data-result-index="${index}" data-type="favorite">
                <input type="checkbox" class="offstage-ai-select" checked aria-label="Add this suggestion">
                <div class="offstage-ai-result-fields">
                    <div class="offstage-ai-result-grid">
                        <input class="offstage-ai-result-category" value="${escapeHtml(item.category)}" aria-label="Favorite category">
                        <div class="offstage-ai-meta"><span>${escapeHtml(item.provenance)}</span><span>${Math.round(item.confidence * 100)}% fit</span></div>
                    </div>
                    <input class="offstage-ai-result-favorite" value="${escapeHtml(item.value)}" aria-label="Favorite value">
                    <div class="offstage-ai-rationale">${escapeHtml(item.rationale)}</div>
                    <input type="hidden" class="offstage-ai-result-provenance" value="${escapeHtml(item.provenance)}">
                    <input type="hidden" class="offstage-ai-result-rationale-hidden" value="${escapeHtml(item.rationale)}">
                </div>
            </article>`).join('')}
        <div class="offstage-ai-actions">
            <button type="button" class="menu_button offstage-ai-primary" id="offstage-ai-add-selected">Add selected to Offstage</button>
            <button type="button" class="menu_button" id="offstage-ai-regenerate">Regenerate</button>
        </div>
    </div>`;

    document.getElementById('offstage-ai-add-selected')?.addEventListener('click', addSelected);
    document.getElementById('offstage-ai-regenerate')?.addEventListener('click', () => {
        const target = document.getElementById(SHEET_ID)?.dataset.target;
        if (target) void generateSuggestions(target);
    });
}

async function generateSuggestions(target) {
    if (generating) return;
    const character = currentCharacter();
    if (!character) return;
    const settings = getSettings();
    const count = clamp(document.getElementById('offstage-ai-count')?.value, 1, 8, 3);
    const section = String(document.getElementById('offstage-ai-section')?.value || 'auto');
    const category = String(document.getElementById('offstage-ai-category')?.value || '').trim();
    const guidance = String(document.getElementById('offstage-ai-guidance')?.value || '').trim();
    const allowHeadcanon = Boolean(document.getElementById('offstage-ai-headcanon')?.checked);
    if (settings) { settings.aiFill.allowHeadcanon = allowHeadcanon; save(); }

    const button = document.getElementById('offstage-ai-generate');
    const host = document.getElementById('offstage-ai-results');
    generating = true;
    if (button) { button.disabled = true; button.textContent = '✦ Thinking…'; }
    if (host) host.innerHTML = `<div class="offstage-ai-status">Reading ${escapeHtml(character.name)}'s card and recent RP through <strong>${escapeHtml(connectionLabel())}</strong>…</div>`;

    try {
        const raw = await generateWithRoleplayConnection(
            systemPrompt(target, allowHeadcanon),
            userPrompt(target, count, section, category, guidance, allowHeadcanon),
            1200,
        );
        const parsed = parseJson(raw);
        const suggestions = (Array.isArray(parsed?.suggestions) ? parsed.suggestions : [])
            .map(x => normalizeSuggestion(x, target)).filter(Boolean).slice(0, count);
        renderResults(suggestions);
    } catch (error) {
        console.error('[Offstage AI Fill] generation failed', error);
        if (host) host.innerHTML = `<div class="offstage-ai-status"><strong>AI Fill failed.</strong><br>${escapeHtml(error?.message || String(error))}<br><br>Connection: ${escapeHtml(connectionLabel())}</div>`;
        globalThis.toastr?.error?.(`AI Fill failed: ${error?.message || 'unknown error'}`, 'Offstage');
    } finally {
        generating = false;
        if (button) { button.disabled = false; button.textContent = '✦ Generate suggestions'; }
    }
}

function addSelected() {
    const profile = currentProfile();
    const sheet = document.getElementById(SHEET_ID);
    if (!profile || !sheet) return;

    let added = 0;
    for (const card of sheet.querySelectorAll('.offstage-ai-result')) {
        if (!card.querySelector('.offstage-ai-select')?.checked) continue;
        const type = card.dataset.type;
        const provenance = card.querySelector('.offstage-ai-result-provenance')?.value || 'headcanon';
        const rationale = card.querySelector('.offstage-ai-result-rationale-hidden')?.value || '';

        if (type === 'trait') {
            const name = String(card.querySelector('.offstage-ai-result-name')?.value || '').trim();
            const section = card.querySelector('.offstage-ai-result-section')?.value || 'private';
            const value = clamp(card.querySelector('.offstage-ai-result-value')?.value, 0, 100, 65);
            if (!name) continue;
            const duplicate = ['public','private','hidden'].some(s => (profile.personality?.[s] || []).some(x => norm(x.name) === norm(name)));
            if (duplicate) continue;
            profile.personality[section] ??= [];
            profile.personality[section].push({
                id: uid('trait'), name, value, provenance,
                awareness: section === 'hidden' ? 'low' : 'moderate',
                note: rationale, evidence: [], source: 'ai-fill', createdAt: Date.now(),
            });
            added++;
        }

        if (type === 'favorite') {
            const category = String(card.querySelector('.offstage-ai-result-category')?.value || '').trim();
            const value = String(card.querySelector('.offstage-ai-result-favorite')?.value || '').trim();
            if (!category || !value) continue;
            const duplicate = (profile.favorites || []).some(x => norm(x.category) === norm(category) && norm(x.value) === norm(value));
            if (duplicate) continue;
            profile.favorites.push({
                id: uid('favorite'), category, value, icon: '♡', provenance,
                hidden: false, revealed: true, discovery: 100,
                note: rationale, evidence: [], source: 'ai-fill', createdAt: Date.now(),
            });
            added++;
        }
    }

    save();
    const active = document.querySelector('#offstage-root.is-open .offstage-tab.is-active');
    if (active instanceof HTMLElement) requestAnimationFrame(() => active.click());
    closeSheet();
    globalThis.toastr?.success?.(added ? `Added ${added} AI-assisted ${added === 1 ? 'detail' : 'details'} to Offstage.` : 'Nothing new was added.', 'Offstage');
}

function bindClicks() {
    document.addEventListener('click', event => {
        const button = event.target instanceof Element ? event.target.closest('[data-offstage-ai-fill]') : null;
        if (!(button instanceof HTMLElement)) return;
        event.preventDefault();
        event.stopPropagation();
        openSheet(button.dataset.offstageAiFill);
    });
}

function startObserver() {
    observer?.disconnect();
    observer = new MutationObserver(() => injectButtons());
    observer.observe(document.body, { childList: true, subtree: true });
    injectButtons();
}

export function initAiFill() {
    if (initialized) { injectButtons(); return; }
    initialized = true;
    ensureStyles();
    getSettings();
    bindClicks();
    startObserver();
    console.info(`[Offstage AI Fill] v${AI_FILL_VERSION} initialized`);
}

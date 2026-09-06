/**
 * Offstage — shared core.
 * Single source of truth for settings, the profile schema, character lookup,
 * prompt-context builders, and the internal event bus.
 */

export const VERSION = '0.8.0';
export const EXTENSION_KEY = 'offstage';
export const SCHEMA_VERSION = 2;

export const THEMES = ['rosewater', 'midnight', 'paper', 'velvet', 'noir', 'foxglove'];
export const SECTIONS = ['public', 'private', 'hidden'];
export const PROVENANCE = ['canon', 'established', 'inferred', 'emergent', 'headcanon'];

export const JOURNAL_KINDS = [
    ['entry', 'Diary entry'],
    ['letter', 'Unsent letter'],
    ['note', 'Note to self'],
    ['dream', 'Dream'],
];

export const SOCIAL_ACCOUNTS = [
    ['main', 'Public account'],
    ['alt', 'Private account'],
    ['close', 'Close friends'],
    ['draft', 'Never posted'],
];

export const PLAYLIST_KINDS = [
    ['alltime', 'All-time favourites'],
    ['rotation', 'Current rotation'],
    ['relationship', 'About someone'],
    ['guilty', 'Guilty pleasures'],
    ['scene', 'Tied to a scene'],
];

export const labelFor = (list, value) => list.find(([key]) => key === value)?.[1] ?? value;

/* ---------------------------------------------------------------- utilities */

export const ctx = () => globalThis.SillyTavern?.getContext?.();

export function clamp(value, min, max, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

export function norm(value = '') {
    return String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function uid(prefix = 'off') {
    const random = globalThis.crypto?.randomUUID?.();
    return random ? `${prefix}-${random}` : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function escapeHtml(value = '') {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

export function clip(value, max = 5000) {
    const text = String(value ?? '').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function debounce(fn, wait = 200) {
    let timer = null;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), wait);
    };
}

export const toast = {
    success: (message) => globalThis.toastr?.success?.(message, 'Offstage'),
    info: (message) => globalThis.toastr?.info?.(message, 'Offstage'),
    warning: (message) => globalThis.toastr?.warning?.(message, 'Offstage'),
    error: (message, options) => globalThis.toastr?.error?.(message, 'Offstage', options),
};

export function applyTheme(element) {
    if (!(element instanceof HTMLElement)) return;
    element.classList.add('offstage-theme');
    element.dataset.theme = currentTheme();
}

/* -------------------------------------------------------------- event bus */

const bus = new EventTarget();

/** Profile data changed and any open view should re-render. */
export const CHANGED = 'offstage:changed';
/** A UI control was activated. Feature modules listen instead of binding their own document listeners. */
export const ACTION = 'offstage:action';

export function emit(type, detail = {}) {
    bus.dispatchEvent(new CustomEvent(type, { detail }));
}

export function on(type, handler) {
    bus.addEventListener(type, handler);
    return () => bus.removeEventListener(type, handler);
}

/* --------------------------------------------------------------- settings */

function defaultSettings() {
    return {
        schemaVersion: SCHEMA_VERSION,
        profiles: {},
        ui: { lastTab: 'profile', showLauncher: true },
        analysis: {
            enabled: true,
            interval: 5,
            contextMessages: 24,
            updateTransient: true,
            // Name of a chat-completion preset whose generation settings override
            // the connection profile's own. Empty means use the profile's preset.
            preset: '',
            history: {},
            lastStatus: 'Ready',
            journal: { enabled: true, threshold: 0.7, minReplies: 8, maxQueued: 2 },
            social: { enabled: true, interval: 5, maxQueued: 3 },
        },
        aiFill: { allowHeadcanon: true, contextMessages: 30 },
    };
}

export function getSettings() {
    const context = ctx();
    if (!context?.extensionSettings) return null;

    context.extensionSettings[EXTENSION_KEY] ??= defaultSettings();
    const root = context.extensionSettings[EXTENSION_KEY];

    const defaults = defaultSettings();
    root.profiles ??= {};
    root.ui ??= defaults.ui;
    root.ui.lastTab ??= 'profile';
    if (typeof root.ui.showLauncher !== 'boolean') root.ui.showLauncher = true;

    root.analysis ??= {};
    for (const [key, value] of Object.entries(defaults.analysis)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            root.analysis[key] ??= {};
            for (const [inner, fallback] of Object.entries(value)) root.analysis[key][inner] ??= fallback;
        } else {
            root.analysis[key] ??= value;
        }
    }

    root.aiFill ??= {};
    for (const [key, value] of Object.entries(defaults.aiFill)) root.aiFill[key] ??= value;

    root.schemaVersion = SCHEMA_VERSION;
    return root;
}

export function save() {
    ctx()?.saveSettingsDebounced?.();
}

/**
 * Analysis history is keyed per character+chat and otherwise grows forever
 * inside settings.json. Keep the most recent entries only.
 */
export function pruneHistory(keep = 60) {
    const settings = getSettings();
    const history = settings?.analysis?.history;
    if (!history) return;
    const entries = Object.entries(history);
    if (entries.length <= keep) return;
    entries.sort((a, b) => (b[1]?.lastAt || 0) - (a[1]?.lastAt || 0));
    settings.analysis.history = Object.fromEntries(entries.slice(0, keep));
}

/* -------------------------------------------------------------- character */

export function isGroupChat() {
    return Boolean(ctx()?.groupId);
}

export function getCurrentCharacter() {
    const context = ctx();
    if (!context || context.groupId) return null;
    if (context.characterId === undefined || context.characterId === null) return null;
    return context.characters?.[context.characterId] ?? null;
}

export function getCharacterKey(character = getCurrentCharacter()) {
    if (!character) return null;
    return character.avatar || character.name || `character-${ctx()?.characterId ?? 'unknown'}`;
}

export function getCharacterImage(character = getCurrentCharacter()) {
    if (!character?.avatar) return '';
    try {
        const url = ctx()?.getThumbnailUrl?.('avatar', character.avatar);
        if (url) return url;
    } catch (error) {
        console.warn('[Offstage] Thumbnail lookup failed:', error);
    }
    return `characters/${encodeURIComponent(character.avatar)}`;
}

/* ---------------------------------------------------------------- profile */

export function defaultProfile() {
    return {
        schemaVersion: SCHEMA_VERSION,
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
        handles: { main: '', alt: '', close: '' },
        analysisMeta: {},
    };
}

/** Bring a profile saved by an older build up to the current shape, in place. */
export function migrateProfile(profile) {
    if (!profile || typeof profile !== 'object') return defaultProfile();

    profile.personality ??= {};
    for (const section of SECTIONS) {
        if (!Array.isArray(profile.personality[section])) profile.personality[section] = [];
    }
    if (!Array.isArray(profile.favorites)) profile.favorites = [];
    if (!Array.isArray(profile.discoveries)) profile.discoveries = [];
    if (!Array.isArray(profile.journal)) profile.journal = [];
    if (!Array.isArray(profile.social)) profile.social = [];
    if (!Array.isArray(profile.playlists)) profile.playlists = [];
    profile.analysisMeta ??= {};
    profile.handles ??= {};
    for (const account of ['main', 'alt', 'close']) profile.handles[account] ??= '';

    profile.tagline ??= '';
    profile.mood ??= 'Unwritten';
    profile.currentState ??= 'Waiting to be discovered';
    profile.energy = clamp(profile.energy, 0, 100, 50);
    if (!THEMES.includes(profile.theme)) profile.theme = 'rosewater';

    // Older builds stored favorites without the reveal fields.
    for (const favorite of profile.favorites) {
        favorite.hidden = favorite.hidden === true;
        if (typeof favorite.revealed !== 'boolean') favorite.revealed = !favorite.hidden;
        favorite.discovery = clamp(favorite.discovery, 0, 100, favorite.hidden ? 25 : 100);
    }

    for (const entry of profile.journal) {
        entry.kind = JOURNAL_KINDS.some(([key]) => key === entry.kind) ? entry.kind : 'entry';
        entry.hidden = entry.hidden === true;
        if (typeof entry.revealed !== 'boolean') entry.revealed = !entry.hidden;
        entry.body = String(entry.body ?? '');
    }

    for (const post of profile.social) {
        post.account = SOCIAL_ACCOUNTS.some(([key]) => key === post.account) ? post.account : 'main';
        post.hidden = post.hidden === true;
        if (typeof post.revealed !== 'boolean') post.revealed = !post.hidden;
        post.body = String(post.body ?? '');
        if (!Array.isArray(post.comments)) post.comments = [];
        post.likes = clamp(post.likes, 0, 9999999, 0);
    }

    for (const playlist of profile.playlists) {
        playlist.kind = PLAYLIST_KINDS.some(([key]) => key === playlist.kind) ? playlist.kind : 'rotation';
        if (!Array.isArray(playlist.tracks)) playlist.tracks = [];
        playlist.name = String(playlist.name || 'Untitled playlist');
    }

    profile.schemaVersion = SCHEMA_VERSION;
    return profile;
}

export function getProfile(create = true) {
    const settings = getSettings();
    const key = getCharacterKey();
    if (!settings || !key) return null;

    if (!settings.profiles[key]) {
        if (!create) return null;
        settings.profiles[key] = defaultProfile();
        save();
    }
    return migrateProfile(settings.profiles[key]);
}

export function currentTheme() {
    const settings = getSettings();
    const key = getCharacterKey();
    const theme = key ? settings?.profiles?.[key]?.theme : null;
    return THEMES.includes(theme) ? theme : 'rosewater';
}

/* ------------------------------------------------------- prompt builders */

function cardField(character, key) {
    return character?.[key] ?? character?.data?.[key] ?? '';
}

export function buildCardContext(character, { includeFirstMessage = false } = {}) {
    const fields = [
        ['Description', cardField(character, 'description')],
        ['Personality', cardField(character, 'personality')],
        ['Scenario', cardField(character, 'scenario')],
        ...(includeFirstMessage ? [['First message', cardField(character, 'first_mes')]] : []),
        ['Example dialogue', cardField(character, 'mes_example')],
    ];
    return fields
        .filter(([, value]) => String(value ?? '').trim())
        .map(([label, value]) => `${label}:\n${clip(value, 4500)}`)
        .join('\n\n');
}

export function buildTranscript(limit = 24, { budget = 22000, minRows = 6, perMessage = 3500 } = {}) {
    const context = ctx();
    const name = getCurrentCharacter()?.name || 'CHARACTER';
    const recent = (Array.isArray(context?.chat) ? context.chat : [])
        .filter(message => !message?.is_system && String(message?.mes ?? '').trim())
        .slice(-limit);

    const rows = [];
    let total = 0;
    for (let index = recent.length - 1; index >= 0; index--) {
        const message = recent[index];
        const role = message.is_user ? 'USER' : String(message.name || name).toUpperCase();
        const row = `${role}:\n${clip(message.mes, perMessage)}`;
        if (total + row.length > budget && rows.length >= minRows) break;
        rows.unshift(row);
        total += row.length;
    }
    return rows.join('\n\n');
}

export function buildExistingState(profile, { includeQueued = true } = {}) {
    if (!profile) return '';
    const traits = SECTIONS.flatMap(section =>
        (profile.personality?.[section] || []).map(item =>
            `${section}: ${item.name} (${item.provenance || 'unknown'}, ${item.value ?? 50})`));
    const favorites = (profile.favorites || []).map(item =>
        `${item.category || 'favorite'}: ${item.value || 'unknown'} (${item.provenance || 'unknown'})`);
    const queued = (profile.discoveries || []).map(item =>
        `${item.target || item.type || 'discovery'}: ${item.title}`);

    const journal = (profile.journal || []).map(item =>
        `${item.date || 'undated'} (${item.kind || 'entry'}): ${clip(item.body, 90)}`);
    const social = (profile.social || []).map(item =>
        `${item.account || 'main'}: ${clip(item.body, 90)}`);
    const music = (profile.playlists || []).map(item =>
        `${item.name}: ${(item.tracks || []).map(track => `${track.title}${track.artist ? ` — ${track.artist}` : ''}`).join('; ') || '(empty)'}`);

    return [
        traits.length ? `Known traits:\n- ${traits.join('\n- ')}` : '',
        favorites.length ? `Known favorites:\n- ${favorites.join('\n- ')}` : '',
        journal.length ? `Existing journal entries:\n- ${journal.join('\n- ')}` : '',
        social.length ? `Existing posts:\n- ${social.join('\n- ')}` : '',
        music.length ? `Existing playlists:\n- ${music.join('\n- ')}` : '',
        includeQueued && queued.length ? `Already queued for approval:\n- ${queued.join('\n- ')}` : '',
    ].filter(Boolean).join('\n\n');
}

/* ------------------------------------------------------- duplicate checks */

export function traitExists(profile, name) {
    return SECTIONS.some(section =>
        (profile?.personality?.[section] || []).some(item => norm(item.name) === norm(name)));
}

export function favoriteExists(profile, category, value) {
    return (profile?.favorites || []).some(item =>
        norm(item.category) === norm(category) && norm(item.value) === norm(value));
}

/** Long-form text is compared on its opening words; models rarely repeat verbatim. */
const opening = (value = '') => norm(value).split(' ').slice(0, 12).join(' ');

export function journalExists(profile, body) {
    return (profile?.journal || []).some(item => opening(item.body) === opening(body));
}

export function postExists(profile, body) {
    return (profile?.social || []).some(item => opening(item.body) === opening(body));
}

export function trackExists(profile, playlistName, title) {
    return (profile?.playlists || []).some(playlist =>
        (!playlistName || norm(playlist.name) === norm(playlistName))
        && (playlist.tracks || []).some(track => norm(track.title) === norm(title)));
}

export function alreadyKnown(profile, candidate) {
    if (!profile || !candidate) return false;
    switch (candidate.target) {
        case 'favorite': return favoriteExists(profile, candidate.category, candidate.favoriteValue);
        case 'journal': return journalExists(profile, candidate.body);
        case 'social': return postExists(profile, candidate.body);
        case 'track': return trackExists(profile, candidate.playlist, candidate.title);
        default: return traitExists(profile, candidate.title);
    }
}

export function alreadyQueued(profile, candidate) {
    return (profile?.discoveries || []).some(item => {
        if ((item.target || '') !== (candidate.target || '')) return false;
        switch (candidate.target) {
            case 'favorite':
                return norm(item.category) === norm(candidate.category)
                    && norm(item.favoriteValue) === norm(candidate.favoriteValue);
            case 'journal':
            case 'social':
                return opening(item.body) === opening(candidate.body);
            case 'track':
                return norm(item.title) === norm(candidate.title)
                    && norm(item.playlist) === norm(candidate.playlist);
            default:
                return norm(item.title) === norm(candidate.title);
        }
    });
}

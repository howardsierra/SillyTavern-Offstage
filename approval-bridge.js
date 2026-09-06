const EXTENSION_KEY = 'offstage';
const BRIDGE_VERSION = '0.5.1';
const AI_FILL_SOURCE = 'ai-fill-approval';
let initialized = false;
let observer = null;

const context = () => globalThis.SillyTavern?.getContext?.();
const norm = (value = '') => String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const uid = (prefix = 'off-approval') => globalThis.crypto?.randomUUID?.()
    ? `${prefix}-${globalThis.crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const clamp = (value, min, max, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
};

function settings() {
    const ctx = context();
    if (!ctx?.extensionSettings) return null;
    ctx.extensionSettings[EXTENSION_KEY] ??= { schemaVersion: 1, profiles: {}, ui: { lastTab: 'profile' } };
    ctx.extensionSettings[EXTENSION_KEY].profiles ??= {};
    ctx.extensionSettings[EXTENSION_KEY].ui ??= { lastTab: 'profile' };
    return ctx.extensionSettings[EXTENSION_KEY];
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
    const root = settings();
    const key = characterKey();
    if (!root || !key) return null;
    if (!root.profiles[key] && create) {
        root.profiles[key] = {
            schemaVersion: 1,
            tagline: '', mood: 'Unwritten', currentState: 'Waiting to be discovered', energy: 50,
            theme: 'rosewater', personality: { public: [], private: [], hidden: [] },
            favorites: [], discoveries: [], journal: [], social: [], playlists: [],
        };
    }
    const profile = root.profiles[key];
    profile.personality ??= { public: [], private: [], hidden: [] };
    profile.favorites ??= [];
    profile.discoveries ??= [];
    return profile;
}

function connectionLabel() {
    const manager = context()?.extensionSettings?.connectionManager;
    const id = manager?.selectedProfile;
    if (!id) return 'active SillyTavern connection';
    const profile = Array.isArray(manager?.profiles) ? manager.profiles.find(item => item.id === id) : null;
    return profile ? `${profile.name || 'RP connection profile'} · ${profile.model || profile.api || 'model'}` : 'RP connection profile';
}

function parseConfidence(card) {
    const text = card.querySelector('.offstage-ai-meta')?.textContent || '';
    const match = text.match(/(\d{1,3})%\s*fit/i);
    return match ? clamp(Number(match[1]) / 100, 0, 1, 0.7) : 0.7;
}

function queuedDuplicate(profile, candidate) {
    return (profile.discoveries || []).some(item => {
        if (item.target !== candidate.target) return false;
        if (candidate.target === 'favorite') {
            return norm(item.category) === norm(candidate.category) && norm(item.favoriteValue) === norm(candidate.favoriteValue);
        }
        return norm(item.title) === norm(candidate.title);
    });
}

function acceptedDuplicate(profile, candidate) {
    if (candidate.target === 'favorite') {
        return (profile.favorites || []).some(item =>
            norm(item.category) === norm(candidate.category) && norm(item.value) === norm(candidate.favoriteValue));
    }
    return ['public', 'private', 'hidden'].some(section =>
        (profile.personality?.[section] || []).some(item => norm(item.name) === norm(candidate.title)));
}

function candidateFromCard(card) {
    const type = card.dataset.type;
    const provenance = card.querySelector('.offstage-ai-result-provenance')?.value || 'headcanon';
    const rationale = String(card.querySelector('.offstage-ai-result-rationale-hidden')?.value || '').trim();
    const confidence = parseConfidence(card);

    if (type === 'trait') {
        const title = String(card.querySelector('.offstage-ai-result-name')?.value || '').trim();
        const section = card.querySelector('.offstage-ai-result-section')?.value || 'private';
        const value = clamp(card.querySelector('.offstage-ai-result-value')?.value, 0, 100, 65);
        if (!title) return null;
        return {
            id: uid('discovery'), source: AI_FILL_SOURCE, target: 'trait',
            type: 'AI Fill · Personality', title,
            section: ['public', 'private', 'hidden'].includes(section) ? section : 'private',
            value, provenance, confidence,
            summary: rationale || `AI Fill proposed ${title} as a fitting personality trait.`,
            reason: rationale || `Generated on request using ${connectionLabel()} after reading the character card and recent RP.`,
            createdAt: Date.now(),
        };
    }

    if (type === 'favorite') {
        const category = String(card.querySelector('.offstage-ai-result-category')?.value || '').trim();
        const favoriteValue = String(card.querySelector('.offstage-ai-result-favorite')?.value || '').trim();
        if (!category || !favoriteValue) return null;
        return {
            id: uid('discovery'), source: AI_FILL_SOURCE, target: 'favorite',
            type: 'AI Fill · Favorite', title: `Favorite ${category}`,
            category, favoriteValue, section: 'private', provenance, confidence,
            summary: rationale || `AI Fill proposed ${favoriteValue} for ${category}.`,
            reason: rationale || `Generated on request using ${connectionLabel()} after reading the character card and recent RP.`,
            createdAt: Date.now(),
        };
    }

    return null;
}

function refreshOffstage(preferDiscoveries = false) {
    const root = settings();
    if (preferDiscoveries && root?.ui) {
        root.ui.lastTab = 'discoveries';
        save();
    }
    const openRoot = document.querySelector('#offstage-root.is-open');
    if (!openRoot) return;
    const button = preferDiscoveries
        ? openRoot.querySelector('[data-tab="discoveries"]')
        : openRoot.querySelector('.offstage-tab.is-active');
    if (button instanceof HTMLElement) requestAnimationFrame(() => button.click());
}

function queueSelected(event, button) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const profile = currentProfile();
    const sheet = document.getElementById('offstage-ai-fill-sheet');
    if (!profile || !sheet) return;

    let queued = 0;
    let skipped = 0;
    for (const card of sheet.querySelectorAll('.offstage-ai-result')) {
        if (!card.querySelector('.offstage-ai-select')?.checked) continue;
        const candidate = candidateFromCard(card);
        if (!candidate) continue;
        if (acceptedDuplicate(profile, candidate) || queuedDuplicate(profile, candidate)) {
            skipped++;
            continue;
        }
        profile.discoveries.unshift(candidate);
        queued++;
    }

    save();
    sheet.remove();
    refreshOffstage(true);

    if (queued) {
        globalThis.toastr?.success?.(
            `${queued} AI ${queued === 1 ? 'suggestion is' : 'suggestions are'} waiting in the Discovery Inbox. Nothing has been added yet.`,
            'Offstage'
        );
    } else {
        globalThis.toastr?.info?.(skipped ? 'Those suggestions are already accepted or already waiting for approval.' : 'No suggestions were selected.', 'Offstage');
    }
}

function removeDiscovery(profile, item) {
    profile.discoveries = (profile.discoveries || []).filter(entry => entry.id !== item.id);
}

function approveDiscovery(profile, item, keepHidden = false) {
    if (acceptedDuplicate(profile, item)) {
        removeDiscovery(profile, item);
        save();
        refreshOffstage();
        globalThis.toastr?.info?.('That detail is already in the character profile, so the duplicate proposal was removed.', 'Offstage');
        return;
    }

    if (item.target === 'favorite') {
        const hidden = keepHidden;
        profile.favorites.push({
            id: uid('favorite'),
            category: item.category || item.title || 'Favorite',
            value: item.favoriteValue || 'Unknown',
            icon: '♡',
            provenance: item.provenance || 'headcanon',
            hidden,
            revealed: !hidden,
            discovery: hidden ? Math.round(clamp(item.confidence, 0, 1, 0.7) * 100) : 100,
            note: item.summary || '',
            evidence: item.reason ? [item.reason] : [],
            source: 'ai-fill-approved',
            createdAt: Date.now(),
        });
    } else {
        const section = keepHidden ? 'hidden' : (['public', 'private', 'hidden'].includes(item.section) ? item.section : 'private');
        profile.personality[section] ??= [];
        profile.personality[section].push({
            id: uid('trait'),
            name: item.title || 'Unnamed trait',
            value: clamp(item.value, 0, 100, 65),
            provenance: item.provenance || 'headcanon',
            awareness: section === 'hidden' ? 'low' : 'moderate',
            note: item.summary || '',
            evidence: item.reason ? [item.reason] : [],
            source: 'ai-fill-approved',
            createdAt: Date.now(),
        });
    }

    removeDiscovery(profile, item);
    save();
    refreshOffstage();
    globalThis.toastr?.success?.('Approved and added to Offstage.', 'Offstage');
}

function editDiscovery(profile, item) {
    if (item.target === 'favorite') {
        const category = globalThis.prompt?.('Favorite category', item.category || '') ?? item.category;
        if (category === null) return;
        const value = globalThis.prompt?.('Favorite / preference', item.favoriteValue || '') ?? item.favoriteValue;
        if (value === null) return;
        item.category = String(category).trim() || item.category;
        item.favoriteValue = String(value).trim() || item.favoriteValue;
        item.title = `Favorite ${item.category}`;
    } else {
        const title = globalThis.prompt?.('Trait name', item.title || '') ?? item.title;
        if (title === null) return;
        const section = globalThis.prompt?.('Visibility: public, private, or hidden', item.section || 'private') ?? item.section;
        if (section === null) return;
        const value = globalThis.prompt?.('Trait strength (0-100)', String(item.value ?? 65)) ?? String(item.value ?? 65);
        if (value === null) return;
        item.title = String(title).trim() || item.title;
        item.section = ['public', 'private', 'hidden'].includes(String(section).trim().toLowerCase()) ? String(section).trim().toLowerCase() : item.section;
        item.value = clamp(value, 0, 100, item.value ?? 65);
    }
    const rationale = globalThis.prompt?.('Rationale / notes', item.summary || '') ?? item.summary;
    if (rationale !== null) {
        item.summary = String(rationale).trim();
        item.reason = String(rationale).trim();
    }
    save();
    refreshOffstage();
}

function handleDiscoveryAction(event, button) {
    const card = button.closest('[data-discovery-id]');
    if (!(card instanceof HTMLElement)) return;
    const profile = currentProfile(false);
    const item = profile?.discoveries?.find(entry => entry.id === card.dataset.discoveryId);
    if (!item || item.source !== AI_FILL_SOURCE) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    if (button.classList.contains('offstage-reject-discovery')) {
        removeDiscovery(profile, item);
        save();
        refreshOffstage();
        globalThis.toastr?.info?.('AI suggestion rejected.', 'Offstage');
        return;
    }
    if (button.classList.contains('offstage-edit-discovery')) {
        editDiscovery(profile, item);
        return;
    }
    approveDiscovery(profile, item, button.classList.contains('offstage-hide-discovery'));
}

function retitleAiFillControls() {
    const add = document.getElementById('offstage-ai-add-selected');
    if (add) {
        add.textContent = 'Send selected to Discovery Inbox';
        add.title = 'Queue these suggestions for final approval. Nothing is added to the profile yet.';
    }
    const results = document.querySelector('#offstage-ai-fill-sheet .offstage-ai-results .offstage-ai-kicker');
    if (results && /^Suggestions/i.test(results.textContent || '')) {
        results.textContent = 'Suggestions · edit first, then send for approval';
    }
}

function bindCapture() {
    document.addEventListener('click', event => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;

        const addButton = target.closest('#offstage-ai-add-selected');
        if (addButton instanceof HTMLElement) {
            queueSelected(event, addButton);
            return;
        }

        const discoveryButton = target.closest('.offstage-accept-discovery, .offstage-hide-discovery, .offstage-reject-discovery, .offstage-edit-discovery');
        if (discoveryButton instanceof HTMLElement) handleDiscoveryAction(event, discoveryButton);
    }, true);
}

export function initApprovalBridge() {
    if (initialized) return;
    initialized = true;
    bindCapture();
    retitleAiFillControls();
    observer = new MutationObserver(retitleAiFillControls);
    observer.observe(document.body, { childList: true, subtree: true });
    console.info(`[Offstage Approval Bridge] v${BRIDGE_VERSION} initialized`);
}

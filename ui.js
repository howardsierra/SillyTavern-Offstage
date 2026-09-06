/**
 * Offstage — panel UI.
 * Owns the drawer markup, the shared modal, and every DOM event inside them.
 * Feature modules never bind their own document listeners; they listen on the
 * core event bus for ACTION and re-render by emitting CHANGED.
 */

import {
    ACTION, CHANGED, PROVENANCE, SECTIONS, THEMES,
    applyTheme, clamp, ctx, emit, escapeHtml, getCharacterImage, getCurrentCharacter,
    getProfile, getSettings, isGroupChat, on, save, uid,
} from './core.js';
import { MODAL_ID, openModal } from './modal.js';
import { lifePage } from './life.js';

const ROOT_ID = 'offstage-root';

const TABS = [
    ['profile', 'Profile'],
    ['personality', 'Personality'],
    ['favorites', 'Favorites'],
    ['discoveries', 'Discoveries'],
    ['journal', 'Journal'],
    ['social', 'Social'],
    ['music', 'Music'],
];

let activeTab = 'profile';
let lastFocused = null;

/* ------------------------------------------------------------------ theme */

function refreshThemedElements() {
    for (const element of document.querySelectorAll('.offstage-theme')) applyTheme(element);
}

/* ------------------------------------------------------------- open/close */

export { applyTheme } from './core.js';

export function isOpen() {
    return document.getElementById(ROOT_ID)?.classList.contains('is-open') === true;
}

export function openPanel() {
    lastFocused = document.activeElement;
    let root = document.getElementById(ROOT_ID);
    if (!root) {
        root = document.createElement('div');
        root.id = ROOT_ID;
        document.body.appendChild(root);
        bindRoot(root);
    }
    root.classList.add('is-open');
    activeTab = getStoredTab();
    render();
    requestAnimationFrame(() => {
        root.querySelector('.off-tab.is-active')?.focus({ preventScroll: true });
    });
}

export function closePanel() {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    root.classList.remove('is-open');
    root.innerHTML = '';
    if (lastFocused instanceof HTMLElement && document.contains(lastFocused)) {
        lastFocused.focus({ preventScroll: true });
    }
    lastFocused = null;
}

export function togglePanel() {
    isOpen() ? closePanel() : openPanel();
}

function getStoredTab() {
    const stored = getSettings()?.ui?.lastTab;
    return TABS.some(([id]) => id === stored) ? stored : 'profile';
}

function setTab(tab) {
    if (tab !== activeTab) emit(ACTION, { type: 'tab-changed', tab });
    activeTab = tab;
    const settings = getSettings();
    if (settings) {
        settings.ui.lastTab = tab;
        save();
    }
    render({ resetScroll: true });
}

export function goToTab(tab) {
    if (!TABS.some(([id]) => id === tab)) return;
    if (!isOpen()) openPanel();
    setTab(tab);
}

/* ----------------------------------------------------------------- render */

export function refresh({ resetScroll = false } = {}) {
    if (isOpen()) render({ resetScroll });
    refreshThemedElements();
}

function render({ resetScroll = false } = {}) {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;

    const previousScroll = resetScroll ? 0 : (root.querySelector('.off-content')?.scrollTop ?? 0);
    applyTheme(root);

    const character = getCurrentCharacter();
    const profile = character ? getProfile() : null;

    root.innerHTML = (!character || !profile)
        ? shell(unavailableState())
        : shell(panelBody(character, profile));

    const content = root.querySelector('.off-content');
    if (content) content.scrollTop = previousScroll;
}

function shell(inner) {
    return `<section class="off-shell" role="dialog" aria-modal="false" aria-label="Offstage character dossier">${inner}</section>`;
}

function closeButton() {
    return `<button class="off-close" type="button" data-action="close" aria-label="Close Offstage"><span aria-hidden="true">×</span><span class="off-close-word">Close</span></button>`;
}

function unavailableState() {
    const message = isGroupChat()
        ? { title: 'One character at a time', body: 'Offstage keeps a separate dossier per character. Open a single-character chat to build one.' }
        : { title: 'No character open', body: 'Start a chat with a character and their dossier appears here.' };

    return `
        <header class="off-hero off-hero-blank">
            ${closeButton()}
            <p class="off-wordmark">Offstage</p>
        </header>
        <div class="off-content">
            ${emptyState(message.title, message.body)}
        </div>`;
}

function panelBody(character, profile) {
    const image = getCharacterImage(character);
    const pending = profile.discoveries.length;

    return `
        <header class="off-hero">
            ${image ? `<img class="off-hero-image" src="${escapeHtml(image)}" alt="">` : ''}
            <div class="off-hero-scrim"></div>
            ${closeButton()}
            <p class="off-wordmark">Offstage</p>
            <div class="off-hero-copy">
                <h1 class="off-name">${escapeHtml(character.name || 'Unknown character')}</h1>
                <button class="off-tagline" type="button" data-action="edit-tagline">
                    ${profile.tagline
                        ? escapeHtml(profile.tagline)
                        : '<span class="off-tagline-empty">Write a private tagline</span>'}
                </button>
                <dl class="off-callsheet">
                    ${callsheetRow('Mood', profile.mood || 'Unwritten', 'mood')}
                    ${callsheetRow('Currently', profile.currentState || 'Waiting to be discovered', 'currentState')}
                    ${callsheetRow('Energy', `${clamp(profile.energy, 0, 100, 50)}%`, 'energy')}
                </dl>
            </div>
        </header>

        <nav class="off-tabs" role="tablist" aria-label="Dossier sections">
            ${TABS.map(([id, label]) => {
                const isActive = activeTab === id;
                const badge = id === 'discoveries' && pending
                    ? `<span class="off-tab-badge">${pending}</span>` : '';
                return `<button class="off-tab ${isActive ? 'is-active' : ''}" type="button" role="tab"
                    aria-selected="${isActive}" data-action="tab" data-tab="${id}">${label}${badge}</button>`;
            }).join('')}
        </nav>

        <div class="off-content" role="tabpanel">${page(character, profile)}</div>`;
}

function callsheetRow(label, value, field) {
    return `
        <div class="off-callsheet-row">
            <dt>${escapeHtml(label)}</dt>
            <dd><button type="button" data-action="edit-field" data-field="${field}">${escapeHtml(value)}</button></dd>
        </div>`;
}

/* ------------------------------------------------------------------ pages */

function page(character, profile) {
    switch (activeTab) {
        case 'profile': return profilePage(character, profile);
        case 'personality': return personalityPage(profile);
        case 'favorites': return favoritesPage(profile);
        case 'discoveries': return discoveriesPage(profile);
        default: return lifePage(activeTab, profile);
    }
}

function profilePage(character, profile) {
    const traitCount = SECTIONS.reduce((total, section) => total + profile.personality[section].length, 0);
    const revealed = profile.favorites.filter(item => !item.hidden || item.revealed).length;
    const pending = profile.discoveries.length;

    return `
        <div class="off-page">
            <div class="off-page-head">
                <h2>What we know so far</h2>
                <label class="off-theme">
                    <span>Theme</span>
                    <select data-action="theme">
                        ${THEMES.map(theme => `<option value="${theme}" ${profile.theme === theme ? 'selected' : ''}>${theme[0].toUpperCase() + theme.slice(1)}</option>`).join('')}
                    </select>
                </label>
            </div>

            <div class="off-tally">
                ${tally(traitCount, traitCount === 1 ? 'trait' : 'traits', 'personality')}
                ${tally(revealed, revealed === 1 ? 'known taste' : 'known tastes', 'favorites')}
                ${tally(pending, pending === 1 ? 'waiting to review' : 'waiting to review', 'discoveries')}
            </div>

            ${aiButton('profile', 'Suggest a starting profile')}

            <section class="off-block">
                <h3>Personality</h3>
                ${traitCount
                    ? `<ul class="off-chips">${SECTIONS.flatMap(section => profile.personality[section]
                        .slice(0, 4)
                        .map(trait => `<li data-section="${section}">${escapeHtml(trait.name)}<b>${clamp(trait.value, 0, 100, 50)}</b></li>`)).join('')}</ul>
                       <button class="off-link" type="button" data-action="tab" data-tab="personality">See all ${traitCount}</button>`
                    : `<p class="off-quiet">Nothing recorded yet. Add a trait by hand, or let the analyzer propose one from the roleplay.</p>`}
            </section>

            <section class="off-block">
                <h3>Tastes</h3>
                ${profile.favorites.length
                    ? `<ul class="off-taste-list">${profile.favorites.slice(0, 5).map(item => `
                        <li>
                            <span class="off-taste-cat">${escapeHtml(item.category || 'Favourite')}</span>
                            <span class="off-taste-val">${item.hidden && !item.revealed ? 'Not discovered yet' : escapeHtml(item.value || 'Unknown')}</span>
                        </li>`).join('')}</ul>
                       <button class="off-link" type="button" data-action="tab" data-tab="favorites">See all ${profile.favorites.length}</button>`
                    : `<p class="off-quiet">No tastes recorded yet.</p>`}
            </section>

            <section class="off-block">
                <h3>Their own time</h3>
                <ul class="off-taste-list">
                    <li><span class="off-taste-cat">Journal</span><span class="off-taste-val">${profile.journal.length ? `${profile.journal.length} ${profile.journal.length === 1 ? 'entry' : 'entries'}` : 'Nothing written'}</span></li>
                    <li><span class="off-taste-cat">Social</span><span class="off-taste-val">${profile.social.length ? `${profile.social.length} ${profile.social.length === 1 ? 'post' : 'posts'}` : 'Nothing posted'}</span></li>
                    <li><span class="off-taste-cat">Music</span><span class="off-taste-val">${profile.playlists.length ? `${profile.playlists.length} ${profile.playlists.length === 1 ? 'playlist' : 'playlists'}` : 'No playlists'}</span></li>
                </ul>
            </section>
        </div>`;
}

function tally(value, label, tab) {
    return `
        <button class="off-tally-item" type="button" data-action="tab" data-tab="${tab}">
            <span class="off-tally-num">${value}</span>
            <span class="off-tally-label">${escapeHtml(label)}</span>
        </button>`;
}

function personalityPage(profile) {
    const descriptions = {
        public: 'What anyone in the room would notice.',
        private: 'What they show to people they trust.',
        hidden: 'Secrets, blind spots, and things they would deny.',
    };

    return `
        <div class="off-page">
            <div class="off-page-head">
                <h2>Personality</h2>
                <div class="off-page-actions">
                    ${aiButton('personality', 'Suggest traits')}
                    <button class="off-btn" type="button" data-action="add-trait">Add trait</button>
                </div>
            </div>
            ${SECTIONS.map(section => {
                const traits = profile.personality[section];
                return `
                <section class="off-register" data-section="${section}">
                    <div class="off-register-head">
                        <h3>${section}</h3>
                        <p>${descriptions[section]}</p>
                        <span class="off-count">${traits.length}</span>
                    </div>
                    ${traits.length
                        ? `<div class="off-entries">${traits.map(trait => traitEntry(trait, section)).join('')}</div>`
                        : `<p class="off-quiet off-register-empty">Nothing here yet.</p>`}
                </section>`;
            }).join('')}
        </div>`;
}

function traitEntry(trait, section) {
    const value = clamp(trait.value, 0, 100, 50);
    const provenance = PROVENANCE.includes(trait.provenance) ? trait.provenance : 'headcanon';
    const evidence = Array.isArray(trait.evidence) ? trait.evidence.length : 0;

    return `
        <article class="off-entry" data-provenance="${provenance}" data-trait-id="${escapeHtml(trait.id)}" data-section="${section}">
            <div class="off-entry-main">
                <h4>${escapeHtml(trait.name || 'Unnamed trait')}</h4>
                <div class="off-meter" role="meter" aria-valuenow="${value}" aria-valuemin="0" aria-valuemax="100" aria-label="Strength">
                    <span style="width:${value}%"></span>
                </div>
                <span class="off-meter-value">${value}</span>
            </div>
            <p class="off-entry-note">${trait.note ? escapeHtml(trait.note) : 'No notes.'}</p>
            <div class="off-entry-foot">
                <span class="off-tag off-tag-provenance">${provenance}</span>
                <span class="off-tag">aware: ${escapeHtml(trait.awareness || 'unknown')}</span>
                ${evidence ? `<span class="off-tag">${evidence} note${evidence === 1 ? '' : 's'}</span>` : ''}
                <button class="off-remove" type="button" data-action="delete-trait" aria-label="Remove ${escapeHtml(trait.name || 'trait')}">Remove</button>
            </div>
        </article>`;
}

function favoritesPage(profile) {
    return `
        <div class="off-page">
            <div class="off-page-head">
                <h2>Favourites</h2>
                <div class="off-page-actions">
                    ${aiButton('favorites', 'Suggest a favourite')}
                    <button class="off-btn" type="button" data-action="add-favorite">Add favourite</button>
                </div>
            </div>
            ${profile.favorites.length
                ? `<div class="off-tiles">${profile.favorites.map(favoriteTile).join('')}</div>`
                : emptyState('Nothing recorded yet', 'Food, colours, songs, scents, comfort objects, guilty pleasures. Anything that makes them feel like a person.')}
        </div>`;
}

function favoriteTile(item) {
    const locked = item.hidden === true && item.revealed !== true;
    const provenance = PROVENANCE.includes(item.provenance) ? item.provenance : 'headcanon';

    return `
        <article class="off-tile ${locked ? 'is-locked' : ''}" data-provenance="${provenance}" data-favorite-id="${escapeHtml(item.id)}">
            <p class="off-tile-cat">${escapeHtml(item.category || 'Favourite')}</p>
            <p class="off-tile-val">${locked ? 'Not discovered yet' : escapeHtml(item.value || 'Unknown')}</p>
            ${item.note && !locked ? `<p class="off-tile-note">${escapeHtml(item.note)}</p>` : ''}
            <div class="off-tile-foot">
                <span class="off-tag off-tag-provenance">${provenance}</span>
                ${locked
                    ? `<button class="off-link" type="button" data-action="reveal-favorite">Reveal</button>`
                    : ''}
                <button class="off-remove" type="button" data-action="delete-favorite" aria-label="Remove favourite">Remove</button>
            </div>
        </article>`;
}

function discoveriesPage(profile) {
    return `
        <div class="off-page">
            <div class="off-page-head">
                <h2>Discoveries</h2>
                <p class="off-page-sub">Nothing here changes the dossier until you approve it.</p>
            </div>
            ${profile.discoveries.length
                ? `<div class="off-stack">${profile.discoveries.map(discoveryCard).join('')}</div>`
                : emptyState('All caught up', 'When the analyzer or AI Fill proposes a trait or a taste, it waits here for your decision.')}
        </div>`;
}

function discoveryCard(item) {
    const provenance = PROVENANCE.includes(item.provenance) ? item.provenance : 'inferred';
    const confidence = Number.isFinite(Number(item.confidence))
        ? `${Math.round(clamp(item.confidence, 0, 1, 0.7) * 100)}% fit`
        : '';
    const detail = item.target === 'favorite'
        ? `${escapeHtml(item.category || 'Favourite')}: ${escapeHtml(item.favoriteValue || '')}`
        : item.target === 'track'
            ? `${escapeHtml(item.title || 'Untitled')}${item.artist ? ` <span class="off-proposal-artist">${escapeHtml(item.artist)}</span>` : ''}`
            : escapeHtml(item.title || 'Untitled');
    const canHide = item.target !== 'track';

    return `
        <article class="off-proposal" data-provenance="${provenance}" data-discovery-id="${escapeHtml(item.id)}">
            <p class="off-proposal-kind">${escapeHtml(item.type || 'Proposal')}</p>
            <h4>${detail}</h4>
            ${item.body ? `<p class="off-proposal-body">${escapeHtml(item.body)}</p>` : ''}
            ${item.target === 'track' && item.playlist ? `<p class="off-proposal-summary">Goes on ${escapeHtml(item.playlist)}</p>` : ''}
            ${item.summary ? `<p class="off-proposal-summary">${escapeHtml(item.summary)}</p>` : ''}
            ${item.reason ? `<p class="off-proposal-reason">${escapeHtml(item.reason)}</p>` : ''}
            <div class="off-proposal-foot">
                <span class="off-tag off-tag-provenance">${provenance}</span>
                ${confidence ? `<span class="off-tag">${confidence}</span>` : ''}
                ${item.section ? `<span class="off-tag">${escapeHtml(item.section)}</span>` : ''}
            </div>
            <div class="off-proposal-actions">
                <button class="off-btn off-btn-primary" type="button" data-action="discovery" data-decision="accept">Accept</button>
                ${canHide ? `<button class="off-btn" type="button" data-action="discovery" data-decision="hidden">Keep hidden</button>` : ''}
                <button class="off-btn" type="button" data-action="discovery" data-decision="edit">Edit</button>
                <button class="off-btn off-btn-quiet" type="button" data-action="discovery" data-decision="reject">Reject</button>
            </div>
        </article>`;
}

function aiButton(target, label) {
    return `<button class="off-btn off-btn-ai" type="button" data-action="ai-fill" data-target="${target}">${escapeHtml(label)}</button>`;
}

export function emptyState(title, body) {
    return `
        <div class="off-empty">
            <h3>${escapeHtml(title)}</h3>
            <p>${escapeHtml(body)}</p>
        </div>`;
}

/* ------------------------------------------------------------- interaction */

function bindRoot(root) {
    root.addEventListener('click', onRootClick);
    root.addEventListener('change', onRootChange);
}

function onRootChange(event) {
    const select = event.target.closest('[data-action="theme"]');
    if (!select) return;
    const profile = getProfile();
    if (!profile) return;
    profile.theme = THEMES.includes(select.value) ? select.value : 'rosewater';
    save();
    emit(CHANGED, { reason: 'theme' });
}

function onRootClick(event) {
    const trigger = event.target.closest('[data-action]');
    if (!(trigger instanceof HTMLElement)) return;
    const action = trigger.dataset.action;
    const profile = getProfile();

    switch (action) {
        case 'close':
            closePanel();
            return;

        case 'tab':
            setTab(trigger.dataset.tab);
            return;

        case 'edit-tagline':
            if (!profile) return;
            openModal({
                title: 'Tagline',
                subtitle: 'A private one-liner for your own reference.',
                fields: [{ name: 'tagline', label: 'Tagline', value: profile.tagline, placeholder: 'Not nearly as subtle as he thinks.' }],
                onSubmit: values => {
                    profile.tagline = String(values.tagline || '').trim();
                    save();
                    emit(CHANGED, { reason: 'tagline' });
                },
            });
            return;

        case 'edit-field':
            if (!profile) return;
            editTransientField(profile, trigger.dataset.field);
            return;

        case 'add-trait':
            if (!profile) return;
            addTrait(profile);
            return;

        case 'add-favorite':
            if (!profile) return;
            addFavorite(profile);
            return;

        case 'delete-trait': {
            if (!profile) return;
            const card = trigger.closest('[data-trait-id]');
            const section = card?.dataset.section;
            if (!card || !SECTIONS.includes(section)) return;
            profile.personality[section] = profile.personality[section]
                .filter(item => item.id !== card.dataset.traitId);
            save();
            emit(CHANGED, { reason: 'delete-trait' });
            return;
        }

        case 'delete-favorite': {
            if (!profile) return;
            const card = trigger.closest('[data-favorite-id]');
            if (!card) return;
            profile.favorites = profile.favorites.filter(item => item.id !== card.dataset.favoriteId);
            save();
            emit(CHANGED, { reason: 'delete-favorite' });
            return;
        }

        case 'reveal-favorite': {
            if (!profile) return;
            const card = trigger.closest('[data-favorite-id]');
            const item = profile.favorites.find(entry => entry.id === card?.dataset.favoriteId);
            if (!item) return;
            item.revealed = true;
            item.discovery = 100;
            save();
            emit(CHANGED, { reason: 'reveal-favorite' });
            return;
        }

        case 'ai-fill':
            emit(ACTION, { type: 'ai-fill', target: trigger.dataset.target });
            return;

        case 'discovery': {
            const card = trigger.closest('[data-discovery-id]');
            if (!card) return;
            emit(ACTION, {
                type: 'discovery',
                decision: trigger.dataset.decision,
                id: card.dataset.discoveryId,
            });
            return;
        }

        default:
            // Journal, social, and music own their own controls.
            emit(ACTION, { type: 'life', action, element: trigger });
    }
}

function editTransientField(profile, field) {
    if (field === 'energy') {
        openModal({
            title: 'Energy',
            fields: [{ name: 'energy', label: 'Energy', type: 'range', min: 0, max: 100, value: clamp(profile.energy, 0, 100, 50) }],
            onSubmit: values => {
                profile.energy = clamp(values.energy, 0, 100, 50);
                save();
                emit(CHANGED, { reason: 'energy' });
            },
        });
        return;
    }

    const label = field === 'currentState' ? 'Currently' : 'Mood';
    openModal({
        title: label,
        fields: [{ name: field, label, value: profile[field] || '' }],
        onSubmit: values => {
            profile[field] = String(values[field] || '').trim();
            save();
            emit(CHANGED, { reason: field });
        },
    });
}

function addTrait(profile) {
    openModal({
        title: 'Add a trait',
        fields: [
            { name: 'name', label: 'Trait', placeholder: 'Possessive' },
            {
                name: 'section', label: 'Who sees it', type: 'select', value: 'private',
                options: [
                    { value: 'public', label: 'Public — anyone would notice' },
                    { value: 'private', label: 'Private — people they trust' },
                    { value: 'hidden', label: 'Hidden — secret or blind spot' },
                ],
            },
            { name: 'value', label: 'Strength', type: 'range', min: 0, max: 100, value: 70 },
            {
                name: 'provenance', label: 'Where it comes from', type: 'select', value: 'headcanon',
                options: [
                    { value: 'canon', label: 'Canon — stated on the card' },
                    { value: 'established', label: 'Established — stated in roleplay' },
                    { value: 'inferred', label: 'Inferred — repeated behaviour' },
                    { value: 'emergent', label: 'Emergent — developed in this roleplay' },
                    { value: 'headcanon', label: 'Headcanon — your own call' },
                ],
            },
            {
                name: 'awareness', label: 'Do they know this about themselves?', type: 'select', value: 'moderate',
                options: [
                    { value: 'low', label: 'Barely' },
                    { value: 'moderate', label: 'Somewhat' },
                    { value: 'high', label: 'Fully' },
                ],
            },
            { name: 'note', label: 'Notes', type: 'textarea', value: '' },
        ],
        submitLabel: 'Add trait',
        onSubmit: values => {
            const section = SECTIONS.includes(values.section) ? values.section : 'private';
            profile.personality[section].push({
                id: uid('trait'),
                name: String(values.name || '').trim() || 'Unnamed trait',
                value: clamp(values.value, 0, 100, 70),
                provenance: PROVENANCE.includes(values.provenance) ? values.provenance : 'headcanon',
                awareness: values.awareness,
                note: String(values.note || '').trim(),
                evidence: [],
                source: 'manual',
                createdAt: Date.now(),
            });
            save();
            emit(CHANGED, { reason: 'add-trait' });
        },
    });
}

function addFavorite(profile) {
    openModal({
        title: 'Add a favourite',
        fields: [
            { name: 'category', label: 'Category', placeholder: 'Favourite colour' },
            { name: 'value', label: 'What is it', placeholder: 'Black' },
            {
                name: 'provenance', label: 'Where it comes from', type: 'select', value: 'headcanon',
                options: PROVENANCE.map(item => ({ value: item, label: item })),
            },
            {
                name: 'hidden', label: 'Visibility', type: 'select', value: 'false',
                hint: 'Hidden favourites stay masked until you reveal them.',
                options: [
                    { value: 'false', label: 'Known' },
                    { value: 'true', label: 'Hidden until discovered' },
                ],
            },
            { name: 'note', label: 'Note', type: 'textarea', value: '' },
        ],
        submitLabel: 'Add favourite',
        onSubmit: values => {
            const hidden = values.hidden === 'true';
            profile.favorites.push({
                id: uid('favorite'),
                category: String(values.category || '').trim() || 'Favourite',
                value: String(values.value || '').trim() || 'Unknown',
                icon: '',
                provenance: PROVENANCE.includes(values.provenance) ? values.provenance : 'headcanon',
                hidden,
                revealed: !hidden,
                discovery: hidden ? 25 : 100,
                note: String(values.note || '').trim(),
                evidence: [],
                source: 'manual',
                createdAt: Date.now(),
            });
            save();
            emit(CHANGED, { reason: 'add-favorite' });
        },
    });
}

/* ------------------------------------------------------------------- init */

let bound = false;

export function initUi() {
    if (bound) return;
    bound = true;

    on(CHANGED, () => refresh());

    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        // The modal and the AI sheet close themselves; the panel is the outermost layer.
        if (document.getElementById(MODAL_ID) || document.getElementById('offstage-sheet')) return;
        if (isOpen()) closePanel();
    });

    bindStEvents();
}

function bindStEvents(attempt = 0) {
    const context = ctx();
    const events = context?.eventTypes ?? context?.event_types;
    if (!context?.eventSource || !events) {
        if (attempt < 8) setTimeout(() => bindStEvents(attempt + 1), 500);
        return;
    }
    for (const name of [events.CHAT_CHANGED, events.CHARACTER_EDITED, events.CHARACTER_PAGE_LOADED]) {
        if (name) context.eventSource.on(name, () => refresh({ resetScroll: true }));
    }
}

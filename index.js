const EXTENSION_KEY = 'offstage';
const ROOT_ID = 'offstage-root';
const LAUNCHER_ID = 'offstage-launcher';

const DEFAULT_PROFILE = () => ({
    schemaVersion: 1,
    tagline: '',
    mood: 'Unwritten',
    currentState: 'Waiting to be discovered',
    energy: 50,
    theme: 'rosewater',
    personality: {
        public: [],
        private: [],
        hidden: [],
    },
    favorites: [],
    discoveries: [],
    journal: [],
    social: [],
    playlists: [],
});

function ctx() {
    return globalThis.SillyTavern?.getContext?.();
}

function escapeHtml(value = '') {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function uid(prefix = 'off') {
    if (crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getCurrentCharacter() {
    const context = ctx();
    if (!context || context.characterId === undefined || context.characterId === null) return null;
    const character = context.characters?.[context.characterId];
    return character ?? null;
}

function getCharacterKey(character) {
    if (!character) return null;
    return character.avatar || character.name || `character-${ctx()?.characterId ?? 'unknown'}`;
}

function getCharacterImage(character) {
    if (!character) return '';
    try {
        if (character.avatar && ctx()?.getThumbnailUrl) {
            return ctx().getThumbnailUrl('avatar', character.avatar);
        }
    } catch (error) {
        console.warn('[Offstage] Thumbnail helper failed:', error);
    }
    return character.avatar ? `characters/${encodeURIComponent(character.avatar)}` : '';
}

function ensureSettings() {
    const context = ctx();
    if (!context) return null;
    context.extensionSettings[EXTENSION_KEY] ??= {
        schemaVersion: 1,
        profiles: {},
        ui: {
            lastTab: 'profile',
        },
    };
    context.extensionSettings[EXTENSION_KEY].profiles ??= {};
    context.extensionSettings[EXTENSION_KEY].ui ??= { lastTab: 'profile' };
    return context.extensionSettings[EXTENSION_KEY];
}

function getProfile(create = true) {
    const character = getCurrentCharacter();
    const key = getCharacterKey(character);
    if (!key) return null;
    const settings = ensureSettings();
    if (!settings) return null;
    if (!settings.profiles[key] && create) {
        settings.profiles[key] = DEFAULT_PROFILE();
        ctx().saveSettingsDebounced();
    }
    return settings.profiles[key] ?? null;
}

function save() {
    ctx()?.saveSettingsDebounced?.();
}

function getActiveTab() {
    return ensureSettings()?.ui?.lastTab || 'profile';
}

function setActiveTab(tab) {
    const settings = ensureSettings();
    if (!settings) return;
    settings.ui.lastTab = tab;
    save();
}

function renderTraitCard(trait, section) {
    const isHidden = section === 'hidden';
    const value = Number.isFinite(Number(trait.value)) ? Number(trait.value) : 50;
    const evidenceCount = Array.isArray(trait.evidence) ? trait.evidence.length : 0;
    return `
        <article class="offstage-trait-card ${isHidden ? 'is-hidden' : ''}" data-trait-id="${escapeHtml(trait.id)}" data-section="${section}">
            <div class="offstage-trait-topline">
                <div>
                    <div class="offstage-eyebrow">${isHidden ? 'Hidden trait' : escapeHtml(section)}</div>
                    <h3>${escapeHtml(trait.name || 'Unnamed trait')}</h3>
                </div>
                <button class="offstage-icon-button offstage-delete-trait" title="Delete trait" aria-label="Delete trait">×</button>
            </div>
            <div class="offstage-meter-row">
                <div class="offstage-meter"><span style="width:${Math.max(0, Math.min(100, value))}%"></span></div>
                <strong>${value}</strong>
            </div>
            <div class="offstage-trait-meta">
                <span>${escapeHtml(trait.provenance || 'headcanon')}</span>
                <span>${escapeHtml(trait.awareness || 'unknown awareness')}</span>
                ${evidenceCount ? `<span>${evidenceCount} evidence</span>` : ''}
            </div>
            ${trait.note ? `<p>${escapeHtml(trait.note)}</p>` : '<p class="offstage-muted">No notes yet.</p>'}
        </article>`;
}

function renderFavoriteCard(item) {
    const hidden = item.hidden === true;
    return `
        <article class="offstage-favorite-card ${hidden ? 'is-secret' : ''}" data-favorite-id="${escapeHtml(item.id)}">
            <button class="offstage-icon-button offstage-delete-favorite" title="Delete favorite" aria-label="Delete favorite">×</button>
            <div class="offstage-favorite-icon">${escapeHtml(item.icon || '♡')}</div>
            <div class="offstage-eyebrow">${escapeHtml(item.category || 'Favorite')}</div>
            <h3>${hidden && !item.revealed ? '?????' : escapeHtml(item.value || 'Unknown')}</h3>
            ${item.note ? `<p>${escapeHtml(item.note)}</p>` : ''}
            <div class="offstage-favorite-footer">
                <span>${escapeHtml(item.provenance || 'headcanon')}</span>
                ${hidden ? `<span>discovery ${Math.max(0, Math.min(100, Number(item.discovery) || 0))}%</span>` : ''}
            </div>
        </article>`;
}

function renderDiscoveryCard(item) {
    return `
        <article class="offstage-discovery-card" data-discovery-id="${escapeHtml(item.id)}">
            <div class="offstage-discovery-sparkle">✦</div>
            <div>
                <div class="offstage-eyebrow">${escapeHtml(item.type || 'New discovery')}</div>
                <h3>${escapeHtml(item.title || 'Offstage noticed something')}</h3>
                <p>${escapeHtml(item.summary || '')}</p>
                ${item.reason ? `<div class="offstage-reason"><strong>Why:</strong> ${escapeHtml(item.reason)}</div>` : ''}
                <div class="offstage-discovery-actions">
                    <button class="menu_button offstage-accept-discovery">Accept</button>
                    <button class="menu_button offstage-edit-discovery">Edit</button>
                    <button class="menu_button offstage-hide-discovery">Keep hidden</button>
                    <button class="menu_button offstage-reject-discovery">Reject</button>
                </div>
            </div>
        </article>`;
}

function renderEmpty(title, body) {
    return `
        <div class="offstage-empty">
            <div class="offstage-empty-mark">✦</div>
            <h3>${escapeHtml(title)}</h3>
            <p>${escapeHtml(body)}</p>
        </div>`;
}

function renderPanel() {
    const character = getCurrentCharacter();
    const profile = getProfile();
    const root = document.getElementById(ROOT_ID);
    if (!root) return;

    if (!character || !profile) {
        root.innerHTML = `
            <div class="offstage-backdrop" data-close-offstage></div>
            <section class="offstage-shell offstage-no-character">
                <button class="offstage-close" data-close-offstage aria-label="Close Offstage">×</button>
                ${renderEmpty('No character selected', 'Open a character chat, then come back to Offstage.')}
            </section>`;
        return;
    }

    const image = getCharacterImage(character);
    const activeTab = getActiveTab();
    const personality = profile.personality ?? { public: [], private: [], hidden: [] };
    const favorites = profile.favorites ?? [];
    const discoveries = profile.discoveries ?? [];

    root.dataset.theme = profile.theme || 'rosewater';
    root.innerHTML = `
        <div class="offstage-backdrop" data-close-offstage></div>
        <section class="offstage-shell" role="dialog" aria-modal="true" aria-label="Offstage character dashboard">
            <header class="offstage-hero">
                ${image ? `<img class="offstage-hero-image" src="${escapeHtml(image)}" alt="">` : ''}
                <div class="offstage-hero-vignette"></div>
                <button class="offstage-close" data-close-offstage aria-label="Close Offstage">×</button>
                <div class="offstage-brand">OFFSTAGE <span>✦</span></div>
                <div class="offstage-hero-copy">
                    <div class="offstage-eyebrow">the character behind the chat</div>
                    <h1>${escapeHtml(character.name || 'Unknown Character')}</h1>
                    <button class="offstage-tagline-button" id="offstage-edit-tagline">${escapeHtml(profile.tagline || 'Add a private little tagline…')}</button>
                    <div class="offstage-status-grid">
                        <button class="offstage-status-card" data-edit-field="mood">
                            <span>Mood</span><strong>${escapeHtml(profile.mood || 'Unwritten')}</strong>
                        </button>
                        <button class="offstage-status-card" data-edit-field="currentState">
                            <span>Currently</span><strong>${escapeHtml(profile.currentState || 'Waiting to be discovered')}</strong>
                        </button>
                        <button class="offstage-status-card" data-edit-field="energy">
                            <span>Energy</span><strong>${Math.max(0, Math.min(100, Number(profile.energy) || 0))}%</strong>
                        </button>
                        <button class="offstage-status-card offstage-discovery-count" data-tab-jump="discoveries">
                            <span>Discoveries</span><strong>${discoveries.length}</strong>
                        </button>
                    </div>
                </div>
            </header>

            <nav class="offstage-tabs" aria-label="Offstage sections">
                ${[
                    ['profile', 'Profile', '✦'],
                    ['personality', 'Personality', '◌'],
                    ['favorites', 'Favorites', '♡'],
                    ['discoveries', 'Discoveries', '✧'],
                    ['journal', 'Journal', '☾'],
                    ['social', 'Social', '@'],
                    ['music', 'Music', '♫'],
                ].map(([id, label, icon]) => `<button class="offstage-tab ${activeTab === id ? 'is-active' : ''}" data-tab="${id}"><span>${icon}</span>${label}</button>`).join('')}
            </nav>

            <main class="offstage-content">
                ${renderTab(activeTab, character, profile, personality, favorites, discoveries)}
            </main>
        </section>`;

    bindPanelEvents();
}

function renderTab(tab, character, profile, personality, favorites, discoveries) {
    if (tab === 'profile') {
        const topTraits = [...(personality.private || []), ...(personality.public || [])].slice(0, 4);
        const topFavorites = favorites.slice(0, 4);
        return `
            <section class="offstage-page offstage-profile-page">
                <div class="offstage-section-heading">
                    <div><div class="offstage-eyebrow">At a glance</div><h2>${escapeHtml(character.name)}'s little world</h2></div>
                    <select id="offstage-theme-select" class="text_pole offstage-theme-select" aria-label="Theme">
                        ${['rosewater','midnight','paper','velvet'].map(theme => `<option value="${theme}" ${profile.theme === theme ? 'selected' : ''}>${theme[0].toUpperCase()+theme.slice(1)}</option>`).join('')}
                    </select>
                </div>
                <div class="offstage-profile-grid">
                    <article class="offstage-feature-card offstage-feature-personality" data-tab-jump="personality">
                        <div class="offstage-eyebrow">Personality</div>
                        <h3>What they're really like</h3>
                        <div class="offstage-mini-traits">
                            ${topTraits.length ? topTraits.map(t => `<span>${escapeHtml(t.name)} <b>${Number(t.value) || 50}</b></span>`).join('') : '<span class="offstage-muted">No traits logged yet.</span>'}
                        </div>
                    </article>
                    <article class="offstage-feature-card offstage-feature-favorites" data-tab-jump="favorites">
                        <div class="offstage-eyebrow">Little things</div>
                        <h3>Favorites & tastes</h3>
                        <div class="offstage-mini-favorites">
                            ${topFavorites.length ? topFavorites.map(f => `<span><i>${escapeHtml(f.icon || '♡')}</i>${escapeHtml(f.category)}<b>${f.hidden && !f.revealed ? '?????' : escapeHtml(f.value || 'Unknown')}</b></span>`).join('') : '<span class="offstage-muted">Nothing discovered yet.</span>'}
                        </div>
                    </article>
                    <article class="offstage-feature-card offstage-feature-discoveries" data-tab-jump="discoveries">
                        <div class="offstage-eyebrow">Discovery inbox</div>
                        <div class="offstage-big-number">${discoveries.length}</div>
                        <h3>${discoveries.length === 1 ? 'thing waiting for you' : 'things waiting for you'}</h3>
                        <p>Nothing becomes canon until you approve it.</p>
                    </article>
                    <article class="offstage-feature-card offstage-feature-coming">
                        <div class="offstage-eyebrow">Coming next</div>
                        <h3>Journal · Social · Music</h3>
                        <p>The data foundation is here. These become the character's private life next.</p>
                    </article>
                </div>
            </section>`;
    }

    if (tab === 'personality') {
        return `
            <section class="offstage-page">
                <div class="offstage-section-heading">
                    <div><div class="offstage-eyebrow">Public · Private · Hidden</div><h2>Personality</h2></div>
                    <button class="menu_button" id="offstage-add-trait">+ Add trait</button>
                </div>
                ${['public','private','hidden'].map(section => `
                    <section class="offstage-personality-section">
                        <div class="offstage-subheading"><h3>${section}</h3><span>${(personality[section] || []).length}</span></div>
                        <div class="offstage-card-grid">
                            ${(personality[section] || []).length ? (personality[section] || []).map(t => renderTraitCard(t, section)).join('') : renderEmpty(`No ${section} traits yet`, section === 'hidden' ? 'Hidden traits can represent secrets, blind spots, or things the character does not recognize in themselves.' : 'Add one manually now; later the analyzer will propose them from roleplay evidence.')}
                        </div>
                    </section>`).join('')}
            </section>`;
    }

    if (tab === 'favorites') {
        return `
            <section class="offstage-page">
                <div class="offstage-section-heading">
                    <div><div class="offstage-eyebrow">Tastes · comforts · tiny obsessions</div><h2>Favorites</h2></div>
                    <button class="menu_button" id="offstage-add-favorite">+ Add favorite</button>
                </div>
                <div class="offstage-card-grid offstage-favorites-grid">
                    ${favorites.length ? favorites.map(renderFavoriteCard).join('') : renderEmpty('No favorites yet', 'Food, colors, books, movies, flowers, scents, guilty pleasures—anything can live here.')}
                </div>
            </section>`;
    }

    if (tab === 'discoveries') {
        return `
            <section class="offstage-page">
                <div class="offstage-section-heading">
                    <div><div class="offstage-eyebrow">Nothing changes without you</div><h2>Discovery Inbox</h2></div>
                    <button class="menu_button" id="offstage-demo-discovery">+ Add test discovery</button>
                </div>
                <div class="offstage-discovery-list">
                    ${discoveries.length ? discoveries.map(renderDiscoveryCard).join('') : renderEmpty('All caught up', 'When the analyzer notices a possible new trait, favorite, fear, habit, or preference, it will wait here for your approval.')}
                </div>
            </section>`;
    }

    const coming = {
        journal: ['Journal', 'Dated entries, unsent letters, notes-to-self, dream logs, and blind-spot reflections.'],
        social: ['Social', 'Public posts, private accounts, close friends, drafts, likes, comments, and deeply incriminating digital behavior.'],
        music: ['Music', 'All-time favorites, current rotation, relationship playlists, guilty pleasures, and songs tied to specific RP moments.'],
    }[tab];

    return `
        <section class="offstage-page">
            <div class="offstage-section-heading"><div><div class="offstage-eyebrow">Phase two</div><h2>${coming?.[0] || 'Coming soon'}</h2></div></div>
            ${renderEmpty(coming?.[0] || 'Coming soon', coming?.[1] || '')}
        </section>`;
}

function openPrompt(title, fields, onSave) {
    const existing = document.getElementById('offstage-mini-modal');
    existing?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'offstage-mini-modal';
    overlay.className = 'offstage-mini-modal-wrap';
    overlay.innerHTML = `
        <div class="offstage-mini-backdrop" data-mini-close></div>
        <form class="offstage-mini-modal">
            <div class="offstage-mini-head"><div><div class="offstage-eyebrow">Offstage</div><h3>${escapeHtml(title)}</h3></div><button type="button" class="offstage-icon-button" data-mini-close>×</button></div>
            <div class="offstage-mini-fields">
                ${fields.map(field => {
                    if (field.type === 'select') {
                        return `<label><span>${escapeHtml(field.label)}</span><select class="text_pole" name="${escapeHtml(field.name)}">${field.options.map(option => `<option value="${escapeHtml(option.value)}" ${String(field.value) === String(option.value) ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select></label>`;
                    }
                    if (field.type === 'range') {
                        return `<label><span>${escapeHtml(field.label)} <b data-range-output>${escapeHtml(field.value)}</b></span><input name="${escapeHtml(field.name)}" type="range" min="${field.min ?? 0}" max="${field.max ?? 100}" value="${escapeHtml(field.value)}"></label>`;
                    }
                    if (field.type === 'textarea') {
                        return `<label><span>${escapeHtml(field.label)}</span><textarea class="text_pole" name="${escapeHtml(field.name)}" rows="4">${escapeHtml(field.value ?? '')}</textarea></label>`;
                    }
                    return `<label><span>${escapeHtml(field.label)}</span><input class="text_pole" name="${escapeHtml(field.name)}" type="${field.type || 'text'}" value="${escapeHtml(field.value ?? '')}" ${field.placeholder ? `placeholder="${escapeHtml(field.placeholder)}"` : ''}></label>`;
                }).join('')}
            </div>
            <div class="offstage-mini-actions"><button type="button" class="menu_button" data-mini-close>Cancel</button><button class="menu_button offstage-primary" type="submit">Save</button></div>
        </form>`;
    document.body.appendChild(overlay);

    overlay.querySelectorAll('input[type="range"]').forEach(input => {
        input.addEventListener('input', () => {
            input.closest('label')?.querySelector('[data-range-output]')?.replaceChildren(document.createTextNode(input.value));
        });
    });
    overlay.querySelectorAll('[data-mini-close]').forEach(el => el.addEventListener('click', () => overlay.remove()));
    overlay.querySelector('form').addEventListener('submit', event => {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(event.currentTarget).entries());
        onSave(values);
        overlay.remove();
        save();
        renderPanel();
    });
}

function bindPanelEvents() {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    root.querySelectorAll('[data-close-offstage]').forEach(el => el.addEventListener('click', closeOffstage));
    root.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => {
        setActiveTab(button.dataset.tab);
        renderPanel();
    }));
    root.querySelectorAll('[data-tab-jump]').forEach(button => button.addEventListener('click', () => {
        setActiveTab(button.dataset.tabJump);
        renderPanel();
    }));

    root.querySelector('#offstage-theme-select')?.addEventListener('change', event => {
        const profile = getProfile();
        profile.theme = event.target.value;
        save();
        renderPanel();
    });

    root.querySelector('#offstage-edit-tagline')?.addEventListener('click', () => {
        const profile = getProfile();
        openPrompt('Edit tagline', [{ name: 'tagline', label: 'Private tagline', value: profile.tagline, placeholder: 'Not nearly as subtle as he thinks.' }], values => profile.tagline = values.tagline.trim());
    });

    root.querySelectorAll('[data-edit-field]').forEach(button => button.addEventListener('click', () => {
        const profile = getProfile();
        const field = button.dataset.editField;
        if (field === 'energy') {
            openPrompt('Current energy', [{ name: 'energy', label: 'Energy', type: 'range', min: 0, max: 100, value: profile.energy }], values => profile.energy = Number(values.energy));
        } else {
            const label = field === 'currentState' ? 'Currently' : 'Mood';
            openPrompt(`Edit ${label.toLowerCase()}`, [{ name: field, label, value: profile[field] }], values => profile[field] = values[field].trim());
        }
    }));

    root.querySelector('#offstage-add-trait')?.addEventListener('click', () => {
        const profile = getProfile();
        openPrompt('Add personality trait', [
            { name: 'name', label: 'Trait', placeholder: 'Possessive' },
            { name: 'section', label: 'Visibility', type: 'select', value: 'private', options: [
                { value: 'public', label: 'Public persona' },
                { value: 'private', label: 'Private self' },
                { value: 'hidden', label: 'Hidden / blind spot' },
            ]},
            { name: 'value', label: 'Strength', type: 'range', min: 0, max: 100, value: 70 },
            { name: 'provenance', label: 'Source', type: 'select', value: 'headcanon', options: [
                { value: 'canon', label: 'Canon (character card/lore)' },
                { value: 'established', label: 'Established in RP' },
                { value: 'inferred', label: 'Inferred from behavior' },
                { value: 'emergent', label: 'Emergent during RP' },
                { value: 'headcanon', label: 'Headcanon' },
            ]},
            { name: 'awareness', label: 'Character awareness', type: 'select', value: 'moderate', options: [
                { value: 'low', label: 'Low' }, { value: 'moderate', label: 'Moderate' }, { value: 'high', label: 'High' }
            ]},
            { name: 'note', label: 'Notes', type: 'textarea', value: '' },
        ], values => {
            const section = ['public','private','hidden'].includes(values.section) ? values.section : 'private';
            profile.personality[section].push({ id: uid('trait'), name: values.name.trim() || 'Unnamed trait', value: Number(values.value), provenance: values.provenance, awareness: values.awareness, note: values.note.trim(), evidence: [] });
        });
    });

    root.querySelectorAll('.offstage-delete-trait').forEach(button => button.addEventListener('click', event => {
        event.stopPropagation();
        const card = button.closest('[data-trait-id]');
        const profile = getProfile();
        const section = card.dataset.section;
        profile.personality[section] = profile.personality[section].filter(item => item.id !== card.dataset.traitId);
        save();
        renderPanel();
    }));

    root.querySelector('#offstage-add-favorite')?.addEventListener('click', () => {
        const profile = getProfile();
        openPrompt('Add favorite', [
            { name: 'icon', label: 'Icon', value: '♡' },
            { name: 'category', label: 'Category', placeholder: 'Favorite color' },
            { name: 'value', label: 'Favorite', placeholder: 'Black' },
            { name: 'provenance', label: 'Source', type: 'select', value: 'headcanon', options: [
                { value: 'canon', label: 'Canon' }, { value: 'established', label: 'Established in RP' }, { value: 'inferred', label: 'Inferred' }, { value: 'emergent', label: 'Emergent' }, { value: 'headcanon', label: 'Headcanon' }
            ]},
            { name: 'hidden', label: 'Visibility', type: 'select', value: 'false', options: [
                { value: 'false', label: 'Known' }, { value: 'true', label: 'Hidden / discovery' }
            ]},
            { name: 'note', label: 'Note', type: 'textarea', value: '' },
        ], values => profile.favorites.push({ id: uid('fav'), icon: values.icon || '♡', category: values.category.trim() || 'Favorite', value: values.value.trim() || 'Unknown', provenance: values.provenance, hidden: values.hidden === 'true', revealed: values.hidden !== 'true', discovery: values.hidden === 'true' ? 25 : 100, note: values.note.trim() }));
    });

    root.querySelectorAll('.offstage-delete-favorite').forEach(button => button.addEventListener('click', event => {
        event.stopPropagation();
        const card = button.closest('[data-favorite-id]');
        const profile = getProfile();
        profile.favorites = profile.favorites.filter(item => item.id !== card.dataset.favoriteId);
        save();
        renderPanel();
    }));

    root.querySelector('#offstage-demo-discovery')?.addEventListener('click', () => {
        const profile = getProfile();
        profile.discoveries.unshift({ id: uid('discovery'), type: 'Possible hidden trait', title: 'Unexpectedly domestic', summary: 'They seem to show care through small practical routines more often than they admit.', reason: 'Test discovery for the v0.1 interface. The real analyzer will replace this button.' });
        save();
        renderPanel();
    });

    root.querySelectorAll('.offstage-reject-discovery').forEach(button => button.addEventListener('click', () => removeDiscovery(button)));
    root.querySelectorAll('.offstage-accept-discovery').forEach(button => button.addEventListener('click', () => {
        const card = button.closest('[data-discovery-id]');
        const profile = getProfile();
        const item = profile.discoveries.find(d => d.id === card.dataset.discoveryId);
        if (item) {
            profile.personality.hidden.push({ id: uid('trait'), name: item.title.replace(/^Unexpectedly\s+/i, '') || item.title, value: 65, provenance: 'inferred', awareness: 'low', note: item.summary, evidence: item.reason ? [item.reason] : [] });
        }
        removeDiscovery(button);
    }));
    root.querySelectorAll('.offstage-hide-discovery').forEach(button => button.addEventListener('click', () => {
        const card = button.closest('[data-discovery-id]');
        const profile = getProfile();
        const item = profile.discoveries.find(d => d.id === card.dataset.discoveryId);
        if (item) profile.personality.hidden.push({ id: uid('trait'), name: item.title, value: 60, provenance: 'inferred', awareness: 'low', note: item.summary, evidence: item.reason ? [item.reason] : [] });
        removeDiscovery(button);
    }));
    root.querySelectorAll('.offstage-edit-discovery').forEach(button => button.addEventListener('click', () => {
        const card = button.closest('[data-discovery-id]');
        const profile = getProfile();
        const item = profile.discoveries.find(d => d.id === card.dataset.discoveryId);
        if (!item) return;
        openPrompt('Edit discovery', [
            { name: 'type', label: 'Type', value: item.type },
            { name: 'title', label: 'Title', value: item.title },
            { name: 'summary', label: 'Summary', type: 'textarea', value: item.summary },
            { name: 'reason', label: 'Evidence / why', type: 'textarea', value: item.reason },
        ], values => Object.assign(item, values));
    }));
}

function removeDiscovery(button) {
    const card = button.closest('[data-discovery-id]');
    const profile = getProfile();
    profile.discoveries = profile.discoveries.filter(item => item.id !== card.dataset.discoveryId);
    save();
    renderPanel();
}

function openOffstage() {
    ensureSettings();
    let root = document.getElementById(ROOT_ID);
    if (!root) {
        root = document.createElement('div');
        root.id = ROOT_ID;
        document.body.appendChild(root);
    }
    root.classList.add('is-open');
    renderPanel();
    document.documentElement.classList.add('offstage-open');
}

function closeOffstage() {
    document.getElementById(ROOT_ID)?.classList.remove('is-open');
    document.documentElement.classList.remove('offstage-open');
}

function createLauncher() {
    if (document.getElementById(LAUNCHER_ID)) return;
    const button = document.createElement('button');
    button.id = LAUNCHER_ID;
    button.type = 'button';
    button.innerHTML = '<span class="offstage-launcher-star">✦</span><span class="offstage-launcher-word">Offstage</span>';
    button.title = 'Open Offstage';
    button.addEventListener('click', openOffstage);
    document.body.appendChild(button);
}

function refreshIfOpen() {
    if (document.getElementById(ROOT_ID)?.classList.contains('is-open')) renderPanel();
}

export function init() {
    ensureSettings();
    createLauncher();

    const context = ctx();
    const events = context?.eventTypes ?? context?.event_types;
    if (context?.eventSource && events) {
        for (const eventName of [events.CHAT_CHANGED, events.CHARACTER_EDITED, events.CHARACTER_PAGE_LOADED]) {
            if (eventName) context.eventSource.on(eventName, refreshIfOpen);
        }
    }

    console.info('[Offstage] v0.1 initialized');
}

// Fallback for loaders that do not call manifest activation hooks.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 0), { once: true });
} else {
    setTimeout(init, 0);
}

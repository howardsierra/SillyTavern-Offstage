/**
 * Offstage — the character's own time.
 * Journal, Social, and Music share a shape: dated or ordered items that can be
 * written by hand or proposed by the model and approved in Discoveries.
 * Every proposal path lands in approvals.js; this module only handles the
 * pages themselves and the controls on them.
 */

import {
    ACTION, CHANGED, JOURNAL_KINDS, PLAYLIST_KINDS, PROVENANCE, SOCIAL_ACCOUNTS,
    clamp, emit, escapeHtml, getCurrentCharacter, getProfile, labelFor, on, save, uid,
} from './core.js';
import { openModal } from './modal.js';

const CLAMP_AT = 520;

let socialFilter = 'all';

/* ------------------------------------------------------------------ shared */

function empty(title, body) {
    return `<div class="off-empty"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(body)}</p></div>`;
}

function provenanceOf(item) {
    return PROVENANCE.includes(item?.provenance) ? item.provenance : 'headcanon';
}

/** Long text collapses to six lines with a toggle; short text is shown whole. */
function body(text, className) {
    const value = String(text ?? '');
    if (!value.trim()) return `<p class="${className} off-quiet">Nothing written.</p>`;
    if (value.length <= CLAMP_AT) return `<p class="${className}">${escapeHtml(value)}</p>`;
    return `<details class="off-clamp"><summary></summary><p class="${className}">${escapeHtml(value)}</p></details>`;
}

function sealed(kind) {
    return `<p class="off-sealed">Sealed — ${escapeHtml(kind)} not discovered yet.</p>`;
}

function provenanceField(value) {
    return {
        name: 'provenance', label: 'Where it comes from', type: 'select',
        value: value || 'headcanon',
        options: PROVENANCE.map(item => ({ value: item, label: item })),
    };
}

function hiddenField(value) {
    return {
        name: 'hidden', label: 'Visibility', type: 'select', value: value ? 'true' : 'false',
        hint: 'Hidden items stay sealed until you reveal them.',
        options: [
            { value: 'false', label: 'Visible to you' },
            { value: 'true', label: 'Hidden until discovered' },
        ],
    };
}

function aiButton(target, label) {
    return `<button class="off-btn off-btn-ai" type="button" data-action="ai-fill" data-target="${target}">${escapeHtml(label)}</button>`;
}

function toolbar(item, kind) {
    const locked = item.hidden === true && item.revealed !== true;
    return `
        <span class="off-tag off-tag-provenance">${provenanceOf(item)}</span>
        ${locked ? `<button class="off-link" type="button" data-action="reveal-${kind}">Reveal</button>` : ''}
        <button class="off-link" type="button" data-action="edit-${kind}">Edit</button>
        <button class="off-remove" type="button" data-action="delete-${kind}">Remove</button>`;
}

/* ----------------------------------------------------------------- routing */

export function lifePage(tab, profile) {
    if (tab === 'journal') return journalPage(profile);
    if (tab === 'social') return socialPage(profile);
    if (tab === 'music') return musicPage(profile);
    return '';
}

/* ----------------------------------------------------------------- journal */

function journalPage(profile) {
    const entries = [...profile.journal].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    return `
        <div class="off-page">
            <div class="off-page-head">
                <h2>Journal</h2>
                <div class="off-page-actions">
                    ${aiButton('journal', 'Write about this scene')}
                    <button class="off-btn" type="button" data-action="add-journal">Add entry</button>
                </div>
            </div>
            ${entries.length
                ? `<div class="off-stack">${entries.map(journalEntry).join('')}</div>`
                : empty('Nothing written yet', 'Diary entries, letters they never sent, notes to themselves, dreams. Write one, or ask the model to write one from the scene you just played.')}
        </div>`;
}

function journalEntry(entry) {
    const locked = entry.hidden === true && entry.revealed !== true;
    return `
        <article class="off-log" data-provenance="${provenanceOf(entry)}" data-entry-id="${escapeHtml(entry.id)}">
            <div class="off-log-head">
                <p class="off-log-date">${escapeHtml(entry.date || 'Undated')}</p>
                <span class="off-tag">${escapeHtml(labelFor(JOURNAL_KINDS, entry.kind))}</span>
                ${entry.mood ? `<span class="off-tag">${escapeHtml(entry.mood)}</span>` : ''}
            </div>
            ${entry.title && !locked ? `<h4 class="off-log-title">${escapeHtml(entry.title)}</h4>` : ''}
            ${locked ? sealed('this entry is') : body(entry.body, 'off-log-body')}
            <div class="off-log-foot">${toolbar(entry, 'journal')}</div>
        </article>`;
}

function journalFields(entry = {}) {
    return [
        {
            name: 'kind', label: 'What is it', type: 'select', value: entry.kind || 'entry',
            options: JOURNAL_KINDS.map(([value, label]) => ({ value, label })),
        },
        { name: 'date', label: 'Date', value: entry.date || '', placeholder: 'Whatever their world calls today' },
        { name: 'title', label: 'Title', value: entry.title || '', placeholder: 'Optional' },
        { name: 'body', label: 'Entry', type: 'textarea', value: entry.body || '' },
        { name: 'mood', label: 'Mood while writing', value: entry.mood || '', placeholder: 'Optional' },
        provenanceField(entry.provenance),
        hiddenField(entry.hidden),
    ];
}

function readJournal(values) {
    const hidden = values.hidden === 'true';
    return {
        kind: JOURNAL_KINDS.some(([key]) => key === values.kind) ? values.kind : 'entry',
        date: String(values.date || '').trim(),
        title: String(values.title || '').trim(),
        body: String(values.body || '').trim(),
        mood: String(values.mood || '').trim(),
        provenance: PROVENANCE.includes(values.provenance) ? values.provenance : 'headcanon',
        hidden,
        revealed: !hidden,
    };
}

/* ------------------------------------------------------------------ social */

function handleFor(profile, post) {
    if (post.handle) return post.handle;
    const stored = profile.handles?.[post.account];
    if (stored) return stored;
    const name = getCurrentCharacter()?.name || 'someone';
    return `@${name.toLowerCase().replace(/[^a-z0-9]+/g, '')}`;
}

function socialPage(profile) {
    const counts = Object.fromEntries(SOCIAL_ACCOUNTS.map(([key]) =>
        [key, profile.social.filter(post => post.account === key).length]));
    const posts = profile.social
        .filter(post => socialFilter === 'all' || post.account === socialFilter)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    const filters = [['all', 'Everything', profile.social.length], ...SOCIAL_ACCOUNTS.map(([key, label]) => [key, label, counts[key]])];

    return `
        <div class="off-page">
            <div class="off-page-head">
                <h2>Social</h2>
                <div class="off-page-actions">
                    <button class="off-btn off-btn-quiet" type="button" data-action="edit-accounts">Accounts</button>
                    ${aiButton('social', 'Suggest a post')}
                    <button class="off-btn" type="button" data-action="add-post">Add post</button>
                </div>
            </div>

            ${profile.social.length ? `
            <div class="off-filters" role="group" aria-label="Filter by account">
                ${filters.map(([key, label, count]) => `
                    <button class="off-filter ${socialFilter === key ? 'is-active' : ''}" type="button"
                        data-action="social-filter" data-filter="${key}">${escapeHtml(label)}<b>${count}</b></button>`).join('')}
            </div>` : ''}

            ${posts.length
                ? `<div class="off-stack">${posts.map(post => socialPost(profile, post)).join('')}</div>`
                : profile.social.length
                    ? empty('Nothing on this account', 'Try another account, or add a post here.')
                    : empty('Nothing posted yet', 'The public account, the one nobody knows about, the close-friends story, the draft they never sent. All of it counts.')}
        </div>`;
}

function socialPost(profile, post) {
    const locked = post.hidden === true && post.revealed !== true;
    const isDraft = post.account === 'draft';
    const comments = Array.isArray(post.comments) ? post.comments : [];

    return `
        <article class="off-post ${isDraft ? 'is-draft' : ''}" data-account="${post.account}"
            data-provenance="${provenanceOf(post)}" data-post-id="${escapeHtml(post.id)}">
            <div class="off-post-head">
                <span class="off-post-handle">${escapeHtml(handleFor(profile, post))}</span>
                <span class="off-tag">${escapeHtml(labelFor(SOCIAL_ACCOUNTS, post.account))}</span>
                ${post.date ? `<span class="off-post-date">${escapeHtml(post.date)}</span>` : ''}
            </div>
            ${locked ? sealed('this post is') : body(post.body, 'off-post-body')}
            ${!locked && !isDraft ? `
                <div class="off-post-stats">
                    <span>${clamp(post.likes, 0, 9999999, 0)} likes</span>
                    <span>${comments.length} ${comments.length === 1 ? 'reply' : 'replies'}</span>
                </div>` : ''}
            ${!locked && comments.length ? `
                <ul class="off-comments">
                    ${comments.map(comment => `
                        <li><span class="off-comment-name">${escapeHtml(comment.name || 'someone')}</span>
                            <span class="off-comment-body">${escapeHtml(comment.body || '')}</span></li>`).join('')}
                </ul>` : ''}
            <div class="off-log-foot">
                ${!locked && !isDraft ? `<button class="off-link" type="button" data-action="add-comment">Add reply</button>` : ''}
                ${toolbar(post, 'post')}
            </div>
        </article>`;
}

function socialFields(post = {}) {
    return [
        {
            name: 'account', label: 'Which account', type: 'select', value: post.account || 'main',
            options: SOCIAL_ACCOUNTS.map(([value, label]) => ({ value, label })),
        },
        { name: 'body', label: 'Post', type: 'textarea', value: post.body || '' },
        { name: 'date', label: 'When', value: post.date || '', placeholder: 'Optional' },
        { name: 'likes', label: 'Likes', type: 'number', value: clamp(post.likes, 0, 9999999, 0) },
        { name: 'handle', label: 'Handle', value: post.handle || '', placeholder: 'Leave blank to use the account handle' },
        provenanceField(post.provenance),
        hiddenField(post.hidden),
    ];
}

function readPost(values) {
    const hidden = values.hidden === 'true';
    return {
        account: SOCIAL_ACCOUNTS.some(([key]) => key === values.account) ? values.account : 'main',
        body: String(values.body || '').trim(),
        date: String(values.date || '').trim(),
        handle: String(values.handle || '').trim(),
        likes: clamp(values.likes, 0, 9999999, 0),
        provenance: PROVENANCE.includes(values.provenance) ? values.provenance : 'headcanon',
        hidden,
        revealed: !hidden,
    };
}

/* ------------------------------------------------------------------- music */

function musicPage(profile) {
    return `
        <div class="off-page">
            <div class="off-page-head">
                <h2>Music</h2>
                <div class="off-page-actions">
                    ${aiButton('music', 'Suggest music')}
                    <button class="off-btn" type="button" data-action="add-playlist">Add playlist</button>
                </div>
            </div>
            ${profile.playlists.length
                ? profile.playlists.map(playlist).join('')
                : empty('No playlists yet', 'What they play alone, what they would never admit to loving, and the song that will always be one specific night.')}
        </div>`;
}

function playlist(list) {
    const tracks = Array.isArray(list.tracks) ? list.tracks : [];
    return `
        <section class="off-pl" data-playlist-id="${escapeHtml(list.id)}" data-provenance="${provenanceOf(list)}">
            <div class="off-pl-head">
                <h3>${escapeHtml(list.name)}</h3>
                <span class="off-tag">${escapeHtml(labelFor(PLAYLIST_KINDS, list.kind))}</span>
                <span class="off-count">${tracks.length}</span>
            </div>
            ${list.note ? `<p class="off-pl-note">${escapeHtml(list.note)}</p>` : ''}
            ${tracks.length ? `
                <ol class="off-tracks">
                    ${tracks.map((track, index) => `
                        <li data-track-id="${escapeHtml(track.id)}">
                            <span class="off-track-n">${index + 1}</span>
                            <span class="off-track-main">
                                <span class="off-track-title">${escapeHtml(track.title || 'Untitled')}</span>
                                ${track.artist ? `<span class="off-track-artist">${escapeHtml(track.artist)}</span>` : ''}
                                ${track.note ? `<span class="off-track-note">${escapeHtml(track.note)}</span>` : ''}
                            </span>
                            <button class="off-remove" type="button" data-action="delete-track" aria-label="Remove track">Remove</button>
                        </li>`).join('')}
                </ol>` : `<p class="off-quiet">No tracks yet.</p>`}
            <div class="off-log-foot">
                <span class="off-tag off-tag-provenance">${provenanceOf(list)}</span>
                <button class="off-link" type="button" data-action="add-track">Add track</button>
                <button class="off-link" type="button" data-action="edit-playlist">Edit</button>
                <button class="off-remove" type="button" data-action="delete-playlist">Remove</button>
            </div>
        </section>`;
}

function playlistFields(list = {}) {
    return [
        { name: 'name', label: 'Name', value: list.name || '', placeholder: 'Songs for driving at 2am' },
        {
            name: 'kind', label: 'What kind', type: 'select', value: list.kind || 'rotation',
            options: PLAYLIST_KINDS.map(([value, label]) => ({ value, label })),
        },
        { name: 'note', label: 'Note', type: 'textarea', value: list.note || '' },
        provenanceField(list.provenance),
    ];
}

/* ---------------------------------------------------------------- handlers */

function closestId(element, attribute) {
    return element.closest(`[data-${attribute}]`)?.dataset?.[attribute.replace(/-(\w)/g, (_, c) => c.toUpperCase())] ?? null;
}

function findEntry(profile, element) {
    return profile.journal.find(item => item.id === closestId(element, 'entry-id'));
}

function findPost(profile, element) {
    return profile.social.find(item => item.id === closestId(element, 'post-id'));
}

function findPlaylist(profile, element) {
    return profile.playlists.find(item => item.id === closestId(element, 'playlist-id'));
}

function commit(reason) {
    save();
    emit(CHANGED, { reason });
}

function handle(action, element) {
    const profile = getProfile();
    if (!profile) return;

    switch (action) {
        /* journal ------------------------------------------------------- */
        case 'add-journal':
            openModal({
                title: 'New journal entry',
                fields: journalFields(),
                submitLabel: 'Save entry',
                onSubmit: values => {
                    const entry = readJournal(values);
                    if (!entry.body) return;
                    profile.journal.push({ id: uid('journal'), ...entry, source: 'manual', createdAt: Date.now() });
                    commit('add-journal');
                },
            });
            return;

        case 'edit-journal': {
            const entry = findEntry(profile, element);
            if (!entry) return;
            openModal({
                title: 'Edit entry',
                fields: journalFields(entry),
                onSubmit: values => {
                    Object.assign(entry, readJournal(values));
                    commit('edit-journal');
                },
            });
            return;
        }

        case 'reveal-journal': {
            const entry = findEntry(profile, element);
            if (!entry) return;
            entry.revealed = true;
            commit('reveal-journal');
            return;
        }

        case 'delete-journal': {
            const id = closestId(element, 'entry-id');
            profile.journal = profile.journal.filter(item => item.id !== id);
            commit('delete-journal');
            return;
        }

        /* social -------------------------------------------------------- */
        case 'edit-accounts':
            openModal({
                title: 'Accounts',
                subtitle: 'Handles used when a post does not carry its own.',
                fields: [
                    { name: 'main', label: 'Public account', value: profile.handles.main, placeholder: '@name' },
                    { name: 'alt', label: 'Private account', value: profile.handles.alt, placeholder: '@somethingelse' },
                    { name: 'close', label: 'Close friends', value: profile.handles.close, placeholder: '@onlyus' },
                ],
                onSubmit: values => {
                    for (const key of ['main', 'alt', 'close']) {
                        profile.handles[key] = String(values[key] || '').trim();
                    }
                    commit('edit-accounts');
                },
            });
            return;

        case 'social-filter':
            socialFilter = element.dataset.filter || 'all';
            emit(CHANGED, { reason: 'social-filter' });
            return;

        case 'add-post':
            openModal({
                title: 'New post',
                fields: socialFields(),
                submitLabel: 'Save post',
                onSubmit: values => {
                    const post = readPost(values);
                    if (!post.body) return;
                    profile.social.push({ id: uid('post'), ...post, comments: [], source: 'manual', createdAt: Date.now() });
                    commit('add-post');
                },
            });
            return;

        case 'edit-post': {
            const post = findPost(profile, element);
            if (!post) return;
            openModal({
                title: 'Edit post',
                fields: socialFields(post),
                onSubmit: values => {
                    Object.assign(post, readPost(values));
                    commit('edit-post');
                },
            });
            return;
        }

        case 'add-comment': {
            const post = findPost(profile, element);
            if (!post) return;
            openModal({
                title: 'Add a reply',
                fields: [
                    { name: 'name', label: 'Who', value: '', placeholder: 'A name or handle' },
                    { name: 'body', label: 'Reply', type: 'textarea', value: '' },
                ],
                submitLabel: 'Add reply',
                onSubmit: values => {
                    const reply = String(values.body || '').trim();
                    if (!reply) return;
                    post.comments.push({ name: String(values.name || '').trim() || 'someone', body: reply });
                    commit('add-comment');
                },
            });
            return;
        }

        case 'reveal-post': {
            const post = findPost(profile, element);
            if (!post) return;
            post.revealed = true;
            commit('reveal-post');
            return;
        }

        case 'delete-post': {
            const id = closestId(element, 'post-id');
            profile.social = profile.social.filter(item => item.id !== id);
            commit('delete-post');
            return;
        }

        /* music --------------------------------------------------------- */
        case 'add-playlist':
            openModal({
                title: 'New playlist',
                fields: playlistFields(),
                submitLabel: 'Save playlist',
                onSubmit: values => {
                    profile.playlists.push({
                        id: uid('playlist'),
                        name: String(values.name || '').trim() || 'Untitled playlist',
                        kind: PLAYLIST_KINDS.some(([key]) => key === values.kind) ? values.kind : 'rotation',
                        note: String(values.note || '').trim(),
                        provenance: PROVENANCE.includes(values.provenance) ? values.provenance : 'headcanon',
                        tracks: [],
                        source: 'manual',
                        createdAt: Date.now(),
                    });
                    commit('add-playlist');
                },
            });
            return;

        case 'edit-playlist': {
            const list = findPlaylist(profile, element);
            if (!list) return;
            openModal({
                title: 'Edit playlist',
                fields: playlistFields(list),
                onSubmit: values => {
                    list.name = String(values.name || '').trim() || list.name;
                    list.kind = PLAYLIST_KINDS.some(([key]) => key === values.kind) ? values.kind : list.kind;
                    list.note = String(values.note || '').trim();
                    list.provenance = PROVENANCE.includes(values.provenance) ? values.provenance : list.provenance;
                    commit('edit-playlist');
                },
            });
            return;
        }

        case 'delete-playlist': {
            const id = closestId(element, 'playlist-id');
            profile.playlists = profile.playlists.filter(item => item.id !== id);
            commit('delete-playlist');
            return;
        }

        case 'add-track': {
            const list = findPlaylist(profile, element);
            if (!list) return;
            openModal({
                title: `Add to ${list.name}`,
                fields: [
                    { name: 'title', label: 'Title', value: '' },
                    { name: 'artist', label: 'Artist', value: '', placeholder: 'Optional' },
                    { name: 'note', label: 'Why this one', type: 'textarea', value: '' },
                ],
                submitLabel: 'Add track',
                onSubmit: values => {
                    const title = String(values.title || '').trim();
                    if (!title) return;
                    list.tracks.push({
                        id: uid('track'),
                        title,
                        artist: String(values.artist || '').trim(),
                        note: String(values.note || '').trim(),
                        createdAt: Date.now(),
                    });
                    commit('add-track');
                },
            });
            return;
        }

        case 'delete-track': {
            const list = findPlaylist(profile, element);
            const trackId = closestId(element, 'track-id');
            if (!list || !trackId) return;
            list.tracks = list.tracks.filter(track => track.id !== trackId);
            commit('delete-track');
            return;
        }

        default:
    }
}

let initialized = false;

export function initLife() {
    if (initialized) return;
    initialized = true;
    on(ACTION, event => {
        const detail = event.detail;
        if (detail?.type === 'life') handle(detail.action, detail.element);
        if (detail?.type === 'tab-changed' && detail.tab !== 'social') socialFilter = 'all';
    });
}

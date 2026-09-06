/**
 * Offstage — Discovery Inbox.
 * Every proposal, whoever created it, is approved, edited, or rejected here.
 * Nothing else in the extension is allowed to write a discovery into the profile.
 */

import {
    ACTION, CHANGED, JOURNAL_KINDS, PLAYLIST_KINDS, PROVENANCE, SECTIONS, SOCIAL_ACCOUNTS,
    alreadyKnown, alreadyQueued, clamp, emit, getProfile, labelFor, norm, on, save, toast, uid,
} from './core.js';
import { openModal } from './modal.js';

const TARGETS = ['trait', 'favorite', 'journal', 'social', 'track'];

/** Build an inbox item from a normalised proposal. */
export function makeDiscovery(proposal) {
    const target = TARGETS.includes(proposal.target) ? proposal.target : 'trait';
    const provenance = PROVENANCE.includes(proposal.provenance) ? proposal.provenance : 'inferred';
    const section = SECTIONS.includes(proposal.section) ? proposal.section : 'private';

    const base = {
        id: uid('discovery'),
        source: proposal.source || 'manual',
        target,
        section,
        provenance,
        confidence: clamp(proposal.confidence, 0, 1, 0.7),
        summary: String(proposal.summary || '').trim(),
        reason: String(proposal.reason || '').trim(),
        createdAt: Date.now(),
    };

    if (target === 'favorite') {
        const category = String(proposal.category || '').trim();
        const favoriteValue = String(proposal.favoriteValue || proposal.value || '').trim();
        if (!category || !favoriteValue) return null;
        return { ...base, type: proposal.type || 'Favourite', title: `Favourite ${category}`, category, favoriteValue };
    }

    if (target === 'journal') {
        const body = String(proposal.body || '').trim();
        if (!body) return null;
        const kind = JOURNAL_KINDS.some(([key]) => key === proposal.kind) ? proposal.kind : 'entry';
        return {
            ...base,
            type: proposal.type || labelFor(JOURNAL_KINDS, kind),
            kind,
            body,
            date: String(proposal.date || '').trim(),
            mood: String(proposal.mood || '').trim(),
            title: String(proposal.title || '').trim() || String(proposal.date || '').trim() || labelFor(JOURNAL_KINDS, kind),
        };
    }

    if (target === 'social') {
        const body = String(proposal.body || '').trim();
        if (!body) return null;
        const account = SOCIAL_ACCOUNTS.some(([key]) => key === proposal.account) ? proposal.account : 'main';
        return {
            ...base,
            type: proposal.type || 'Post',
            account,
            body,
            date: String(proposal.date || '').trim(),
            likes: clamp(proposal.likes, 0, 9999999, 0),
            title: labelFor(SOCIAL_ACCOUNTS, account),
        };
    }

    if (target === 'track') {
        const title = String(proposal.title || '').trim();
        if (!title) return null;
        return {
            ...base,
            type: proposal.type || 'Song',
            title,
            artist: String(proposal.artist || '').trim(),
            playlist: String(proposal.playlist || '').trim() || 'Current rotation',
            playlistKind: PLAYLIST_KINDS.some(([key]) => key === proposal.playlistKind) ? proposal.playlistKind : 'rotation',
            note: String(proposal.note || '').trim(),
        };
    }

    const title = String(proposal.title || proposal.name || '').trim();
    if (!title) return null;
    return {
        ...base,
        type: proposal.type || (section === 'hidden' ? 'Hidden trait' : 'Personality trait'),
        title,
        value: clamp(proposal.value, 0, 100, 65),
    };
}

/**
 * Add proposals to the inbox, skipping anything already accepted or queued.
 * @returns {{ queued: number, skipped: number }}
 */
export function queueDiscoveries(proposals, { toFront = false } = {}) {
    const profile = getProfile();
    if (!profile) return { queued: 0, skipped: 0 };

    let queued = 0;
    let skipped = 0;
    for (const proposal of proposals) {
        const item = proposal?.id && proposal?.target ? proposal : makeDiscovery(proposal || {});
        if (!item) continue;
        if (alreadyKnown(profile, item) || alreadyQueued(profile, item)) {
            skipped++;
            continue;
        }
        if (toFront) profile.discoveries.unshift(item);
        else profile.discoveries.push(item);
        queued++;
    }

    if (queued) save();
    return { queued, skipped };
}

function remove(profile, id) {
    profile.discoveries = profile.discoveries.filter(item => item.id !== id);
}

function accept(profile, item, { forceHidden = false } = {}) {
    if (alreadyKnown(profile, item)) {
        remove(profile, item.id);
        save();
        emit(CHANGED, { reason: 'discovery-duplicate' });
        toast.info('Already in the dossier, so the duplicate proposal was cleared.');
        return;
    }

    if (item.target === 'journal') {
        profile.journal.push({
            id: uid('journal'),
            kind: item.kind || 'entry',
            date: item.date || '',
            title: item.title && item.title !== item.date ? item.title : '',
            body: item.body,
            mood: item.mood || '',
            provenance: item.provenance || 'headcanon',
            hidden: forceHidden,
            revealed: !forceHidden,
            source: `${item.source || 'proposal'}-approved`,
            createdAt: Date.now(),
        });
    } else if (item.target === 'social') {
        profile.social.push({
            id: uid('post'),
            account: item.account || 'main',
            body: item.body,
            date: item.date || '',
            handle: '',
            likes: clamp(item.likes, 0, 9999999, 0),
            comments: [],
            provenance: item.provenance || 'headcanon',
            hidden: forceHidden,
            revealed: !forceHidden,
            source: `${item.source || 'proposal'}-approved`,
            createdAt: Date.now(),
        });
    } else if (item.target === 'track') {
        let list = profile.playlists.find(entry => norm(entry.name) === norm(item.playlist));
        if (!list) {
            list = {
                id: uid('playlist'),
                name: item.playlist,
                kind: item.playlistKind || 'rotation',
                note: '',
                provenance: item.provenance || 'headcanon',
                tracks: [],
                source: `${item.source || 'proposal'}-approved`,
                createdAt: Date.now(),
            };
            profile.playlists.push(list);
        }
        list.tracks.push({
            id: uid('track'),
            title: item.title,
            artist: item.artist || '',
            note: item.note || item.summary || '',
            createdAt: Date.now(),
        });
    } else if (item.target === 'favorite') {
        const hidden = forceHidden;
        profile.favorites.push({
            id: uid('favorite'),
            category: item.category || 'Favourite',
            value: item.favoriteValue || 'Unknown',
            icon: '',
            provenance: item.provenance || 'inferred',
            hidden,
            revealed: !hidden,
            discovery: hidden ? Math.round(clamp(item.confidence, 0, 1, 0.7) * 100) : 100,
            note: item.summary || '',
            evidence: item.reason ? [item.reason] : [],
            source: `${item.source || 'proposal'}-approved`,
            createdAt: Date.now(),
        });
    } else {
        const section = forceHidden
            ? 'hidden'
            : (SECTIONS.includes(item.section) ? item.section : 'private');
        profile.personality[section].push({
            id: uid('trait'),
            name: item.title || 'Unnamed trait',
            value: clamp(item.value, 0, 100, 65),
            provenance: item.provenance || 'inferred',
            awareness: section === 'hidden' ? 'low' : 'moderate',
            note: item.summary || '',
            evidence: item.reason ? [item.reason] : [],
            source: `${item.source || 'proposal'}-approved`,
            createdAt: Date.now(),
        });
    }

    remove(profile, item.id);
    save();
    emit(CHANGED, { reason: 'discovery-accepted' });
    const canHide = item.target !== 'track';
    toast.success(forceHidden && canHide ? 'Added, sealed until you reveal it.' : 'Added to the dossier.');
}

function edit(profile, item) {
    const shared = [
        { name: 'summary', label: 'Summary', type: 'textarea', value: item.summary || '' },
        { name: 'reason', label: 'Evidence', type: 'textarea', value: item.reason || '' },
    ];

    if (item.target === 'journal') {
        openModal({
            title: 'Edit proposal',
            fields: [
                {
                    name: 'kind', label: 'What is it', type: 'select', value: item.kind || 'entry',
                    options: JOURNAL_KINDS.map(([value, label]) => ({ value, label })),
                },
                { name: 'date', label: 'Date', value: item.date || '' },
                { name: 'body', label: 'Entry', type: 'textarea', value: item.body || '' },
                { name: 'mood', label: 'Mood', value: item.mood || '' },
            ],
            onSubmit: values => {
                item.kind = JOURNAL_KINDS.some(([key]) => key === values.kind) ? values.kind : item.kind;
                item.date = String(values.date || '').trim();
                item.body = String(values.body || '').trim() || item.body;
                item.mood = String(values.mood || '').trim();
                item.title = item.date || labelFor(JOURNAL_KINDS, item.kind);
                save();
                emit(CHANGED, { reason: 'discovery-edited' });
            },
        });
        return;
    }

    if (item.target === 'social') {
        openModal({
            title: 'Edit proposal',
            fields: [
                {
                    name: 'account', label: 'Which account', type: 'select', value: item.account || 'main',
                    options: SOCIAL_ACCOUNTS.map(([value, label]) => ({ value, label })),
                },
                { name: 'body', label: 'Post', type: 'textarea', value: item.body || '' },
                { name: 'date', label: 'When', value: item.date || '' },
                { name: 'likes', label: 'Likes', type: 'number', value: clamp(item.likes, 0, 9999999, 0) },
            ],
            onSubmit: values => {
                item.account = SOCIAL_ACCOUNTS.some(([key]) => key === values.account) ? values.account : item.account;
                item.body = String(values.body || '').trim() || item.body;
                item.date = String(values.date || '').trim();
                item.likes = clamp(values.likes, 0, 9999999, 0);
                item.title = labelFor(SOCIAL_ACCOUNTS, item.account);
                save();
                emit(CHANGED, { reason: 'discovery-edited' });
            },
        });
        return;
    }

    if (item.target === 'track') {
        openModal({
            title: 'Edit proposal',
            fields: [
                { name: 'title', label: 'Title', value: item.title || '' },
                { name: 'artist', label: 'Artist', value: item.artist || '' },
                { name: 'playlist', label: 'Goes on', value: item.playlist || '' },
                { name: 'note', label: 'Why this one', type: 'textarea', value: item.note || '' },
            ],
            onSubmit: values => {
                item.title = String(values.title || '').trim() || item.title;
                item.artist = String(values.artist || '').trim();
                item.playlist = String(values.playlist || '').trim() || item.playlist;
                item.note = String(values.note || '').trim();
                save();
                emit(CHANGED, { reason: 'discovery-edited' });
            },
        });
        return;
    }

    if (item.target === 'favorite') {
        openModal({
            title: 'Edit proposal',
            fields: [
                { name: 'category', label: 'Category', value: item.category || '' },
                { name: 'favoriteValue', label: 'What is it', value: item.favoriteValue || '' },
                ...shared,
            ],
            onSubmit: values => {
                item.category = String(values.category || '').trim() || item.category;
                item.favoriteValue = String(values.favoriteValue || '').trim() || item.favoriteValue;
                item.title = `Favourite ${item.category}`;
                item.summary = String(values.summary || '').trim();
                item.reason = String(values.reason || '').trim();
                save();
                emit(CHANGED, { reason: 'discovery-edited' });
            },
        });
        return;
    }

    openModal({
        title: 'Edit proposal',
        fields: [
            { name: 'title', label: 'Trait', value: item.title || '' },
            {
                name: 'section', label: 'Who sees it', type: 'select',
                value: SECTIONS.includes(item.section) ? item.section : 'private',
                options: [
                    { value: 'public', label: 'Public' },
                    { value: 'private', label: 'Private' },
                    { value: 'hidden', label: 'Hidden' },
                ],
            },
            { name: 'value', label: 'Strength', type: 'range', min: 0, max: 100, value: clamp(item.value, 0, 100, 65) },
            ...shared,
        ],
        onSubmit: values => {
            item.title = String(values.title || '').trim() || item.title;
            item.section = SECTIONS.includes(values.section) ? values.section : item.section;
            item.value = clamp(values.value, 0, 100, item.value ?? 65);
            item.summary = String(values.summary || '').trim();
            item.reason = String(values.reason || '').trim();
            save();
            emit(CHANGED, { reason: 'discovery-edited' });
        },
    });
}

function handle({ decision, id }) {
    const profile = getProfile(false);
    const item = profile?.discoveries?.find(entry => entry.id === id);
    if (!profile || !item) return;

    switch (decision) {
        case 'accept':
            accept(profile, item);
            return;
        case 'hidden':
            accept(profile, item, { forceHidden: true });
            return;
        case 'edit':
            edit(profile, item);
            return;
        case 'reject':
            remove(profile, id);
            save();
            emit(CHANGED, { reason: 'discovery-rejected' });
            toast.info('Proposal rejected.');
            return;
        default:
    }
}

let initialized = false;

export function initApprovals() {
    if (initialized) return;
    initialized = true;
    on(ACTION, event => {
        if (event.detail?.type === 'discovery') handle(event.detail);
    });
}

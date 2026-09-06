/**
 * Offstage — suggestion generation.
 * The prompts and normalising that turn a request ("write a journal entry",
 * "suggest three traits") into structured suggestions. Shared by the AI Fill
 * sheet and by the analyzer's automatic writing, so both speak the same way.
 */

import {
    JOURNAL_KINDS, PROVENANCE, SECTIONS, SOCIAL_ACCOUNTS,
    buildCardContext, buildExistingState, buildTranscript, clamp,
    getCurrentCharacter, getProfile, getSettings,
} from './core.js';
import { connectionLabel, generate, parseJson } from './llm.js';

/** The JSON object the model must return for each mode. */
const SHAPES = {
    trait: '{"type":"trait","name":"","section":"public|private|hidden","value":65,"provenance":"","confidence":0.8,"rationale":""}',
    favorite: '{"type":"favorite","category":"","value":"","provenance":"","confidence":0.8,"rationale":""}',
    journal: '{"type":"journal","kind":"entry|letter|note|dream","date":"","body":"","mood":"","provenance":"","confidence":0.8,"rationale":""}',
    social: '{"type":"social","account":"main|alt|close|draft","body":"","date":"","likes":0,"provenance":"","confidence":0.8,"rationale":""}',
    track: '{"type":"track","title":"","artist":"","playlist":"","note":"","provenance":"","confidence":0.8,"rationale":""}',
};

const SHAPES_FOR = {
    personality: ['trait'],
    favorites: ['favorite'],
    profile: ['trait', 'favorite'],
    journal: ['journal'],
    social: ['social'],
    music: ['track'],
};

/* ---------------------------------------------------------------- prompts */

function voiceRules(target) {
    if (target === 'journal') {
        return `
This is writing, not analysis. Write the entry as the character wrote it:
- First person, their vocabulary, their sentence length, their blind spots.
- 80 to 200 words. No narration, no stage directions, no quotation marks around the whole thing.
- They are not explaining themselves to a reader. They can be unfair, evasive, or wrong.
- A letter is addressed to someone and never sent. A note is short and practical. A dream is disordered.
- Only reference things that exist in their world. If they would have no way to write, say so in the rationale instead of inventing an entry.
- date is whatever their world would call the day, or empty if that makes no sense.`;
    }
    if (target === 'social') {
        return `
This is writing, not analysis. Write the post as the character posted it:
- Their voice, their register, the length people actually post at. Short.
- The public account is curated. The private account is blunter. Close friends is unguarded. A draft is something they typed and never sent.
- No hashtags unless they are the kind of person who uses them.
- This only works in a setting that has social media. If their world has none, return no suggestions and explain why in the rationale.
- likes should be plausible for who they are, or 0.`;
    }
    if (target === 'music') {
        return `
- Real songs and real artists only, and only ones this character could have heard.
- If the setting has no recorded music, propose in-world songs, ballads, or hymns instead and name the singer or tradition.
- note says what this song is to them, in one line. Be specific about the moment or the feeling, not the genre.
- playlist is a short name in their voice, not a category label.`;
    }
    return '';
}

function systemPrompt(target, allowHeadcanon) {
    const headcanon = allowHeadcanon
        ? 'If a requested detail is not explicit, you MAY make a plausible, specific choice from the character\'s personality, setting, history, habits, and values. Mark those choices provenance="headcanon". That is deliberate extrapolation, not canon.'
        : 'If a detail is not explicitly stated or strongly supported, leave it out. Do not invent headcanon.';

    const shapes = (SHAPES_FOR[target] || ['trait']).map(key => SHAPES[key]).join(',');

    return `You are Offstage's character builder. The user has asked you to fill part of a character dossier. Read the card, the recent roleplay, and the existing dossier before choosing anything.

${headcanon}

Rules:
- Return JSON only. No markdown, no code fences.
- Never contradict explicit card canon or established roleplay.
- Never repeat something already in the dossier.
- Stay inside the setting. A fantasy character gets ballads, festivals, fabrics and foods that exist in their world, not modern films or apps.
- Make choices specific to this character, not archetype filler.
- provenance is one of ${PROVENANCE.join(', ')}.
- confidence is 0 to 1 and means how well the choice fits this character.
- rationale explains the reasoning in one sentence without dressing headcanon up as fact.
- Requested mode: ${target}.
${voiceRules(target)}

Return exactly: {"suggestions":[${shapes}]}
Only return suggestion types listed above.`;
}

function request({ target, count, section, category }) {
    switch (target) {
        case 'personality':
            return `Suggest ${count} personality trait(s). Visibility preference: ${section || 'auto'}. Focus: ${category || 'your judgement'}.`;
        case 'favorites':
            return `Suggest ${count} favourite(s). Requested category: ${category || 'your choice'}. Stay in that category unless repeating it would be redundant.`;
        case 'journal':
            return `Write ${count} journal entr${count === 1 ? 'y' : 'ies'}. Kind: ${section === 'auto' ? 'whatever fits' : section}. Subject: ${category || 'the scene in the recent roleplay below'}.`;
        case 'social':
            return `Write ${count} post(s). Account: ${section === 'auto' ? 'whichever fits the content' : section}. Subject: ${category || 'the scene in the recent roleplay below'}.`;
        case 'music':
            return `Suggest ${count} song(s) for one playlist. Playlist kind: ${section === 'auto' ? 'your choice' : section}. Playlist name: ${category || 'name it yourself'}. Use the same playlist name for every song.`;
        default:
            return `Suggest ${count} dossier entries. Lean towards: ${section || 'balanced'}. Mix traits and favourites unless the lean says otherwise.`;
    }
}

function userPrompt(options) {
    const character = getCurrentCharacter();
    const profile = getProfile();
    const settings = getSettings();

    return [
        `CHARACTER: ${character?.name || 'Unknown'}`,
        `REQUEST:\n${request(options)}\nHeadcanon allowed: ${options.allowHeadcanon ? 'yes' : 'no'}\nExtra guidance: ${options.guidance || '(none)'}`,
        `CHARACTER CARD:\n${buildCardContext(character, { includeFirstMessage: true }) || '(No card details available.)'}`,
        `RECENT ROLEPLAY:\n${buildTranscript(clamp(settings?.aiFill?.contextMessages, 8, 80, 30), { budget: 26000, perMessage: 4000 }) || '(No recent roleplay.)'}`,
        `EXISTING DOSSIER:\n${buildExistingState(profile, { includeQueued: false }) || '(Empty.)'}`,
        'Make the most character-specific choices you can.',
    ].join('\n\n');
}

/* ------------------------------------------------------------ normalising */

function normalize(raw, target) {
    const allowed = SHAPES_FOR[target] || ['trait'];
    if (!allowed.includes(raw?.type)) return null;

    const base = {
        kind: raw.type,
        provenance: PROVENANCE.includes(raw.provenance) ? raw.provenance : 'headcanon',
        confidence: clamp(raw.confidence, 0, 1, 0.7),
        rationale: String(raw.rationale || '').trim(),
    };

    if (raw.type === 'trait') {
        const name = String(raw.name || '').trim();
        if (!name) return null;
        return {
            ...base, name,
            section: SECTIONS.includes(raw.section) ? raw.section : 'private',
            value: clamp(raw.value, 0, 100, 65),
        };
    }

    if (raw.type === 'favorite') {
        const category = String(raw.category || '').trim();
        const value = String(raw.value || '').trim();
        if (!category || !value) return null;
        return { ...base, category, value };
    }

    if (raw.type === 'journal') {
        const text = String(raw.body || '').trim();
        if (!text) return null;
        return {
            ...base, body: text,
            entryKind: JOURNAL_KINDS.some(([key]) => key === raw.kind) ? raw.kind : 'entry',
            date: String(raw.date || '').trim(),
            mood: String(raw.mood || '').trim(),
        };
    }

    if (raw.type === 'social') {
        const text = String(raw.body || '').trim();
        if (!text) return null;
        return {
            ...base, body: text,
            account: SOCIAL_ACCOUNTS.some(([key]) => key === raw.account) ? raw.account : 'main',
            date: String(raw.date || '').trim(),
            likes: clamp(raw.likes, 0, 9999999, 0),
        };
    }

    if (raw.type === 'track') {
        const title = String(raw.title || '').trim();
        if (!title) return null;
        return {
            ...base, title,
            artist: String(raw.artist || '').trim(),
            playlist: String(raw.playlist || '').trim() || 'Current rotation',
            note: String(raw.note || '').trim(),
        };
    }

    return null;
}

/* --------------------------------------------------------------- requests */

const WRITTEN = ['journal', 'social'];

export function isWritten(target) {
    return WRITTEN.includes(target);
}

/**
 * Ask the model for suggestions and return them normalised.
 * @returns {Promise<Array<object>>}
 */
export async function generateSuggestions(options) {
    const input = {
        target: options.target,
        count: clamp(options.count, 1, 8, 3),
        section: options.section || 'auto',
        category: options.category || '',
        guidance: options.guidance || '',
        allowHeadcanon: options.allowHeadcanon !== false,
    };

    const { content } = await generate({
        system: systemPrompt(input.target, input.allowHeadcanon),
        prompt: userPrompt(input),
        maxTokens: isWritten(input.target) ? 1800 : 1200,
    });

    const parsed = parseJson(content);
    return (Array.isArray(parsed?.suggestions) ? parsed.suggestions : [])
        .map(item => normalize(item, input.target))
        .filter(Boolean)
        .slice(0, input.count);
}

/** Turn a normalised suggestion into a proposal the Discovery Inbox understands. */
export function toProposal(item, { source = 'ai-fill' } = {}) {
    const rationale = String(item.rationale || '').trim();
    const shared = {
        source,
        provenance: item.provenance || 'headcanon',
        summary: rationale,
        reason: rationale || `Suggested using ${connectionLabel()}.`,
    };

    switch (item.kind) {
        case 'trait':
            return item.name ? {
                ...shared, target: 'trait', type: 'Suggested trait',
                title: item.name, section: item.section, value: item.value,
            } : null;
        case 'favorite':
            return item.category && item.value ? {
                ...shared, target: 'favorite', type: 'Suggested favourite',
                category: item.category, favoriteValue: item.value, section: 'private',
            } : null;
        case 'journal':
            return item.body ? {
                ...shared, target: 'journal', body: item.body,
                kind: item.entryKind, date: item.date, mood: item.mood,
            } : null;
        case 'social':
            return item.body ? {
                ...shared, target: 'social', body: item.body,
                account: item.account, date: item.date, likes: item.likes,
            } : null;
        case 'track':
            return item.title ? {
                ...shared, target: 'track', title: item.title,
                artist: item.artist, playlist: item.playlist, note: item.note,
            } : null;
        default:
            return null;
    }
}

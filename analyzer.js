/**
 * Offstage — automatic character analysis.
 * Reads recent roleplay through the user's RP connection and proposes durable
 * traits and tastes. Proposals always go to the Discovery Inbox; only the
 * transient mood/currently/energy line is written directly.
 */

import {
    CHANGED,
    buildCardContext, buildExistingState, buildTranscript, clamp, ctx, emit,
    getCurrentCharacter, getCharacterKey, getProfile, getSettings, isGroupChat,
    pruneHistory, save, toast,
} from './core.js';
import { connectionLabel, describeError, generate, parseJson } from './llm.js';
import { makeDiscovery, queueDiscoveries } from './approvals.js';
import { generateSuggestions, toProposal } from './writing.js';

export const STATUS = 'offstage:status';

const MIN_CONFIDENCE = 0.65;
const MAX_PER_SCAN = 6;

let inFlight = false;
let autoTimer = null;
let initialized = false;

function setStatus(text) {
    const settings = getSettings();
    if (settings) {
        settings.analysis.lastStatus = text;
        save();
    }
    emit(STATUS, { text, connection: connectionLabel(), busy: inFlight });
}

export function isAnalyzing() {
    return inFlight;
}

function historyKey() {
    const context = ctx();
    const key = getCharacterKey();
    if (!context || !key) return null;
    return `${key}::${context.chatId || context.getCurrentChatId?.() || 'default-chat'}`;
}

/* ---------------------------------------------------------------- prompts */

function systemPrompt() {
    return `You are Offstage, a conservative character-continuity analyst for a roleplay app.
Analyse ONLY the supplied character card and recent roleplay for the named character.

Rules:
- Return JSON only. No markdown, no code fences, no commentary.
- A single joke, line, or one-off action is not a stable trait. Prefer repeated behavioural evidence.
- A favourite must be explicit or strongly and repeatedly supported. Never invent one to fill a category.
- Stay inside the setting. Do not introduce modern media, brands, technology, food, or institutions in a historical or fantasy setting unless the supplied material supports them.
- provenance: "canon" = stated on the character card; "established" = stated in roleplay; "inferred" = repeated behaviour; "emergent" = developed during this roleplay.
- section describes who can see the trait. "hidden" covers secrets and blind spots the character would not admit to.
- Mood and current state are allowed to change quickly. Durable facts are not: do not contradict a known fact because of one recent message.
- At most ${MAX_PER_SCAN} durable proposals. Omit anything you cannot support.
- confidence is between 0 and 1.

Also report how much actually changed in this stretch of roleplay, in "event":
- significance is 0 when nothing of consequence happened and 1 when something happened that the character will still be turning over weeks from now. A confession, a betrayal, a death, a first touch, a decision that cannot be taken back, or a clear shift in how they feel about someone all score high. Banter, travel, planning, and routine score low.
- kind is "event" for something that happened, "relationship" for a change in how they feel about someone, or "none".
- summary is one sentence naming it, from the character's side.

Return exactly this shape:
{"transient":{"mood":"","currentState":"","energy":0},
 "event":{"significance":0.0,"kind":"event|relationship|none","summary":""},
 "discoveries":[
  {"target":"trait","title":"","section":"public|private|hidden","value":0,"summary":"","evidence":"","provenance":"canon|established|inferred|emergent","confidence":0.0},
  {"target":"favorite","category":"","favoriteValue":"","section":"private","summary":"","evidence":"","provenance":"canon|established|inferred|emergent","confidence":0.0}
 ]}`;
}

function userPrompt(character, profile, contextMessages) {
    return [
        `CHARACTER: ${character.name || 'Unknown'}`,
        `CHARACTER CARD:\n${buildCardContext(character) || '(No card details available.)'}`,
        `CURRENT DOSSIER:\n${buildExistingState(profile) || '(Nothing recorded yet.)'}`,
        `RECENT ROLEPLAY:\n${buildTranscript(contextMessages) || '(No recent roleplay.)'}`,
        'Analyse this character now.',
    ].join('\n\n');
}

function normalize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (clamp(raw.confidence, 0, 1, 0) < MIN_CONFIDENCE) return null;

    return makeDiscovery({
        ...raw,
        source: 'analyzer',
        reason: raw.evidence,
        type: raw.target === 'favorite'
            ? 'Noticed in the roleplay'
            : (raw.section === 'hidden' ? 'Possible hidden trait' : 'Possible trait'),
    });
}

/* --------------------------------------------------------------- analysis */

export async function analyze({ manual = false } = {}) {
    if (inFlight) {
        if (manual) toast.info('Already analysing this character.');
        return false;
    }

    const context = ctx();
    const settings = getSettings();
    const character = getCurrentCharacter();
    const profile = character ? getProfile() : null;

    if (isGroupChat()) {
        setStatus('Group chats are not supported yet.');
        if (manual) toast.warning('Offstage analyses one character at a time. Open a single-character chat.');
        return false;
    }
    if (!context || !settings || !character || !profile) {
        setStatus('Waiting for a character chat.');
        if (manual) toast.warning('Open a character chat first.');
        return false;
    }
    if (!Array.isArray(context.chat) || context.chat.length < 2) {
        setStatus('Not enough roleplay to read yet.');
        if (manual) toast.info('There is not enough roleplay to analyse yet.');
        return false;
    }

    inFlight = true;
    setStatus(`Reading ${character.name}…`);

    try {
        const { content, connection } = await generate({
            system: systemPrompt(),
            prompt: userPrompt(character, profile, clamp(settings.analysis.contextMessages, 6, 80, 24)),
            maxTokens: 3000,
        });
        const parsed = parseJson(content);

        if (settings.analysis.updateTransient !== false && parsed?.transient) {
            const mood = String(parsed.transient.mood || '').trim();
            const currentState = String(parsed.transient.currentState || '').trim();
            const energy = Number(parsed.transient.energy);
            if (mood) profile.mood = mood.slice(0, 100);
            if (currentState) profile.currentState = currentState.slice(0, 160);
            if (Number.isFinite(energy)) profile.energy = clamp(energy, 0, 100, profile.energy);
        }

        const proposals = (Array.isArray(parsed?.discoveries) ? parsed.discoveries : [])
            .map(normalize)
            .filter(Boolean)
            .slice(0, MAX_PER_SCAN);

        const { queued } = queueDiscoveries(proposals);

        const key = historyKey();
        if (key) {
            settings.analysis.history[key] = Object.assign(settings.analysis.history[key] || {}, {
                lastIndex: context.chat.length - 1,
                lastAt: Date.now(),
                lastAdded: queued,
            });
            pruneHistory();
        }
        profile.analysisMeta.lastAnalyzedAt = Date.now();
        profile.analysisMeta.lastAnalyzedMessage = context.chat.length - 1;
        profile.analysisMeta.lastConnection = connection;
        save();

        setStatus(queued
            ? `${queued} new ${queued === 1 ? 'proposal' : 'proposals'} waiting in Discoveries.`
            : 'Nothing new worth recording.');
        emit(CHANGED, { reason: 'analysis' });

        await maybeWriteJournal(parsed?.event, key);

        if (queued) {
            toast.success(`Offstage noticed ${queued} new ${queued === 1 ? 'thing' : 'things'} about ${character.name}.`);
        } else if (manual) {
            toast.info('No new durable details this time. Mood and status may still have changed.');
        }
        return true;
    } catch (error) {
        console.error('[Offstage] Analysis failed:', error);
        const detail = describeError(error);
        setStatus(`Analysis failed: ${detail}`);
        toast.error(`Analysis failed on ${connectionLabel()}. ${detail}`, { timeOut: 9000 });
        return false;
    } finally {
        inFlight = false;
        emit(STATUS, { text: getSettings()?.analysis?.lastStatus || 'Ready', connection: connectionLabel(), busy: false });
    }
}

/* ------------------------------------------------------- automatic writing */

function pendingFrom(profile, source) {
    return (profile?.discoveries || []).filter(item => item.source === source).length;
}

/**
 * Generate one written item and queue it for approval.
 * Assumes the caller owns the in-flight lock.
 */
async function writeAuto(target, { category = '', source }) {
    try {
        const items = await generateSuggestions({
            target,
            count: 1,
            section: 'auto',
            category,
            allowHeadcanon: true,
        });
        const proposals = items.map(item => toProposal(item, { source })).filter(Boolean);
        const { queued } = queueDiscoveries(proposals, { toFront: true });
        if (queued) emit(CHANGED, { reason: source });
        return queued;
    } catch (error) {
        console.error(`[Offstage] Automatic ${target} failed:`, error);
        setStatus(`Automatic ${target} failed: ${describeError(error)}`);
        return 0;
    }
}

/**
 * Journals are written when something happened, not on a timer. The analyzer
 * has just read the transcript and scored it, so this costs one extra call
 * only when that score crosses the threshold.
 */
async function maybeWriteJournal(event, key) {
    const settings = getSettings();
    const profile = getProfile(false);
    const context = ctx();
    const config = settings?.analysis?.journal;
    if (!config?.enabled || !profile || !key || !context) return;

    const significance = clamp(event?.significance, 0, 1, 0);
    if (significance < clamp(config.threshold, 0, 1, 0.7)) return;

    const state = settings.analysis.history[key] || {};
    if (state.lastJournalIndex !== undefined
        && repliesSince(state.lastJournalIndex) < clamp(config.minReplies, 1, 50, 8)) return;
    if (pendingFrom(profile, 'auto-journal') >= clamp(config.maxQueued, 1, 10, 2)) return;

    setStatus('Something happened. Writing it down…');
    const queued = await writeAuto('journal', {
        category: String(event?.summary || '').trim(),
        source: 'auto-journal',
    });

    state.lastJournalIndex = context.chat.length - 1;
    settings.analysis.history[key] = state;
    save();

    if (queued) {
        setStatus('A journal entry is waiting in Discoveries.');
        toast.success('Offstage wrote a journal entry about that. It is waiting for your approval.');
    }
}

/** Posts run on their own cadence, because posting is a habit rather than a reaction. */
async function maybeWriteSocial(key) {
    const settings = getSettings();
    const profile = getProfile(false);
    const context = ctx();
    const config = settings?.analysis?.social;
    if (!config?.enabled || !profile || !key || !context) return;

    const state = settings.analysis.history[key] || {};
    const latest = context.chat.length - 1;

    // Start counting from now rather than firing immediately on an existing chat.
    if (state.lastSocialIndex === undefined) {
        state.lastSocialIndex = latest;
        settings.analysis.history[key] = state;
        save();
        return;
    }

    if (repliesSince(state.lastSocialIndex) < clamp(config.interval, 1, 50, 5)) return;
    if (pendingFrom(profile, 'auto-social') >= clamp(config.maxQueued, 1, 10, 3)) {
        state.lastSocialIndex = latest;
        save();
        return;
    }

    inFlight = true;
    setStatus('Seeing whether they would post about this…');
    let queued = 0;
    try {
        queued = await writeAuto('social', { source: 'auto-social' });
    } finally {
        inFlight = false;
    }

    state.lastSocialIndex = latest;
    settings.analysis.history[key] = state;
    save();

    if (queued) {
        setStatus('A post is waiting in Discoveries.');
        toast.success('Offstage drafted a post. It is waiting for your approval.');
    } else {
        setStatus('Nothing they would post about.');
    }
}

/* ---------------------------------------------------------------- trigger */

function repliesSince(lastIndex) {
    const chat = ctx()?.chat;
    if (!Array.isArray(chat)) return 0;
    return chat.slice(Math.max(0, Number(lastIndex) + 1))
        .filter(message => !message?.is_user && !message?.is_system && String(message?.mes ?? '').trim())
        .length;
}

async function maybeRun(messageIndex, source) {
    const settings = getSettings();
    const context = ctx();
    if (!settings?.analysis.enabled || !context || isGroupChat() || inFlight) return;
    if (source === 'extension') return;

    const message = context.chat?.[messageIndex];
    if (message?.is_user || message?.is_system) return;

    const key = historyKey();
    if (!key) return;

    settings.analysis.history[key] ??= { lastIndex: -1 };
    const state = settings.analysis.history[key];
    const required = clamp(settings.analysis.interval, 1, 50, 5);
    const count = repliesSince(state.lastIndex);

    if (count < required) {
        setStatus(`${count} of ${required} replies until the next scan.`);
    } else {
        await analyze({ manual: false });
    }

    await maybeWriteSocial(key);
}

export function initAnalyzer(attempt = 0) {
    if (initialized) return;

    const context = ctx();
    const events = context?.eventTypes ?? context?.event_types;
    if (!context?.eventSource || !events) {
        if (attempt < 8) setTimeout(() => initAnalyzer(attempt + 1), 500);
        return;
    }
    initialized = true;

    if (events.MESSAGE_RECEIVED) {
        context.eventSource.on(events.MESSAGE_RECEIVED, (index, source) => {
            clearTimeout(autoTimer);
            autoTimer = setTimeout(() => void maybeRun(index, source), 1400);
        });
    }
    if (events.CHAT_CHANGED) {
        context.eventSource.on(events.CHAT_CHANGED, () => setStatus('Ready.'));
    }
    for (const name of [events.CONNECTION_PROFILE_LOADED, events.CONNECTION_PROFILE_UPDATED]) {
        if (name) context.eventSource.on(name, () => setStatus(`Using ${connectionLabel()}.`));
    }
}

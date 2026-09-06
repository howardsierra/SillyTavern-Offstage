/**
 * Offstage — AI Fill.
 * The user explicitly asks the model to propose something. Suggestions appear
 * in an editable preview, then go to the Discovery Inbox for approval.
 * Nothing here writes to the dossier directly.
 */

import {
    ACTION, CHANGED, JOURNAL_KINDS, PLAYLIST_KINDS, SECTIONS, SOCIAL_ACCOUNTS,
    applyTheme, clamp, emit, escapeHtml, getCurrentCharacter, getSettings, on, save, toast,
} from './core.js';
import { connectionLabel, describeError } from './llm.js';
import { generateSuggestions, isWritten, toProposal } from './writing.js';
import { queueDiscoveries } from './approvals.js';
import { goToTab } from './ui.js';

const SHEET_ID = 'offstage-sheet';

const CATEGORY_SUGGESTIONS = [
    'Food', 'Drink', 'Colour', 'Scent', 'Flower or plant', 'Season', 'Weather', 'Animal',
    'Hobby', 'Book or story', 'Art or entertainment', 'Music', 'Clothing', 'Place',
    'Comfort object', 'Ideal gift', 'Pet peeve', 'Guilty pleasure',
];

const COPY = {
    personality: { title: 'Suggest traits', sub: name => `Ask your roleplay model for traits that fit ${name}.` },
    favorites: { title: 'Suggest a favourite', sub: () => 'Pick a category, or let the model choose something that suits them.' },
    profile: { title: 'Suggest a starting profile', sub: () => 'A balanced first pass across traits and tastes.' },
    journal: { title: 'Write about this scene', sub: name => `In ${name}'s own voice, about what just happened.` },
    social: { title: 'Suggest a post', sub: name => `Something ${name} would actually put online.` },
    music: { title: 'Suggest music', sub: name => `Songs ${name} would keep coming back to.` },
};

let generating = false;
let initialized = false;

/* ------------------------------------------------------------------ sheet */

function close() {
    document.getElementById(SHEET_ID)?.remove();
}

function open(target) {
    close();
    const character = getCurrentCharacter();
    if (!character) {
        toast.warning('Open a character chat first.');
        return;
    }

    const settings = getSettings();
    const copy = COPY[target] || { title: 'Suggest details', sub: () => '' };
    const writes = isWritten(target);

    const sheet = document.createElement('div');
    sheet.id = SHEET_ID;
    sheet.dataset.target = target;
    applyTheme(sheet);
    sheet.innerHTML = `
        <div class="off-sheet-backdrop" data-sheet-close></div>
        <section class="off-sheet" role="dialog" aria-modal="true" aria-label="${escapeHtml(copy.title)}">
            <header class="off-sheet-head">
                <div>
                    <h2>${escapeHtml(copy.title)}</h2>
                    <p>${escapeHtml(copy.sub(character.name))}</p>
                </div>
                <button class="off-close" type="button" data-sheet-close aria-label="Close">
                    <span aria-hidden="true">×</span><span class="off-close-word">Close</span>
                </button>
            </header>

            <div class="off-sheet-body">
                <p class="off-sheet-connection">Running on ${escapeHtml(connectionLabel())}</p>
                ${fields(target)}
                <label>
                    <span>Anything to steer it</span>
                    <textarea id="off-guidance" rows="3" placeholder="Optional. Leave blank and let the model decide."></textarea>
                </label>
                <label class="off-check">
                    <input id="off-headcanon" type="checkbox" ${settings?.aiFill?.allowHeadcanon !== false ? 'checked' : ''}>
                    <span>Allow headcanon. If the card and roleplay do not answer the question, the model may make a plausible choice and label it as headcanon.</span>
                </label>
                <p class="off-note">${writes
                    ? 'Written in first person, in their voice, using only what their world contains. Goes to Discoveries for your approval.'
                    : 'Card canon and established roleplay always win. Suggestions go to Discoveries for your approval before anything is added.'}</p>
                <div class="off-sheet-actions">
                    <button class="off-btn off-btn-primary" type="button" id="off-generate">Generate</button>
                    <button class="off-btn" type="button" data-sheet-close>Cancel</button>
                </div>
                <div id="off-results"></div>
            </div>
        </section>`;
    document.body.appendChild(sheet);

    sheet.querySelectorAll('[data-sheet-close]').forEach(element =>
        element.addEventListener('click', close));
    sheet.querySelector('#off-generate').addEventListener('click', () => void run(target));
    sheet.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.stopPropagation(); close(); }
    });
    requestAnimationFrame(() => sheet.querySelector('input, select, textarea')?.focus());
}

function countField(min, max, value) {
    return `<label><span>How many</span><input id="off-count" type="number" min="${min}" max="${max}" value="${value}"></label>`;
}

function fields(target) {
    if (target === 'personality') {
        return `
            <div class="off-field-row">
                <label><span>Who sees it</span>
                    <select id="off-section">
                        <option value="auto">Let the model choose</option>
                        ${SECTIONS.map(section => `<option value="${section}">${section}</option>`).join('')}
                    </select>
                </label>
                ${countField(1, 5, 3)}
            </div>
            <label><span>Focus</span>
                <input id="off-category" placeholder="Optional. Jealousy, humour, how they handle conflict…">
            </label>`;
    }

    if (target === 'favorites') {
        return `
            <div class="off-field-row">
                <label><span>Category</span>
                    <input id="off-category" list="off-category-list" placeholder="Food, colour, song… or leave blank">
                    <datalist id="off-category-list">
                        ${CATEGORY_SUGGESTIONS.map(item => `<option value="${escapeHtml(item)}">`).join('')}
                    </datalist>
                </label>
                ${countField(1, 6, 3)}
            </div>`;
    }

    if (target === 'journal') {
        return `
            <div class="off-field-row">
                <label><span>What kind</span>
                    <select id="off-section">
                        <option value="auto">Whatever fits</option>
                        ${JOURNAL_KINDS.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}
                    </select>
                </label>
                ${countField(1, 3, 1)}
            </div>
            <label><span>What is it about</span>
                <input id="off-category" placeholder="Leave blank to write about the scene you just played">
            </label>`;
    }

    if (target === 'social') {
        return `
            <div class="off-field-row">
                <label><span>Which account</span>
                    <select id="off-section">
                        <option value="auto">Let the model choose</option>
                        ${SOCIAL_ACCOUNTS.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}
                    </select>
                </label>
                ${countField(1, 4, 2)}
            </div>
            <label><span>What is it about</span>
                <input id="off-category" placeholder="Leave blank to post about the scene you just played">
            </label>`;
    }

    if (target === 'music') {
        return `
            <div class="off-field-row">
                <label><span>What kind of playlist</span>
                    <select id="off-section">
                        <option value="auto">Let the model choose</option>
                        ${PLAYLIST_KINDS.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}
                    </select>
                </label>
                ${countField(1, 8, 4)}
            </div>
            <label><span>Playlist name</span>
                <input id="off-category" placeholder="Leave blank and the model will name it">
            </label>`;
    }

    return `
        <div class="off-field-row">
            <label><span>Lean towards</span>
                <select id="off-section">
                    <option value="balanced">A balanced mix</option>
                    <option value="personality">Mostly traits</option>
                    <option value="favorites">Mostly tastes</option>
                    <option value="hidden">Secrets and hidden traits</option>
                </select>
            </label>
            ${countField(2, 8, 6)}
        </div>`;
}

/* ---------------------------------------------------------------- results */

function meta(item) {
    return `<p class="off-result-meta">${item.provenance} · ${Math.round(item.confidence * 100)}% fit</p>`;
}

function resultCard(item, index) {
    const shell = inner => `
        <article class="off-result" data-index="${index}" data-kind="${item.kind}" data-provenance="${item.provenance}">
            <label class="off-check off-result-pick">
                <input type="checkbox" class="off-pick" checked aria-label="Include this suggestion">
                <span class="off-visually-hidden">Include</span>
            </label>
            <div class="off-result-body">${inner}</div>
        </article>`;

    if (item.kind === 'trait') {
        return shell(`
            <div class="off-field-row">
                <input class="off-field-name" value="${escapeHtml(item.name)}" aria-label="Trait">
                <select class="off-field-section" aria-label="Visibility">
                    ${SECTIONS.map(section => `<option value="${section}" ${item.section === section ? 'selected' : ''}>${section}</option>`).join('')}
                </select>
            </div>
            <div class="off-field-row">
                <label class="off-inline"><span>Strength</span>
                    <input class="off-field-value" type="number" min="0" max="100" value="${item.value}">
                </label>
                ${meta(item)}
            </div>
            <p class="off-result-why">${escapeHtml(item.rationale)}</p>`);
    }

    if (item.kind === 'favorite') {
        return shell(`
            <div class="off-field-row">
                <input class="off-field-category" value="${escapeHtml(item.category)}" aria-label="Category">
                ${meta(item)}
            </div>
            <input class="off-field-favorite" value="${escapeHtml(item.value)}" aria-label="Favourite">
            <p class="off-result-why">${escapeHtml(item.rationale)}</p>`);
    }

    if (item.kind === 'journal') {
        return shell(`
            <div class="off-field-row">
                <select class="off-field-entrykind" aria-label="Kind">
                    ${JOURNAL_KINDS.map(([value, label]) => `<option value="${value}" ${item.entryKind === value ? 'selected' : ''}>${label}</option>`).join('')}
                </select>
                <input class="off-field-date" value="${escapeHtml(item.date)}" placeholder="Date" aria-label="Date">
            </div>
            <textarea class="off-field-body" rows="7" aria-label="Entry">${escapeHtml(item.body)}</textarea>
            <div class="off-field-row">
                <input class="off-field-mood" value="${escapeHtml(item.mood)}" placeholder="Mood" aria-label="Mood">
                ${meta(item)}
            </div>
            <p class="off-result-why">${escapeHtml(item.rationale)}</p>`);
    }

    if (item.kind === 'social') {
        return shell(`
            <div class="off-field-row">
                <select class="off-field-account" aria-label="Account">
                    ${SOCIAL_ACCOUNTS.map(([value, label]) => `<option value="${value}" ${item.account === value ? 'selected' : ''}>${label}</option>`).join('')}
                </select>
                ${meta(item)}
            </div>
            <textarea class="off-field-body" rows="4" aria-label="Post">${escapeHtml(item.body)}</textarea>
            <div class="off-field-row">
                <input class="off-field-date" value="${escapeHtml(item.date)}" placeholder="When" aria-label="When">
                <label class="off-inline"><span>Likes</span>
                    <input class="off-field-likes" type="number" min="0" value="${item.likes}">
                </label>
            </div>
            <p class="off-result-why">${escapeHtml(item.rationale)}</p>`);
    }

    return shell(`
        <div class="off-field-row">
            <input class="off-field-title" value="${escapeHtml(item.title)}" aria-label="Title">
            ${meta(item)}
        </div>
        <div class="off-field-row">
            <input class="off-field-artist" value="${escapeHtml(item.artist)}" placeholder="Artist" aria-label="Artist">
            <input class="off-field-playlist" value="${escapeHtml(item.playlist)}" placeholder="Playlist" aria-label="Playlist">
        </div>
        <input class="off-field-note" value="${escapeHtml(item.note)}" placeholder="Why this one" aria-label="Note">
        <p class="off-result-why">${escapeHtml(item.rationale)}</p>`);
}

function renderResults(items) {
    const host = document.getElementById('off-results');
    if (!host) return;

    if (!items.length) {
        host.innerHTML = `<p class="off-sheet-status">The model could not justify a suggestion. Try different guidance, or allow headcanon.</p>`;
        return;
    }

    host.innerHTML = `
        <div class="off-results">
            <p class="off-results-head">Edit anything before you send it through.</p>
            ${items.map(resultCard).join('')}
            <div class="off-sheet-actions">
                <button class="off-btn off-btn-primary" type="button" id="off-send">Send to Discoveries</button>
                <button class="off-btn" type="button" id="off-regenerate">Try again</button>
            </div>
            <p class="off-note">Sending does not add anything yet. You approve each one in Discoveries.</p>
        </div>`;

    host.querySelector('#off-send').addEventListener('click', send);
    host.querySelector('#off-regenerate').addEventListener('click', () => {
        const target = document.getElementById(SHEET_ID)?.dataset.target;
        if (target) void run(target);
    });
}

async function run(target) {
    if (generating) return;
    const character = getCurrentCharacter();
    if (!character) return;

    const settings = getSettings();
    const options = {
        target,
        count: clamp(document.getElementById('off-count')?.value, 1, 8, 3),
        section: String(document.getElementById('off-section')?.value || 'auto'),
        category: String(document.getElementById('off-category')?.value || '').trim(),
        guidance: String(document.getElementById('off-guidance')?.value || '').trim(),
        allowHeadcanon: Boolean(document.getElementById('off-headcanon')?.checked),
    };
    if (settings) {
        settings.aiFill.allowHeadcanon = options.allowHeadcanon;
        save();
    }

    const writes = isWritten(target);
    const button = document.getElementById('off-generate');
    const host = document.getElementById('off-results');
    generating = true;
    if (button) { button.disabled = true; button.textContent = 'Thinking…'; }
    if (host) {
        host.innerHTML = `<p class="off-sheet-status">${writes
            ? `Working out how ${escapeHtml(character.name)} would put it…`
            : `Reading ${escapeHtml(character.name)}'s card and recent roleplay…`}</p>`;
    }

    try {
        renderResults(await generateSuggestions(options));
    } catch (error) {
        console.error('[Offstage] AI Fill failed:', error);
        if (host) {
            host.innerHTML = `<p class="off-sheet-status off-sheet-error">Could not generate suggestions. ${escapeHtml(describeError(error))}</p>`;
        }
        toast.error(`AI Fill failed. ${describeError(error)}`);
    } finally {
        generating = false;
        if (button) { button.disabled = false; button.textContent = 'Generate'; }
    }
}

/* ------------------------------------------------------------------- send */

const read = (card, selector) => String(card.querySelector(selector)?.value || '').trim();

/** Read the user's edits back out of a preview card. */
function suggestionFrom(card) {
    const kind = card.dataset.kind;
    const base = {
        kind,
        provenance: card.dataset.provenance || 'headcanon',
        rationale: card.querySelector('.off-result-why')?.textContent?.trim() || '',
    };

    switch (kind) {
        case 'trait':
            return {
                ...base,
                name: read(card, '.off-field-name'),
                section: card.querySelector('.off-field-section')?.value || 'private',
                value: clamp(card.querySelector('.off-field-value')?.value, 0, 100, 65),
            };
        case 'favorite':
            return {
                ...base,
                category: read(card, '.off-field-category'),
                value: read(card, '.off-field-favorite'),
            };
        case 'journal':
            return {
                ...base,
                body: read(card, '.off-field-body'),
                entryKind: card.querySelector('.off-field-entrykind')?.value || 'entry',
                date: read(card, '.off-field-date'),
                mood: read(card, '.off-field-mood'),
            };
        case 'social':
            return {
                ...base,
                body: read(card, '.off-field-body'),
                account: card.querySelector('.off-field-account')?.value || 'main',
                date: read(card, '.off-field-date'),
                likes: clamp(card.querySelector('.off-field-likes')?.value, 0, 9999999, 0),
            };
        default:
            return {
                ...base,
                title: read(card, '.off-field-title'),
                artist: read(card, '.off-field-artist'),
                playlist: read(card, '.off-field-playlist'),
                note: read(card, '.off-field-note'),
            };
    }
}

function send() {
    const sheet = document.getElementById(SHEET_ID);
    if (!sheet) return;

    const proposals = [];
    for (const card of sheet.querySelectorAll('.off-result')) {
        if (!card.querySelector('.off-pick')?.checked) continue;
        const proposal = toProposal(suggestionFrom(card), { source: 'ai-fill' });
        if (proposal) proposals.push(proposal);
    }

    const { queued, skipped } = queueDiscoveries(proposals, { toFront: true });
    close();
    goToTab('discoveries');
    emit(CHANGED, { reason: 'ai-fill' });

    if (queued) {
        toast.success(`${queued} ${queued === 1 ? 'suggestion is' : 'suggestions are'} waiting for approval. Nothing added yet.`);
    } else if (skipped) {
        toast.info('Those are already in the dossier or already waiting for approval.');
    } else {
        toast.info('Nothing was selected.');
    }
}

export function initAiFill() {
    if (initialized) return;
    initialized = true;
    on(ACTION, event => {
        if (event.detail?.type === 'ai-fill') open(event.detail.target);
    });
    // The panel's Escape handler stands down while the sheet is open, so close it here.
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && document.getElementById(SHEET_ID)) close();
    });
}

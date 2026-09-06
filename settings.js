/**
 * Offstage — the card in SillyTavern's Extensions settings.
 */

import {
    VERSION, clamp, ctx, escapeHtml, getCurrentCharacter, getSettings, isGroupChat, on, save,
} from './core.js';
import { connectionLabel, presetNames } from './llm.js';
import { STATUS, analyze, isAnalyzing } from './analyzer.js';
import { openPanel } from './ui.js';

const PANEL_ID = 'offstage-settings-panel';
const LAUNCHER_ID = 'offstage-launcher';

let mounted = false;

function characterLabel() {
    if (isGroupChat()) return 'Group chat — not supported yet';
    return getCurrentCharacter()?.name || 'No character open';
}

export function applyLauncherPreference() {
    const launcher = document.getElementById(LAUNCHER_ID);
    const settings = getSettings();
    if (launcher && settings) {
        launcher.hidden = settings.ui.showLauncher === false;
    }
}

function markup() {
    const analysis = getSettings()?.analysis ?? {};
    return `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b><i class="fa-solid fa-masks-theater"></i>&nbsp;Offstage</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content offstage-settings">
                <p class="offstage-settings-lede">A private dossier for the character you are talking to: personality, tastes, and what they would never admit.</p>

                <div class="offstage-settings-readout">
                    <div><span>Character</span><strong id="offstage-settings-character">${escapeHtml(characterLabel())}</strong></div>
                    <div><span>Connection</span><strong id="offstage-settings-connection">${escapeHtml(connectionLabel())}</strong></div>
                    <div><span>Analyzer</span><strong id="offstage-settings-status">${escapeHtml(analysis.lastStatus || 'Ready')}</strong></div>
                </div>

                <button id="offstage-settings-open" type="button" class="menu_button">Open Offstage</button>

                <label class="checkbox_label" for="offstage-settings-launcher">
                    <input id="offstage-settings-launcher" type="checkbox">
                    <span>Show the floating Offstage button</span>
                </label>

                <hr class="offstage-settings-rule">

                <p class="offstage-settings-lede">Analysis runs on the Connection Manager profile you have selected for roleplay — its model, API, and instruct settings. It uses tokens.</p>

                <div class="offstage-settings-number">
                    <label for="offstage-analysis-preset">Preset for analysis</label>
                    <select id="offstage-analysis-preset" class="text_pole"></select>
                </div>
                <p class="offstage-settings-hint">A lean preset with reasoning off keeps analysis cheap and stops long reasoning from truncating the reply. Only the sampler settings are taken; the model and endpoint stay with the connection profile.</p>

                <label class="checkbox_label" for="offstage-analyzer-enabled">
                    <input id="offstage-analyzer-enabled" type="checkbox">
                    <span>Read the roleplay automatically</span>
                </label>
                <label class="checkbox_label" for="offstage-analyzer-transient">
                    <input id="offstage-analyzer-transient" type="checkbox">
                    <span>Let it update mood, status, and energy on its own</span>
                </label>

                <div class="offstage-settings-number">
                    <label for="offstage-analyzer-interval">Scan after this many replies</label>
                    <input id="offstage-analyzer-interval" class="text_pole" type="number" min="1" max="50" step="1">
                </div>
                <div class="offstage-settings-number">
                    <label for="offstage-analyzer-window">Replies sent to the analyzer</label>
                    <input id="offstage-analyzer-window" class="text_pole" type="number" min="6" max="80" step="1">
                </div>

                <button id="offstage-analyze-now" type="button" class="menu_button">Analyze the current chat</button>

                <hr class="offstage-settings-rule">

                <p class="offstage-settings-lede">Offstage can also write in the character's voice. Every piece waits in Discoveries, and stops being written once a couple are queued up unreviewed.</p>

                <label class="checkbox_label" for="offstage-auto-journal">
                    <input id="offstage-auto-journal" type="checkbox">
                    <span>Write a journal entry when something significant happens</span>
                </label>
                <div class="offstage-settings-number">
                    <label for="offstage-journal-threshold">How significant it has to be</label>
                    <input id="offstage-journal-threshold" class="text_pole" type="number" min="10" max="100" step="5">
                </div>

                <label class="checkbox_label" for="offstage-auto-social">
                    <input id="offstage-auto-social" type="checkbox">
                    <span>Draft a post on a regular cadence</span>
                </label>
                <div class="offstage-settings-number">
                    <label for="offstage-social-interval">Replies between posts</label>
                    <input id="offstage-social-interval" class="text_pole" type="number" min="1" max="50" step="1">
                </div>

                <p class="offstage-settings-foot">Traits and tastes always wait in Discoveries for your approval. Offstage v${VERSION}</p>
            </div>
        </div>`;
}

export function syncSettingsPanel() {
    const settings = getSettings();
    if (!settings) return;

    const set = (id, apply) => {
        const element = document.getElementById(id);
        if (element) apply(element);
    };

    set('offstage-settings-character', el => { el.textContent = characterLabel(); });
    set('offstage-settings-connection', el => { el.textContent = connectionLabel(); });
    set('offstage-settings-status', el => { el.textContent = settings.analysis.lastStatus || 'Ready'; });
    set('offstage-settings-launcher', el => { el.checked = settings.ui.showLauncher !== false; });
    set('offstage-analysis-preset', el => {
        // Rebuilt on every sync so presets saved since load appear without a reload.
        const chosen = settings.analysis.preset || '';
        const names = presetNames();
        const options = ['', ...names];
        // Keep a chosen preset selectable even if it has since been renamed or deleted.
        if (chosen && !names.includes(chosen)) options.push(chosen);

        el.replaceChildren(...options.map(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name
                ? (names.includes(name) ? name : `${name} (missing)`)
                : '— The connection profile\u2019s own preset —';
            return option;
        }));
        el.value = chosen;
    });
    set('offstage-analyzer-enabled', el => { el.checked = settings.analysis.enabled !== false; });
    set('offstage-analyzer-transient', el => { el.checked = settings.analysis.updateTransient !== false; });
    set('offstage-analyzer-interval', el => { el.value = clamp(settings.analysis.interval, 1, 50, 5); });
    set('offstage-analyzer-window', el => { el.value = clamp(settings.analysis.contextMessages, 6, 80, 24); });
    set('offstage-auto-journal', el => { el.checked = settings.analysis.journal.enabled !== false; });
    set('offstage-journal-threshold', el => { el.value = Math.round(clamp(settings.analysis.journal.threshold, 0.1, 1, 0.7) * 100); });
    set('offstage-auto-social', el => { el.checked = settings.analysis.social.enabled !== false; });
    set('offstage-social-interval', el => { el.value = clamp(settings.analysis.social.interval, 1, 50, 5); });
    set('offstage-analyze-now', el => {
        el.disabled = isAnalyzing();
        el.textContent = isAnalyzing() ? 'Reading the chat…' : 'Analyze the current chat';
    });
}

function bind(panel) {
    panel.querySelector('#offstage-settings-open')?.addEventListener('click', event => {
        event.preventDefault();
        openPanel();
    });

    panel.querySelector('#offstage-settings-launcher')?.addEventListener('change', event => {
        const settings = getSettings();
        if (!settings) return;
        settings.ui.showLauncher = Boolean(event.target.checked);
        save();
        applyLauncherPreference();
    });

    panel.querySelector('#offstage-analysis-preset')?.addEventListener('change', event => {
        const settings = getSettings();
        if (!settings) return;
        settings.analysis.preset = String(event.target.value || '');
        save();
    });

    panel.querySelector('#offstage-analyzer-enabled')?.addEventListener('change', event => {
        const settings = getSettings();
        if (!settings) return;
        settings.analysis.enabled = Boolean(event.target.checked);
        settings.analysis.lastStatus = settings.analysis.enabled ? 'Automatic reading on.' : 'Automatic reading paused.';
        save();
        syncSettingsPanel();
    });

    panel.querySelector('#offstage-analyzer-transient')?.addEventListener('change', event => {
        const settings = getSettings();
        if (!settings) return;
        settings.analysis.updateTransient = Boolean(event.target.checked);
        save();
    });

    panel.querySelector('#offstage-analyzer-interval')?.addEventListener('change', event => {
        const settings = getSettings();
        if (!settings) return;
        settings.analysis.interval = clamp(event.target.value, 1, 50, 5);
        event.target.value = settings.analysis.interval;
        save();
    });

    panel.querySelector('#offstage-analyzer-window')?.addEventListener('change', event => {
        const settings = getSettings();
        if (!settings) return;
        settings.analysis.contextMessages = clamp(event.target.value, 6, 80, 24);
        event.target.value = settings.analysis.contextMessages;
        save();
    });

    panel.querySelector('#offstage-auto-journal')?.addEventListener('change', event => {
        const settings = getSettings();
        if (!settings) return;
        settings.analysis.journal.enabled = Boolean(event.target.checked);
        save();
    });

    panel.querySelector('#offstage-journal-threshold')?.addEventListener('change', event => {
        const settings = getSettings();
        if (!settings) return;
        const percent = clamp(event.target.value, 10, 100, 70);
        settings.analysis.journal.threshold = percent / 100;
        event.target.value = percent;
        save();
    });

    panel.querySelector('#offstage-auto-social')?.addEventListener('change', event => {
        const settings = getSettings();
        if (!settings) return;
        settings.analysis.social.enabled = Boolean(event.target.checked);
        save();
    });

    panel.querySelector('#offstage-social-interval')?.addEventListener('change', event => {
        const settings = getSettings();
        if (!settings) return;
        settings.analysis.social.interval = clamp(event.target.value, 1, 50, 5);
        event.target.value = settings.analysis.social.interval;
        save();
    });

    panel.querySelector('#offstage-analyze-now')?.addEventListener('click', () => void analyze({ manual: true }));
}

export function mountSettingsPanel(attempt = 0) {
    if (mounted || document.getElementById(PANEL_ID)) {
        syncSettingsPanel();
        return;
    }

    const container = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!(container instanceof HTMLElement)) {
        if (attempt < 80) setTimeout(() => mountSettingsPanel(attempt + 1), 250);
        return;
    }

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'extension_container';
    panel.innerHTML = markup();
    container.appendChild(panel);
    bind(panel);
    mounted = true;
    syncSettingsPanel();

    on(STATUS, syncSettingsPanel);

    const context = ctx();
    const events = context?.eventTypes ?? context?.event_types;
    if (context?.eventSource && events) {
        for (const name of [
            events.CHAT_CHANGED, events.CHARACTER_EDITED, events.CHARACTER_PAGE_LOADED,
            events.CONNECTION_PROFILE_LOADED, events.CONNECTION_PROFILE_UPDATED,
        ]) {
            if (name) context.eventSource.on(name, syncSettingsPanel);
        }
    }
}

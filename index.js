/**
 * Offstage for SillyTavern — entry point.
 *
 * Load order: core state, then UI, then the feature modules that talk to it.
 * Every module is idempotent, so a double activation is harmless.
 */

import { VERSION, ctx, getSettings } from './core.js';
import { applyTheme, initUi, togglePanel } from './ui.js';
import { initApprovals } from './approvals.js';
import { initLife } from './life.js';
import { initAnalyzer } from './analyzer.js';
import { initAiFill } from './aifill.js';
import { applyLauncherPreference, mountSettingsPanel, syncSettingsPanel } from './settings.js';

const LAUNCHER_ID = 'offstage-launcher';
const MENU_ITEM_ID = 'offstage-menu-item';

let started = false;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function createLauncher() {
    if (document.getElementById(LAUNCHER_ID)) return;
    const button = document.createElement('button');
    button.id = LAUNCHER_ID;
    button.type = 'button';
    button.title = 'Open Offstage';
    button.innerHTML = '<span class="off-launcher-mark" aria-hidden="true">✦</span><span class="off-launcher-word">Offstage</span>';
    button.addEventListener('click', togglePanel);
    applyTheme(button);
    document.body.appendChild(button);
    applyLauncherPreference();
}

function createMenuItem(attempt = 0) {
    if (document.getElementById(MENU_ITEM_ID)) return;
    const menu = document.getElementById('extensionsMenu');
    if (!(menu instanceof HTMLElement)) {
        if (attempt < 40) setTimeout(() => createMenuItem(attempt + 1), 250);
        return;
    }
    const item = document.createElement('div');
    item.id = MENU_ITEM_ID;
    item.className = 'list-group-item flex-container flexGap5';
    item.tabIndex = 0;
    item.innerHTML = '<div class="extensionsMenuExtensionButton fa-solid fa-masks-theater"></div><span>Offstage</span>';
    item.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        togglePanel();
    });
    menu.appendChild(item);
}

async function waitForContext(attempts = 40) {
    for (let index = 0; index < attempts; index++) {
        if (ctx()?.extensionSettings) return true;
        await sleep(250);
    }
    return false;
}

export async function init() {
    if (started) return;
    started = true;

    const ready = await waitForContext();
    if (!ready) {
        console.error('[Offstage] SillyTavern context never became available; extension not started.');
        started = false;
        return;
    }

    getSettings();
    initUi();
    initApprovals();
    initLife();
    initAnalyzer();
    initAiFill();

    createLauncher();
    createMenuItem();
    mountSettingsPanel();
    syncSettingsPanel();

    console.info(`[Offstage] v${VERSION} ready`);
}

// SillyTavern calls init() via the manifest activate hook. Some builds and
// manual installs do not, so start once on our own too; init() is idempotent.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void init(), { once: true });
} else {
    void init();
}

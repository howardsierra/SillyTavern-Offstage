import { init as initOffstage } from './index.js';

const MENU_ITEM_ID = 'offstage-extension-menu-item';
const SETTINGS_PANEL_ID = 'offstage-settings-panel';
const LAUNCHER_ID = 'offstage-launcher';
const DRAWER_STYLE_ID = 'offstage-drawer-overrides';
const VERSION = '0.3.0';
let coreInitialized = false;
let coreInitPromise = null;
let settingsEventsBound = false;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getContext() {
    return globalThis.SillyTavern?.getContext?.();
}

function getOffstageSettings() {
    const context = getContext();
    if (!context?.extensionSettings) return null;

    context.extensionSettings.offstage ??= {
        schemaVersion: 1,
        profiles: {},
        ui: { lastTab: 'profile' },
    };
    context.extensionSettings.offstage.profiles ??= {};
    context.extensionSettings.offstage.ui ??= { lastTab: 'profile' };

    if (typeof context.extensionSettings.offstage.ui.showLauncher !== 'boolean') {
        context.extensionSettings.offstage.ui.showLauncher = true;
    }

    return context.extensionSettings.offstage;
}

function saveSettings() {
    getContext()?.saveSettingsDebounced?.();
}

function getCurrentCharacter() {
    const context = getContext();
    if (!context || context.characterId === undefined || context.characterId === null) return null;
    return context.characters?.[context.characterId] ?? null;
}

function getCurrentCharacterLabel() {
    const character = getCurrentCharacter();
    return character?.name || 'No character selected';
}

function ensureDrawerStyles() {
    if (document.getElementById(DRAWER_STYLE_ID)) return;

    const link = document.createElement('link');
    link.id = DRAWER_STYLE_ID;
    link.rel = 'stylesheet';
    link.href = `${new URL('./drawer.css', import.meta.url).href}?v=${VERSION}`;
    link.addEventListener('error', () => {
        console.error('[Offstage] Drawer override stylesheet failed to load:', link.href);
        globalThis.toastr?.error?.('Offstage drawer styling failed to load.', 'Offstage');
    });
    document.head.appendChild(link);
}

function applyFallbackTheme() {
    const root = document.getElementById('offstage-root');
    if (root && !root.dataset.theme) {
        root.dataset.theme = 'rosewater';
    }
}

function applyLauncherPreference() {
    const settings = getOffstageSettings();
    const launcher = document.getElementById(LAUNCHER_ID);
    if (!launcher || !settings) return;
    launcher.style.display = settings.ui.showLauncher === false ? 'none' : '';
}

async function ensureCoreInitialized() {
    ensureDrawerStyles();

    if (document.getElementById(LAUNCHER_ID)) {
        coreInitialized = true;
        applyLauncherPreference();
        return true;
    }

    if (coreInitialized && document.getElementById(LAUNCHER_ID)) {
        applyLauncherPreference();
        return true;
    }

    if (coreInitPromise) {
        return coreInitPromise;
    }

    coreInitPromise = (async () => {
        let lastError = null;

        for (let attempt = 0; attempt < 24; attempt++) {
            try {
                const context = getContext();
                if (!context?.extensionSettings) {
                    await sleep(250);
                    continue;
                }

                getOffstageSettings();
                initOffstage();

                if (document.getElementById(LAUNCHER_ID)) {
                    coreInitialized = true;
                    applyLauncherPreference();
                    return true;
                }
            } catch (error) {
                lastError = error;
                console.warn(`[Offstage] Core initialization attempt ${attempt + 1} failed:`, error);
            }

            await sleep(250);
        }

        if (lastError) {
            console.error('[Offstage] Could not initialize core:', lastError);
        } else {
            console.error('[Offstage] Could not initialize core: launcher was not created.');
        }
        return false;
    })();

    const result = await coreInitPromise;
    if (!result) coreInitPromise = null;
    return result;
}

async function openOffstage() {
    const ready = await ensureCoreInitialized();
    const launcher = document.getElementById(LAUNCHER_ID);

    if (ready && launcher) {
        launcher.click();
        applyFallbackTheme();
        updateSettingsPanelState();
        return;
    }

    console.error('[Offstage] Open requested, but the Offstage launcher is unavailable.');
    globalThis.toastr?.error?.('Offstage could not open. Please refresh SillyTavern and try again.', 'Offstage');
}

function updateSettingsPanelState() {
    const settings = getOffstageSettings();
    const characterLabel = document.getElementById('offstage-settings-character');
    const launcherToggle = document.getElementById('offstage-settings-show-launcher');
    const openButton = document.getElementById('offstage-settings-open');

    if (characterLabel) {
        characterLabel.textContent = getCurrentCharacterLabel();
    }

    if (launcherToggle && settings) {
        launcherToggle.checked = settings.ui.showLauncher !== false;
    }

    if (openButton) {
        openButton.textContent = getCurrentCharacter() ? '✦ Open Offstage' : '✦ Open Offstage';
    }
}

function bindSettingsEvents() {
    if (settingsEventsBound) return;
    settingsEventsBound = true;

    const context = getContext();
    const events = context?.eventTypes ?? context?.event_types;
    if (!context?.eventSource || !events) return;

    for (const eventName of [events.CHAT_CHANGED, events.CHARACTER_EDITED, events.CHARACTER_PAGE_LOADED]) {
        if (eventName) context.eventSource.on(eventName, updateSettingsPanelState);
    }
}

function createSettingsPanel(attempt = 0) {
    const existing = document.getElementById(SETTINGS_PANEL_ID);
    if (existing) {
        updateSettingsPanelState();
        return;
    }

    const container = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!(container instanceof HTMLElement)) {
        if (attempt < 80) setTimeout(() => createSettingsPanel(attempt + 1), 250);
        return;
    }

    getOffstageSettings();

    const panel = document.createElement('div');
    panel.id = SETTINGS_PANEL_ID;
    panel.className = 'offstage-settings extension_container';
    panel.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b><i class="fa-solid fa-masks-theater"></i>&nbsp; Offstage</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="flex-container flexFlowColumn flexGap10">
                    <div>
                        <div style="font-weight:700; margin-bottom:4px;">Living character workspace</div>
                        <small>Personality, favorites, discoveries, and the character's off-screen inner life.</small>
                    </div>

                    <div style="padding:10px 12px; border:1px solid var(--SmartThemeBorderColor); border-radius:10px;">
                        <small style="display:block; opacity:.7; margin-bottom:3px;">CURRENT CHARACTER</small>
                        <strong id="offstage-settings-character">${getCurrentCharacterLabel()}</strong>
                    </div>

                    <button id="offstage-settings-open" type="button" class="menu_button">
                        ✦ Open Offstage
                    </button>

                    <label class="checkbox_label" for="offstage-settings-show-launcher">
                        <input id="offstage-settings-show-launcher" type="checkbox">
                        <span>Show floating ✦ Offstage button</span>
                    </label>

                    <small>Desktop opens as an overlay drawer. Mobile opens full-screen and always starts closed, with a persistent Close control.</small>
                    <small style="opacity:.65;">Offstage v${VERSION}</small>
                </div>
            </div>
        </div>`;

    container.appendChild(panel);

    panel.querySelector('#offstage-settings-open')?.addEventListener('click', event => {
        event.preventDefault();
        void openOffstage();
    });

    panel.querySelector('#offstage-settings-show-launcher')?.addEventListener('change', event => {
        const settings = getOffstageSettings();
        if (!settings) return;
        settings.ui.showLauncher = Boolean(event.target.checked);
        saveSettings();
        applyLauncherPreference();
    });

    updateSettingsPanelState();
    bindSettingsEvents();
    console.info('[Offstage] Settings card added to SillyTavern Extensions panel');
}

function createExtensionMenuEntry(attempt = 0) {
    if (document.getElementById(MENU_ITEM_ID)) return;

    const menu = document.getElementById('extensionsMenu');
    if (!(menu instanceof HTMLElement)) {
        if (attempt < 40) setTimeout(() => createExtensionMenuEntry(attempt + 1), 250);
        return;
    }

    const item = document.createElement('div');
    item.id = MENU_ITEM_ID;
    item.className = 'list-group-item flex-container flexGap5';
    item.title = 'Open Offstage';
    item.innerHTML = `
        <div class="extensionsMenuExtensionButton fa-solid fa-masks-theater"></div>
        <span>Offstage</span>
    `;
    item.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        void openOffstage();
    });
    menu.appendChild(item);
}

export function init() {
    ensureDrawerStyles();
    createExtensionMenuEntry();
    createSettingsPanel();
    void ensureCoreInitialized().then(() => {
        applyLauncherPreference();
        updateSettingsPanelState();
    });
    console.info(`[Offstage] v${VERSION} bootstrap initialized`);
}

import { init as initOffstage } from './index.js';

const MENU_ITEM_ID = 'offstage-extension-menu-item';
const SETTINGS_PANEL_ID = 'offstage-settings-panel';
const LAUNCHER_ID = 'offstage-launcher';
const DRAWER_STYLE_ID = 'offstage-drawer-overrides';
const CRITICAL_STYLE_ID = 'offstage-critical-layout';
const VERSION = '0.3.1';
let coreInitPromise = null;
let settingsEventsBound = false;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const getContext = () => globalThis.SillyTavern?.getContext?.();

function getOffstageSettings() {
    const context = getContext();
    if (!context?.extensionSettings) return null;
    context.extensionSettings.offstage ??= { schemaVersion: 1, profiles: {}, ui: { lastTab: 'profile' } };
    context.extensionSettings.offstage.profiles ??= {};
    context.extensionSettings.offstage.ui ??= { lastTab: 'profile' };
    if (typeof context.extensionSettings.offstage.ui.showLauncher !== 'boolean') {
        context.extensionSettings.offstage.ui.showLauncher = true;
    }
    return context.extensionSettings.offstage;
}

function getCurrentCharacter() {
    const context = getContext();
    if (!context || context.characterId === undefined || context.characterId === null) return null;
    return context.characters?.[context.characterId] ?? null;
}

function getCurrentCharacterLabel() {
    return getCurrentCharacter()?.name || 'No character selected';
}

function ensureCriticalStyles() {
    if (document.getElementById(CRITICAL_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = CRITICAL_STYLE_ID;
    style.textContent = `
        #offstage-root {
            --off-bg:#f8eef0; --off-bg-2:#f2dfe4; --off-card:rgba(255,250,252,.82);
            --off-card-strong:rgba(255,255,255,.94); --off-ink:#2f2028; --off-muted:#806b75;
            --off-accent:#a8556d; --off-accent-2:#6e3247; --off-line:rgba(83,41,56,.15);
            --off-glow:rgba(190,102,130,.22); --offstage-serif:Georgia,'Times New Roman',serif;
            --offstage-sans:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
            display:none !important; position:fixed !important; inset:0 !important; z-index:99999 !important;
            font-family:var(--offstage-sans) !important; pointer-events:none !important;
        }
        #offstage-root.is-open { display:block !important; }
        #offstage-root .offstage-backdrop { display:none !important; }
        #offstage-root .offstage-shell {
            position:fixed !important; top:10px !important; right:10px !important; bottom:10px !important; left:auto !important;
            width:min(580px,calc(100vw - 20px)) !important; height:auto !important; margin:0 !important;
            display:grid !important; grid-template-rows:minmax(220px,31vh) auto minmax(0,1fr) !important;
            overflow:hidden !important; pointer-events:auto !important; color:var(--off-ink) !important;
            background:linear-gradient(145deg,rgba(250,240,244,.94),rgba(237,219,227,.92)) !important;
            border:1px solid rgba(255,255,255,.34) !important; border-radius:28px !important;
            box-shadow:-24px 20px 80px rgba(0,0,0,.38),inset 0 1px rgba(255,255,255,.32) !important;
            -webkit-backdrop-filter:blur(30px) saturate(1.18) !important; backdrop-filter:blur(30px) saturate(1.18) !important;
        }
        #offstage-root .offstage-hero { display:block !important; position:relative !important; min-height:220px !important; overflow:hidden !important; background:#2b1c24 !important; }
        #offstage-root .offstage-tabs { display:flex !important; position:relative !important; overflow-x:auto !important; min-height:54px !important; background:rgba(255,255,255,.82) !important; }
        #offstage-root .offstage-content { display:block !important; min-height:0 !important; overflow-y:auto !important; padding:22px 18px 30px !important; background:transparent !important; color:var(--off-ink) !important; }
        #offstage-root .offstage-page, #offstage-root .offstage-empty { display:block !important; color:var(--off-ink) !important; }
        #offstage-root .offstage-close { z-index:100003 !important; cursor:pointer !important; }
        #offstage-launcher { display:flex; z-index:99990 !important; }
        @media (max-width:820px) {
            #offstage-root .offstage-shell {
                inset:0 !important; width:100vw !important; height:100dvh !important; max-width:none !important;
                border:0 !important; border-radius:0 !important; box-shadow:none !important;
                grid-template-rows:minmax(210px,31vh) auto minmax(0,1fr) !important;
            }
            #offstage-root .offstage-close {
                position:fixed !important; top:max(12px,calc(env(safe-area-inset-top) + 8px)) !important; right:12px !important;
                width:auto !important; min-width:86px !important; height:44px !important; padding:0 14px !important;
                display:inline-flex !important; align-items:center !important; justify-content:center !important; gap:7px !important;
                color:#fff !important; background:rgba(31,20,26,.82) !important; border:1px solid rgba(255,255,255,.22) !important;
                border-radius:999px !important; font-size:23px !important;
            }
            #offstage-root .offstage-close::after { content:'Close'; font:750 12px/1 var(--offstage-sans); }
            #offstage-root .offstage-content { padding:20px 16px calc(34px + env(safe-area-inset-bottom)) !important; }
            #offstage-launcher { right:12px !important; bottom:max(74px,calc(env(safe-area-inset-bottom) + 62px)) !important; }
        }
    `;
    document.head.appendChild(style);
}

function ensureDrawerStyles() {
    ensureCriticalStyles();
    if (document.getElementById(DRAWER_STYLE_ID)) return;
    const link = document.createElement('link');
    link.id = DRAWER_STYLE_ID;
    link.rel = 'stylesheet';
    link.href = `${new URL('./drawer.css', import.meta.url).href}?v=${VERSION}`;
    link.addEventListener('error', () => console.warn('[Offstage] Optional drawer styling failed; critical layout remains active.'));
    document.head.appendChild(link);
}

function applyLauncherPreference() {
    const settings = getOffstageSettings();
    const launcher = document.getElementById(LAUNCHER_ID);
    if (launcher && settings) launcher.style.display = settings.ui.showLauncher === false ? 'none' : 'flex';
}

async function ensureCoreInitialized() {
    ensureDrawerStyles();
    if (document.getElementById(LAUNCHER_ID)) return true;
    if (coreInitPromise) return coreInitPromise;
    coreInitPromise = (async () => {
        let lastError = null;
        for (let attempt = 0; attempt < 24; attempt++) {
            try {
                if (!getContext()?.extensionSettings) { await sleep(250); continue; }
                getOffstageSettings();
                initOffstage();
                if (document.getElementById(LAUNCHER_ID)) { applyLauncherPreference(); return true; }
            } catch (error) {
                lastError = error;
                console.warn(`[Offstage] init attempt ${attempt + 1} failed`, error);
            }
            await sleep(250);
        }
        if (lastError) console.error('[Offstage] initialization failed', lastError);
        return false;
    })();
    const result = await coreInitPromise;
    if (!result) coreInitPromise = null;
    return result;
}

function forceVisibleShell() {
    ensureCriticalStyles();
    const root = document.getElementById('offstage-root');
    if (!root) return false;
    if (!root.dataset.theme) root.dataset.theme = 'rosewater';
    root.classList.add('is-open');

    const shell = root.querySelector('.offstage-shell');
    if (shell) return true;

    const character = getCurrentCharacterLabel();
    root.innerHTML = `
        <section class="offstage-shell" style="display:block!important;padding:24px!important;color:#2f2028!important;">
            <button class="offstage-close" type="button" aria-label="Close Offstage">×</button>
            <div style="padding:70px 20px 20px;max-width:520px;">
                <div style="font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#a8556d;font-weight:800;">OFFSTAGE</div>
                <h2 style="font:500 34px/1.05 Georgia,serif;margin:10px 0 14px;">The drawer opened, but the main view failed to render.</h2>
                <p style="line-height:1.5;">Detected character: <strong>${character}</strong></p>
                <p style="line-height:1.5;opacity:.75;">This diagnostic panel means the extension is loaded correctly and the remaining issue is inside Offstage's view renderer.</p>
            </div>
        </section>`;
    root.querySelector('.offstage-close')?.addEventListener('click', () => {
        root.classList.remove('is-open');
        document.documentElement.classList.remove('offstage-open');
    });
    return false;
}

async function openOffstage() {
    const ready = await ensureCoreInitialized();
    const launcher = document.getElementById(LAUNCHER_ID);
    if (!ready || !launcher) {
        globalThis.toastr?.error?.('Offstage could not initialize.', 'Offstage');
        return;
    }
    launcher.click();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    forceVisibleShell();
    updateSettingsPanelState();
}

function updateSettingsPanelState() {
    const settings = getOffstageSettings();
    const characterLabel = document.getElementById('offstage-settings-character');
    const launcherToggle = document.getElementById('offstage-settings-show-launcher');
    const status = document.getElementById('offstage-settings-status');
    if (characterLabel) characterLabel.textContent = getCurrentCharacterLabel();
    if (launcherToggle && settings) launcherToggle.checked = settings.ui.showLauncher !== false;
    if (status) status.textContent = document.getElementById(LAUNCHER_ID) ? 'Core loaded' : 'Waiting for core';
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
    if (document.getElementById(SETTINGS_PANEL_ID)) { updateSettingsPanelState(); return; }
    const container = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!(container instanceof HTMLElement)) {
        if (attempt < 80) setTimeout(() => createSettingsPanel(attempt + 1), 250);
        return;
    }

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
                    <div><strong>Living character workspace</strong><br><small>Personality, favorites, discoveries, and off-screen inner life.</small></div>
                    <div style="padding:10px 12px;border:1px solid var(--SmartThemeBorderColor);border-radius:10px;">
                        <small style="display:block;opacity:.7;">CURRENT CHARACTER</small>
                        <strong id="offstage-settings-character">${getCurrentCharacterLabel()}</strong>
                    </div>
                    <div style="padding:10px 12px;border:1px solid var(--SmartThemeBorderColor);border-radius:10px;">
                        <small style="display:block;opacity:.7;">STATUS</small>
                        <strong id="offstage-settings-status">Loading…</strong>
                    </div>
                    <button id="offstage-settings-open" type="button" class="menu_button">✦ Open Offstage</button>
                    <label class="checkbox_label" for="offstage-settings-show-launcher">
                        <input id="offstage-settings-show-launcher" type="checkbox"><span>Show floating ✦ Offstage button</span>
                    </label>
                    <small>Desktop: overlay drawer. Mobile: full-screen with a fixed Close control.</small>
                    <small style="opacity:.65;">Offstage v${VERSION}</small>
                </div>
            </div>
        </div>`;
    container.appendChild(panel);

    panel.querySelector('#offstage-settings-open')?.addEventListener('click', event => { event.preventDefault(); void openOffstage(); });
    panel.querySelector('#offstage-settings-show-launcher')?.addEventListener('change', event => {
        const settings = getOffstageSettings();
        if (!settings) return;
        settings.ui.showLauncher = Boolean(event.target.checked);
        getContext()?.saveSettingsDebounced?.();
        applyLauncherPreference();
    });
    updateSettingsPanelState();
    bindSettingsEvents();
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
    item.innerHTML = '<div class="extensionsMenuExtensionButton fa-solid fa-masks-theater"></div><span>Offstage</span>';
    item.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); void openOffstage(); });
    menu.appendChild(item);
}

export function init() {
    ensureDrawerStyles();
    createExtensionMenuEntry();
    createSettingsPanel();
    void ensureCoreInitialized().then(() => { applyLauncherPreference(); updateSettingsPanelState(); });
    console.info(`[Offstage] v${VERSION} bootstrap initialized`);
}

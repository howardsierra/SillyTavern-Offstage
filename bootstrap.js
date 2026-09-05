import { init as initOffstage } from './index.js';

const MENU_ITEM_ID = 'offstage-extension-menu-item';
const LAUNCHER_ID = 'offstage-launcher';
const DRAWER_STYLE_ID = 'offstage-drawer-overrides';
const VERSION = '0.2.1';
let coreInitialized = false;
let coreInitPromise = null;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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

async function ensureCoreInitialized() {
    ensureDrawerStyles();

    if (document.getElementById(LAUNCHER_ID)) {
        coreInitialized = true;
        return true;
    }

    if (coreInitialized && document.getElementById(LAUNCHER_ID)) {
        return true;
    }

    if (coreInitPromise) {
        return coreInitPromise;
    }

    coreInitPromise = (async () => {
        let lastError = null;

        // SillyTavern can load third-party modules a little before every bit of
        // extension state is ready. Retry briefly instead of leaving a dead menu item.
        for (let attempt = 0; attempt < 24; attempt++) {
            try {
                const context = globalThis.SillyTavern?.getContext?.();
                if (!context?.extensionSettings) {
                    await sleep(250);
                    continue;
                }

                initOffstage();

                if (document.getElementById(LAUNCHER_ID)) {
                    coreInitialized = true;
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
        return;
    }

    console.error('[Offstage] Open requested, but the Offstage launcher is unavailable.');
    if (globalThis.toastr?.error) {
        globalThis.toastr.error('Offstage could not open. Please refresh SillyTavern and try again.', 'Offstage');
    }
}

function createExtensionMenuEntry(attempt = 0) {
    if (document.getElementById(MENU_ITEM_ID)) return;

    const menu = document.getElementById('extensionsMenu');
    if (!(menu instanceof HTMLElement)) {
        if (attempt < 40) {
            setTimeout(() => createExtensionMenuEntry(attempt + 1), 250);
        }
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
    void ensureCoreInitialized();
    console.info(`[Offstage] v${VERSION} bootstrap initialized`);
}

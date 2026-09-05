import './index.js';

const MENU_ITEM_ID = 'offstage-extension-menu-item';

function openOffstage() {
    const launcher = document.getElementById('offstage-launcher');
    if (launcher) {
        launcher.click();
        return;
    }

    // index.js initializes on the next task when loaded as a module.
    setTimeout(() => document.getElementById('offstage-launcher')?.click(), 50);
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
    item.addEventListener('click', openOffstage);
    menu.appendChild(item);
}

export function init() {
    createExtensionMenuEntry();
    console.info('[Offstage] Extensions menu entry initialized');
}

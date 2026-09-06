/**
 * Offstage — the shared editing modal.
 * Kept separate from ui.js so the panel, the approval inbox, and the journal /
 * social / music pages can all open one without importing each other.
 */

import { applyTheme, escapeHtml } from './core.js';

export const MODAL_ID = 'offstage-modal';

/**
 * @param {object} options
 * @param {string} options.title
 * @param {Array} options.fields  {name,label,type,value,options,min,max,placeholder,hint}
 * @param {(values: Record<string,string>) => void} options.onSubmit
 */
export function openModal({ title, subtitle = '', fields = [], submitLabel = 'Save', onSubmit }) {
    document.getElementById(MODAL_ID)?.remove();

    const wrap = document.createElement('div');
    wrap.id = MODAL_ID;
    wrap.className = 'offstage-modal-wrap';
    applyTheme(wrap);
    wrap.innerHTML = `
        <div class="off-modal-backdrop" data-modal-close></div>
        <form class="off-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
            <div class="off-modal-head">
                <h3>${escapeHtml(title)}</h3>
                ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
            </div>
            <div class="off-modal-fields">${fields.map(modalField).join('')}</div>
            <div class="off-modal-actions">
                <button class="off-btn" type="button" data-modal-close>Cancel</button>
                <button class="off-btn off-btn-primary" type="submit">${escapeHtml(submitLabel)}</button>
            </div>
        </form>`;
    document.body.appendChild(wrap);

    wrap.querySelectorAll('[data-modal-close]').forEach(element =>
        element.addEventListener('click', () => wrap.remove()));

    wrap.querySelectorAll('input[type="range"]').forEach(input => {
        input.addEventListener('input', () => {
            const output = input.closest('label')?.querySelector('[data-range-output]');
            if (output) output.textContent = input.value;
        });
    });

    wrap.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            event.stopPropagation();
            wrap.remove();
        }
    });

    wrap.querySelector('form').addEventListener('submit', event => {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(event.currentTarget).entries());
        wrap.remove();
        onSubmit?.(values);
    });

    requestAnimationFrame(() => wrap.querySelector('input, select, textarea')?.focus());
}

function modalField(field) {
    const name = escapeHtml(field.name);
    const label = escapeHtml(field.label);
    const hint = field.hint ? `<small>${escapeHtml(field.hint)}</small>` : '';

    if (field.type === 'select') {
        return `<label><span>${label}</span>${hint}<select name="${name}">${field.options
            .map(option => `<option value="${escapeHtml(option.value)}" ${String(field.value) === String(option.value) ? 'selected' : ''}>${escapeHtml(option.label)}</option>`)
            .join('')}</select></label>`;
    }
    if (field.type === 'range') {
        return `<label><span>${label} <b data-range-output>${escapeHtml(field.value ?? 50)}</b></span>${hint}
            <input name="${name}" type="range" min="${field.min ?? 0}" max="${field.max ?? 100}" value="${escapeHtml(field.value ?? 50)}"></label>`;
    }
    if (field.type === 'textarea') {
        return `<label><span>${label}</span>${hint}<textarea name="${name}" rows="4" placeholder="${escapeHtml(field.placeholder ?? '')}">${escapeHtml(field.value ?? '')}</textarea></label>`;
    }
    return `<label><span>${label}</span>${hint}
        <input name="${name}" type="${field.type || 'text'}" value="${escapeHtml(field.value ?? '')}" placeholder="${escapeHtml(field.placeholder ?? '')}"></label>`;
}

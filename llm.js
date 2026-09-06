/**
 * Offstage — model access.
 * Routes every request through the Connection Manager profile the user has
 * selected for roleplay, falling back to SillyTavern's active connection.
 */

import { ctx, getSettings } from './core.js';

export function getConnectionProfile() {
    const manager = ctx()?.extensionSettings?.connectionManager;
    const id = manager?.selectedProfile;
    if (!id) return null;
    const profile = Array.isArray(manager?.profiles)
        ? manager.profiles.find(item => item.id === id)
        : null;
    return { id, profile: profile ?? null };
}

export function connectionLabel() {
    const selected = getConnectionProfile();
    if (!selected) return 'Active SillyTavern connection';
    const { profile, id } = selected;
    if (!profile) return `Connection profile ${id}`;
    const model = profile.model || profile.api || 'model';
    return `${profile.name || 'Connection profile'} — ${model}`;
}

/* ----------------------------------------------------------------- presets */

/**
 * Generation settings we are willing to take from the analysis preset.
 * Deliberately narrow: copying a whole preset would clobber the connection
 * profile's model, endpoint, and credentials.
 */
const PRESET_KEYS = [
    'temperature', 'top_p', 'top_k',
    'frequency_penalty', 'presence_penalty', 'reasoning_effort',
];

/** Chat-completion preset names, for the settings dropdown. */
export function presetNames() {
    try {
        const names = ctx()?.getPresetManager?.('openai')?.getAllPresets?.();
        return Array.isArray(names) ? names : [];
    } catch (error) {
        console.warn('[Offstage] Could not read the preset list.', error);
        return [];
    }
}

/** The chosen preset's generation settings, or {} when none is chosen. */
function presetOverride() {
    const name = getSettings()?.analysis?.preset;
    if (!name) return {};

    let preset = null;
    try {
        preset = ctx()?.getPresetManager?.('openai')?.getCompletionPresetByName?.(name);
    } catch (error) {
        console.warn(`[Offstage] Could not load preset "${name}".`, error);
    }
    if (!preset) return {};

    const override = {};
    for (const key of PRESET_KEYS) {
        const value = preset[key];
        if (value !== undefined && value !== null && value !== '') override[key] = value;
    }
    return override;
}

/** Whether an analysis preset is set and actually resolved to something. */
export function presetLabel() {
    const name = getSettings()?.analysis?.preset;
    if (!name) return 'The connection profile\u2019s own preset';
    return presetNames().includes(name) ? name : `${name} (missing)`;
}

/**
 * @returns {Promise<{ content: string, connection: string, usedProfile: boolean }>}
 */
export async function generate({ system, prompt, maxTokens = 2000 }) {
    const context = ctx();
    if (!context) throw new Error('SillyTavern context is unavailable.');

    const selected = getConnectionProfile();

    if (selected) {
        const service = context.ConnectionManagerRequestService;
        if (!service?.sendRequest) {
            throw new Error('A Connection Manager profile is selected, but this SillyTavern build does not let extensions use it.');
        }
        const messages = [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
        ];
        // sendRequest hardcodes the profile's own preset, so when the user has
        // chosen one for Offstage we turn that off and pass its settings as the
        // override payload instead — which is spread last and therefore wins.
        const override = presetOverride();
        const result = await service.sendRequest(selected.id, messages, maxTokens, {
            stream: false,
            extractData: true,
            includePreset: Object.keys(override).length === 0,
            includeInstruct: true,
        }, override);
        const content = result?.content;
        if (typeof content !== 'string' || !content.trim()) {
            throw new Error('The selected connection profile returned an empty response.');
        }
        return { content, connection: connectionLabel(), usedProfile: true };
    }

    if (typeof context.generateRaw !== 'function') {
        throw new Error('No usable SillyTavern generation connection is available.');
    }
    const content = await context.generateRaw({ prompt, systemPrompt: system, responseLength: maxTokens });
    if (typeof content !== 'string' || !content.trim()) {
        throw new Error('The active SillyTavern connection returned an empty response.');
    }
    return { content, connection: connectionLabel(), usedProfile: false };
}

/** Pull a JSON object out of a model response that may be fenced or padded with prose. */
export function parseJson(raw) {
    let text = String(raw ?? '').trim();

    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) text = fenced[1].trim();

    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) text = text.slice(start, end + 1);

    try {
        return JSON.parse(text);
    } catch (error) {
        // Trailing commas are the most common malformed-JSON case from smaller models.
        try {
            return JSON.parse(text.replace(/,\s*([}\]])/g, '$1'));
        } catch {
            throw new Error(`The model did not return usable JSON. ${error.message}`);
        }
    }
}

export function describeError(error) {
    return error?.cause?.message || error?.message || String(error) || 'Unknown error';
}

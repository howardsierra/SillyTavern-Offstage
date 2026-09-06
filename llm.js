/**
 * Offstage — model access.
 * Routes every request through the Connection Manager profile the user has
 * selected for roleplay, falling back to SillyTavern's active connection.
 */

import { ctx } from './core.js';

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

/**
 * @returns {Promise<{ content: string, connection: string, usedProfile: boolean }>}
 */
export async function generate({ system, prompt, maxTokens = 900 }) {
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
        const result = await service.sendRequest(selected.id, messages, maxTokens, {
            stream: false,
            extractData: true,
            includePreset: true,
            includeInstruct: true,
        });
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

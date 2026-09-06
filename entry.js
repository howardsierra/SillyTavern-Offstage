import { init as initBootstrap } from './bootstrap.js';
import { initAnalyzer } from './analyzer-profile.js';
import { initAiFill } from './ai-fill.js';

export function init() {
    initBootstrap();
    initAnalyzer();
    initAiFill();
    console.info('[Offstage] v0.5.0 entry initialized');
}

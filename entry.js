import { init as initBootstrap } from './bootstrap.js';
import { initAnalyzer } from './analyzer.js';

export function init() {
    initBootstrap();
    initAnalyzer();
    console.info('[Offstage] v0.4.0 entry initialized');
}

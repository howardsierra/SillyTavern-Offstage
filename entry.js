import { init as initBootstrap } from './bootstrap.js';
import { initAnalyzer } from './analyzer-profile.js';
import { initAiFill } from './ai-fill.js';
import { initApprovalBridge } from './approval-bridge.js';

export function init() {
    initBootstrap();
    initAnalyzer();
    initAiFill();
    initApprovalBridge();
    console.info('[Offstage] v0.5.1 entry initialized');
}

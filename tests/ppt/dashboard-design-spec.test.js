// TODO: Manual fix needed for dynamic require() calls
import { describe, it, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { parseHTML } from 'linkedom';

function setupDom(html = '<!doctype html><html><head></head><body></body></html>') {
  const { window, document } = parseHTML(html);
  globalThis.window = window;
  globalThis.document = document;
  return { window, document };
}

function teardownDom() {
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.SlideParser;
}

// Ensure a window exists before loading dashboard modules (they register on `window.PPTDashboard`).
setupDom();

// Provide a global PPTGenerator binding before requiring mixins.
if (!globalThis.PPTGenerator) {
  globalThis.PPTGenerator = class PPTGenerator {
    constructor() {
      this.state = 'page_layout';
      this._prevState = null;
      this.workflowMode = 'auto';
      this.workflowData = {};
      this.processLogs = [];
      this.currentProject = { title: 'Demo', chatHistory: [] };
      this.elements = { overlay: null };
      this.agents = { reader: {}, analyst: {}, designer: {}, reviewer: {} };
      this._runtimeTodoTexts = [
        '深度阅读与信息提取',
        '研究分析与报告生成',
        '脚本审阅与编辑',
        '页面规划与内容映射',
        '视觉设计与排版优化',
        '最终渲染与质量检查'
      ];
    }
  };
}

require('../../js/ppt/dashboard/ppt_dashboard_utils.js');
require('../../js/ppt/dashboard/ppt_dashboard_upload.js');
require('../../js/ppt/dashboard/ppt_dashboard_history.js');
require('../../js/ppt/dashboard/ppt_dashboard_url_input.js');
require('../../js/ppt/dashboard/ppt_dashboard_paste.js');
require('../../js/ppt/dashboard/ppt_dashboard_modals.js');
require('../../js/ppt/dashboard/ppt_dashboard_deepsearch.js');
require('../../js/ppt/dashboard/ppt_dashboard_page_layout.js');
require('../../js/ppt/dashboard/ppt_dashboard_design_spec.js');
require('../../js/ppt/dashboard/ppt_dashboard_outline.js');
require('../../js/ppt/dashboard/ppt_dashboard_core.js');
require('../../js/ppt/generator/ppt_generator_workflow.js');

afterEach(() => {
  teardownDom();
});

test.skip('design spec: renders with defaults and current values', () => {
  setupDom('<!doctype html><html><head></head><body><div id="pptPreviewArea"></div></body></html>');

  const gen = new globalThis.PPTGenerator();
  gen.renderPreviewArea();

  const spec = document.querySelector('.ppt-design-spec');
  expect(spec).toBeTruthy();

  // Defaults are initialized on render
  expect(gen.workflowData.batchSize).toBe(4);
  expect(gen.workflowData.designSystem.designSystemOverrides.colors.primary).toBe('#0ea5e9');
  expect(gen.workflowData.designSystem.designSystemOverrides.visualPreference.mode).toBe('balanced');

  const primaryInput = document.getElementById('pptDesignColor-primary');
  expect(primaryInput).toBeTruthy();
  expect(primaryInput.value.toLowerCase()).toBe('#0ea5e9');

  const modeBalanced = document.querySelector("button[onclick*=\"updateVisualPreferenceMode('balanced')\"]");
  expect(modeBalanced).toBeTruthy();
  expect(modeBalanced.classList.contains('active').toBeTruthy());

  const modelButton = document.querySelector('[data-action="openModelConfig"]');
  expect(modelButton).toBeTruthy();
  expect(modelButton.textContent || '').toMatch(/模型配置/);
});

test('color edit updates workflowData.designSystem.colors.primary', () => {
  setupDom('<!doctype html><html><head></head><body><div id="pptPreviewArea"></div></body></html>');

  const gen = new globalThis.PPTGenerator();
  gen.renderPreviewArea();

  gen.updateDesignSystemColor('primary', '#ff0000');
  expect(gen.workflowData.designSystem.designSystemOverrides.colors.primary).toBe('#ff0000');

  const primaryRow = document.querySelector('[data-design-color="primary"] .ppt-design-spec-swatch');
  expect(primaryRow).toBeTruthy();
  expect(primaryRow.getAttribute('style')).toMatch(/#ff0000/i);

  const primaryInput = document.getElementById('pptDesignColor-primary');
  expect(primaryInput).toBeTruthy();
  expect(primaryInput.value.toLowerCase()).toBe('#ff0000');
});

test('font change refreshes preview', () => {
  setupDom('<!doctype html><html><head></head><body><div id="pptPreviewArea"></div></body></html>');

  const gen = new globalThis.PPTGenerator();
  gen.renderPreviewArea();

  gen.updateDesignSystemFont('titleFont', 'Georgia');
  expect(gen.workflowData.designSystem.designSystemOverrides.typography.titleFont).toBe('Georgia');

  const title = document.querySelector('.ppt-design-spec-preview-title');
  expect(title).toBeTruthy();
  expect(title.getAttribute('style') || '').toMatch(/font-family:Georgia/i);
});

test.skip('batch size change updates workflowData.batchSize', () => {
  setupDom('<!doctype html><html><head></head><body><div id="pptPreviewArea"></div></body></html>');

  const gen = new globalThis.PPTGenerator();
  gen.renderPreviewArea();

  gen.updateBatchSize(2);
  expect(gen.workflowData.batchSize).toBe(2);

  const btn = document.querySelector("button[onclick*='updateBatchSize(2)']");
  expect(btn).toBeTruthy();
  expect(btn.classList.contains('active').toBeTruthy());
});

test.skip('visualPreference.mode change updates UI + userConfig', () => {
  setupDom('<!doctype html><html><head></head><body><div id="pptPreviewArea"></div></body></html>');

  const gen = new globalThis.PPTGenerator();
  gen.renderPreviewArea();

  gen.updateVisualPreferenceMode('svg-first');
  expect(gen.workflowData.designSystem.designSystemOverrides.visualPreference.mode).toBe('svg-first');

  const btn = document.querySelector("button[onclick*=\"updateVisualPreferenceMode('svg-first')\"]");
  expect(btn).toBeTruthy();
  expect(btn.classList.contains('active').toBeTruthy());
});

test.skip('visualPreference is passed into DesignAgentLoop via runContext.userConfig', async () => {
  setupDom('<!doctype html><html><head></head><body></body></html>');

  globalThis.SlideParser = { parse: () => [{ id: 's1' }] };

  const gen = new globalThis.PPTGenerator();
  gen.updateTodos = () => {};
  gen.renderPreviewArea = () => {};
  gen.logTerminal = () => {};
  gen.addChatMessage = () => {};
  gen._setAgentStatus = () => {};

  gen.workflowData.contentPackage = {
    schemaVersion: '0.1',
    title: 'Demo',
    summary: 'Demo summary',
    constraints: {},
    slideIntents: [{ slideIntentId: 'si_1', pageType: 'cover', title: 'Cover', objective: '', keyPoints: [], claimIds: [], dataTableIds: [] }]
  };

  gen.updateVisualPreferenceMode('ai-first');

  await gen._ensureRuntime({ mode: 'textprep' });

  const design = await import('../../js/agents/stages/design/index.js');
  const originalExecute = design.DesignAgentLoop.prototype.execute;
  let seenUserConfig = null;
  design.DesignAgentLoop.prototype.execute = async function (runContext) {
    seenUserConfig = runContext?.userConfig || null;
    return {
      schemaVersion: '0.1',
      runId: runContext?.runId || 'run_test',
      deckHtmlDsl: '<section data-type="freeform" id="s1"></section>',
      slidesMeta: [],
    };
  };

  try {
    await gen._orchestrator.runStage('design.batch');
    expect(seenUserConfig && typeof seenUserConfig === 'object').toBeTruthy();
    expect(seenUserConfig.designSystemOverrides.visualPreference.mode).toBe('ai-first');
  } finally {
    design.DesignAgentLoop.prototype.execute = originalExecute;
  }
});

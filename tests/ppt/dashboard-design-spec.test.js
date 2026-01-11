const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHTML } = require('linkedom');

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

test.afterEach(() => {
  teardownDom();
});

test('design spec: renders with defaults and current values', () => {
  setupDom('<!doctype html><html><head></head><body><div id="pptPreviewArea"></div></body></html>');

  const gen = new globalThis.PPTGenerator();
  gen.renderPreviewArea();

  const spec = document.querySelector('.ppt-design-spec');
  assert.ok(spec);

  // Defaults are initialized on render
  assert.equal(gen.workflowData.batchSize, 4);
  assert.equal(gen.workflowData.designSystem.designSystemOverrides.colors.primary, '#0ea5e9');
  assert.equal(gen.workflowData.designSystem.designSystemOverrides.visualPreference.mode, 'balanced');

  const primaryInput = document.getElementById('pptDesignColor-primary');
  assert.ok(primaryInput);
  assert.equal(primaryInput.value.toLowerCase(), '#0ea5e9');

  const modeBalanced = document.querySelector("button[onclick*=\"updateVisualPreferenceMode('balanced')\"]");
  assert.ok(modeBalanced);
  assert.ok(modeBalanced.classList.contains('active'));

  const modelButton = document.querySelector('[data-action="openModelConfig"]');
  assert.ok(modelButton);
  assert.match(modelButton.textContent || '', /模型配置/);
});

test('color edit updates workflowData.designSystem.colors.primary', () => {
  setupDom('<!doctype html><html><head></head><body><div id="pptPreviewArea"></div></body></html>');

  const gen = new globalThis.PPTGenerator();
  gen.renderPreviewArea();

  gen.updateDesignSystemColor('primary', '#ff0000');
  assert.equal(gen.workflowData.designSystem.designSystemOverrides.colors.primary, '#ff0000');

  const primaryRow = document.querySelector('[data-design-color="primary"] .ppt-design-spec-swatch');
  assert.ok(primaryRow);
  assert.match(primaryRow.getAttribute('style'), /#ff0000/i);

  const primaryInput = document.getElementById('pptDesignColor-primary');
  assert.ok(primaryInput);
  assert.equal(primaryInput.value.toLowerCase(), '#ff0000');
});

test('font change refreshes preview', () => {
  setupDom('<!doctype html><html><head></head><body><div id="pptPreviewArea"></div></body></html>');

  const gen = new globalThis.PPTGenerator();
  gen.renderPreviewArea();

  gen.updateDesignSystemFont('titleFont', 'Georgia');
  assert.equal(gen.workflowData.designSystem.designSystemOverrides.typography.titleFont, 'Georgia');

  const title = document.querySelector('.ppt-design-spec-preview-title');
  assert.ok(title);
  assert.match(title.getAttribute('style') || '', /font-family:Georgia/i);
});

test('batch size change updates workflowData.batchSize', () => {
  setupDom('<!doctype html><html><head></head><body><div id="pptPreviewArea"></div></body></html>');

  const gen = new globalThis.PPTGenerator();
  gen.renderPreviewArea();

  gen.updateBatchSize(2);
  assert.equal(gen.workflowData.batchSize, 2);

  const btn = document.querySelector("button[onclick*='updateBatchSize(2)']");
  assert.ok(btn);
  assert.ok(btn.classList.contains('active'));
});

test('visualPreference.mode change updates UI + userConfig', () => {
  setupDom('<!doctype html><html><head></head><body><div id="pptPreviewArea"></div></body></html>');

  const gen = new globalThis.PPTGenerator();
  gen.renderPreviewArea();

  gen.updateVisualPreferenceMode('svg-first');
  assert.equal(gen.workflowData.designSystem.designSystemOverrides.visualPreference.mode, 'svg-first');

  const btn = document.querySelector("button[onclick*=\"updateVisualPreferenceMode('svg-first')\"]");
  assert.ok(btn);
  assert.ok(btn.classList.contains('active'));
});

test('visualPreference is passed into DesignAgentLoop via runContext.userConfig', async () => {
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
    assert.ok(seenUserConfig && typeof seenUserConfig === 'object');
    assert.equal(seenUserConfig.designSystemOverrides.visualPreference.mode, 'ai-first');
  } finally {
    design.DesignAgentLoop.prototype.execute = originalExecute;
  }
});

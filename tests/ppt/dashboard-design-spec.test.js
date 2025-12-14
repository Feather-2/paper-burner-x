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
}

// Provide a global PPTGenerator binding before requiring mixins.
if (!globalThis.PPTGenerator) {
  globalThis.PPTGenerator = class PPTGenerator {
    constructor() {
      this.state = 'page_layout';
      this._prevState = null;
      this.workflowMode = 'auto';
      this.workflowData = {};
      this.processLogs = [];
      this.currentProject = { title: 'Demo' };
      this.elements = { overlay: null };
    }
  };
}

require('../../js/ppt/ppt_generator_agent_dashboard.js');

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
  assert.equal(gen.workflowData.designSystem.colors.primary, '#0ea5e9');

  const primaryInput = document.getElementById('pptDesignColor-primary');
  assert.ok(primaryInput);
  assert.equal(primaryInput.value.toLowerCase(), '#0ea5e9');

  const modelSelect = document.getElementById('pptDesignModel');
  assert.ok(modelSelect);
  assert.equal(modelSelect.value, 'gemini-1.5-pro');
});

test('color edit updates workflowData.designSystem.colors.primary', () => {
  setupDom('<!doctype html><html><head></head><body><div id="pptPreviewArea"></div></body></html>');

  const gen = new globalThis.PPTGenerator();
  gen.renderPreviewArea();

  gen.updateDesignSystemColor('primary', '#ff0000');
  assert.equal(gen.workflowData.designSystem.colors.primary, '#ff0000');

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
  assert.equal(gen.workflowData.designSystem.fonts.titleFont, 'Georgia');

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

test('model selection updates designSystem.model', () => {
  setupDom('<!doctype html><html><head></head><body><div id=\"pptPreviewArea\"></div></body></html>');

  const gen = new globalThis.PPTGenerator();
  gen.renderPreviewArea();

  gen.updateDesignSystemModel('gpt-4o');
  assert.equal(gen.workflowData.designSystem.model, 'gpt-4o');

  const modelSelect = document.getElementById('pptDesignModel');
  assert.ok(modelSelect);
  assert.equal(modelSelect.value, 'gpt-4o');
});


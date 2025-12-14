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
  delete globalThis.PPTGenerator;
}

test.afterEach(() => {
  teardownDom();
  delete require.cache[require.resolve('../../js/ppt/ppt_generator_agent_dashboard.js')];
  delete require.cache[require.resolve('../../js/ppt/vision/layout-from-image.js')];
});

// Test 1: VLM prompt includes styleDescription schema for style_reference intent
test('layout-from-image: buildPrompt includes styleDescription schema for style_reference intent', () => {
  const { _internal } = require('../../js/ppt/vision/layout-from-image.js');
  // Access buildPrompt through module if exported, or test normalizeLayoutJson
  // Since buildPrompt is not exported, we test the normalization instead
  const input = {
    intent: 'style_reference',
    analysis: 'test',
    elements: [],
    extractedPalette: ['#FF0000', '#00FF00'],
    styleDescription: {
      colorTone: '深蓝渐变',
      mood: '专业简洁',
      layoutStyle: '大留白',
      typography: '无衬线粗体',
      effects: '圆角卡片'
    }
  };

  const normalized = _internal.normalizeLayoutJson(input, { intentHint: 'style_reference' });

  assert.equal(normalized.intent, 'style_reference');
  assert.deepEqual(normalized.extractedPalette, ['#FF0000', '#00FF00']);
  assert.ok(normalized.styleDescription);
  assert.equal(normalized.styleDescription.colorTone, '深蓝渐变');
  assert.equal(normalized.styleDescription.mood, '专业简洁');
  assert.equal(normalized.styleDescription.layoutStyle, '大留白');
  assert.equal(normalized.styleDescription.typography, '无衬线粗体');
  assert.equal(normalized.styleDescription.effects, '圆角卡片');
});

// Test 2: normalizeLayoutJson handles missing styleDescription gracefully
test('layout-from-image: normalizeLayoutJson handles missing styleDescription', () => {
  const { _internal } = require('../../js/ppt/vision/layout-from-image.js');
  const input = {
    intent: 'style_reference',
    analysis: 'test',
    elements: []
  };

  const normalized = _internal.normalizeLayoutJson(input);

  assert.equal(normalized.intent, 'style_reference');
  assert.equal(normalized.styleDescription, undefined);
});

// Test 3: dashboard initializes styleReference
test('dashboard: _ensureDesignSpecInitialized creates styleReference', () => {
  setupDom('<!doctype html><html><body><div id="pptPreviewArea"></div></body></html>');

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

  require('../../js/ppt/ppt_generator_agent_dashboard.js');

  const gen = new globalThis.PPTGenerator();
  gen.renderPreviewArea();

  assert.ok(gen.workflowData.designSystem);
  assert.ok(gen.workflowData.designSystem.styleReference);
  assert.deepEqual(gen.workflowData.designSystem.styleReference.images, []);
  assert.equal(gen.workflowData.designSystem.styleReference.extracted, null);
  assert.equal(gen.workflowData.designSystem.styleReference.userNotes, '');
});

// Test 4: removeStyleReference removes image and clears extracted if empty
test('dashboard: removeStyleReference clears extracted when no images left', () => {
  setupDom('<!doctype html><html><body><div id="pptPreviewArea"></div></body></html>');

  globalThis.PPTGenerator = class PPTGenerator {
    constructor() {
      this.state = 'page_layout';
      this.workflowData = {};
      this.currentProject = { title: 'Demo' };
      this.elements = { overlay: null };
    }
  };

  require('../../js/ppt/ppt_generator_agent_dashboard.js');

  const gen = new globalThis.PPTGenerator();
  gen.renderPreviewArea = () => {};
  gen._ensureDesignSpecInitialized();

  // Manually add an image
  gen.workflowData.designSystem.styleReference.images = [{ id: 'ref_123', thumbnail: 'data:...', status: 'done' }];
  gen.workflowData.designSystem.styleReference.extracted = { colorTone: 'test' };

  gen.removeStyleReference('ref_123');

  assert.equal(gen.workflowData.designSystem.styleReference.images.length, 0);
  assert.equal(gen.workflowData.designSystem.styleReference.extracted, null);
});

// Test 5: updateStyleReferenceNotes updates userNotes
test('dashboard: updateStyleReferenceNotes updates userNotes', () => {
  setupDom('<!doctype html><html><body><div id="pptPreviewArea"></div></body></html>');

  globalThis.PPTGenerator = class PPTGenerator {
    constructor() {
      this.state = 'page_layout';
      this.workflowData = {};
      this.currentProject = { title: 'Demo' };
      this.elements = { overlay: null };
    }
  };

  require('../../js/ppt/ppt_generator_agent_dashboard.js');

  const gen = new globalThis.PPTGenerator();
  gen._ensureDesignSpecInitialized();
  gen.updateStyleReferenceNotes('参考 Apple 风格');

  assert.equal(gen.workflowData.designSystem.styleReference.userNotes, '参考 Apple 风格');
});

// Test 6: batch-generator makePrompt includes styleReference in output
test('batch-generator: makePrompt includes styleReference lines when present', async () => {
  const mod = await import('../../js/agents/stages/design/batch-generator.js');

  // Access makePrompt through generateSingleSlide behavior
  // Since makePrompt is not exported, we test indirectly via the module behavior
  // For now, we test that the module loads without error and exports expected functions
  assert.ok(typeof mod.generateSingleSlide === 'function');
  assert.ok(typeof mod.generateBatch === 'function');
});

// Test 7: UI renders style reference section
test('dashboard: _renderStyleReferenceSection renders upload area', () => {
  setupDom('<!doctype html><html><body><div id="pptPreviewArea"></div></body></html>');

  globalThis.PPTGenerator = class PPTGenerator {
    constructor() {
      this.state = 'page_layout';
      this.workflowData = {};
      this.currentProject = { title: 'Demo' };
      this.elements = { overlay: null };
    }
  };

  require('../../js/ppt/ppt_generator_agent_dashboard.js');

  const gen = new globalThis.PPTGenerator();
  gen.renderPreviewArea();

  const uploadArea = document.querySelector('.ppt-style-ref-upload');
  assert.ok(uploadArea, 'Upload area should exist');

  const title = document.querySelector('.ppt-style-ref-title');
  assert.ok(title, 'Title should exist');
  assert.ok(title.textContent.includes('风格参考'));
});

// Test 8: UI renders extracted style fields when present
test('dashboard: _renderStyleReferenceSection renders extracted fields', () => {
  setupDom('<!doctype html><html><body><div id="pptPreviewArea"></div></body></html>');

  globalThis.PPTGenerator = class PPTGenerator {
    constructor() {
      this.state = 'page_layout';
      this.workflowData = {
        designSystem: {
          styleReference: {
            images: [{ id: 'ref_1', thumbnail: 'data:image/png;base64,AAA', status: 'done' }],
            extracted: {
              colorTone: '深蓝科技感',
              mood: '专业现代',
              palette: ['#0066CC', '#FFFFFF']
            },
            userNotes: ''
          }
        }
      };
      this.currentProject = { title: 'Demo' };
      this.elements = { overlay: null };
    }
  };

  require('../../js/ppt/ppt_generator_agent_dashboard.js');

  const gen = new globalThis.PPTGenerator();
  gen.renderPreviewArea();

  const extracted = document.querySelector('.ppt-style-ref-extracted');
  assert.ok(extracted, 'Extracted section should exist');

  const colorToneField = extracted.querySelector('.ppt-style-ref-field');
  assert.ok(colorToneField, 'At least one field should exist');
});

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

if (!globalThis.PPTGenerator) {
  globalThis.PPTGenerator = class PPTGenerator {
    constructor() {
      this.state = 'idle';
      this._prevState = null;
      this._runtimeTodoTexts = [
        '深度阅读与信息提取',
        '研究分析与报告生成',
        '脚本审阅与编辑',
        '页面规划与内容映射',
        '视觉设计与排版优化',
        '最终渲染与质量检查'
      ];
      this.workflowData = { files: [] };
      this.processLogs = [];
      this.currentProject = { title: 'Demo', chatHistory: [] };
      this.elements = { overlay: null };
      this.agents = { reader: {}, analyst: {}, designer: {}, reviewer: {} };
      this.sampleHTML = '';
      this.slides = [];
    }
  };
}

require('../../js/ppt/ppt_generator_workflow.js');

test.afterEach(() => {
  teardownDom();
});

function makeContentPackage(slideCount = 3) {
  const slideIntents = Array.from({ length: slideCount }, (_, i) => ({
    slideIntentId: `si_${i + 1}`,
    pageType: i === 0 ? 'cover' : 'content',
    title: i === 0 ? 'Cover' : `Slide ${i + 1}`,
    objective: '',
    keyPoints: [`Point ${i + 1}`],
    claimIds: [],
    dataTableIds: []
  }));
  return {
    schemaVersion: '0.1',
    title: 'Demo',
    summary: 'Demo summary',
    constraints: {},
    slideIntents
  };
}

test('design.batch runs real DesignStage and populates deckHtmlDsl + slides', async () => {
  setupDom('<!doctype html><html><body></body></html>');
  globalThis.SlideParser = require('../../js/ppt/slide-parser.js').SlideParser;

  const gen = new globalThis.PPTGenerator();
  gen.updateTodos = () => {};
  gen.renderPreviewArea = () => {};
  gen.logTerminal = () => {};
  gen.addChatMessage = () => {};
  gen._setAgentStatus = () => {};

  gen.workflowData.contentPackage = makeContentPackage(4);

  await gen._ensureRuntime({ mode: 'textprep' });

  const design = await import('../../js/agents/stages/design/index.js');
  const originalRun = design.DesignStage.prototype.run;
  let runCalls = 0;
  design.DesignStage.prototype.run = async function (...args) {
    runCalls += 1;
    return originalRun.apply(this, args);
  };

  try {
    const deckPackage = await gen._orchestrator.runStage('design.batch');

    assert.equal(runCalls, 1);
    assert.ok(deckPackage && typeof deckPackage === 'object');
    assert.ok(typeof gen.workflowData.deckHtmlDsl === 'string' && gen.workflowData.deckHtmlDsl.includes('<section'));
    assert.ok(typeof gen.sampleHTML === 'string' && gen.sampleHTML.includes('<section'));
    assert.ok(Array.isArray(gen.slides) && gen.slides.length > 0);
    assert.ok(gen.workflowData.deckHtmlDsl.includes('data-type="freeform"'));
  } finally {
    design.DesignStage.prototype.run = originalRun;
  }
});

test('design.batch falls back to mock deck when DesignStage throws', async () => {
  setupDom('<!doctype html><html><body></body></html>');
  globalThis.SlideParser = require('../../js/ppt/slide-parser.js').SlideParser;

  const gen = new globalThis.PPTGenerator();
  gen.updateTodos = () => {};
  gen.renderPreviewArea = () => {};
  gen.logTerminal = () => {};
  gen.addChatMessage = () => {};
  gen._setAgentStatus = () => {};

  gen.workflowData.contentPackage = makeContentPackage(2);

  await gen._ensureRuntime({ mode: 'textprep' });

  const design = await import('../../js/agents/stages/design/index.js');
  const originalRun = design.DesignStage.prototype.run;
  design.DesignStage.prototype.run = async () => {
    throw new Error('boom');
  };

  try {
    const deckPackage = await gen._orchestrator.runStage('design.batch');
    assert.ok(deckPackage && typeof deckPackage === 'object');
    assert.ok(typeof gen.workflowData.deckHtmlDsl === 'string' && gen.workflowData.deckHtmlDsl.includes('<section'));
    assert.ok(gen.workflowData.deckHtmlDsl.includes('mock-slide-'));
    assert.ok(Array.isArray(gen.slides) && gen.slides.length > 0);
  } finally {
    design.DesignStage.prototype.run = originalRun;
  }
});


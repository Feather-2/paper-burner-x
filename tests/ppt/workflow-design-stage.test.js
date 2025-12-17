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

test.before(async () => {
  // Ensure async mixins have been installed before calling non-stubbed methods.
  const ready = globalThis.PPTGenerator?.prototype?.__pptWorkflowMixinsReady;
  if (ready && typeof ready.then === 'function') await ready;
});

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

test('selectBrainstormCandidate updates workflowData.brainstormCandidates and marks source=user', async () => {
  const gen = new globalThis.PPTGenerator();
  gen.setAutoSaveNeeded = () => {};
  gen._scheduleVizRerender = () => {};

  gen.workflowData.brainstormCandidates = {
    schemaVersion: '0.1',
    source: 'auto',
    updatedAt: 0,
    candidatesBySlide: [
      {
        slideIntentId: 'si_1',
        slideIndex: 0,
        candidates: [{ candidateId: 'c1', selected: true }, { candidateId: 'c2', selected: false }],
        selectedCandidateId: 'c1',
        selectedCandidate: { candidateId: 'c1', selected: true, elementsMarkdown: '- A' },
      },
      {
        slideIntentId: 'si_2',
        slideIndex: 1,
        candidates: [{ candidateId: 'd1', selected: true }, { candidateId: 'd2', selected: false }],
        selectedCandidateId: 'd1',
        selectedCandidate: { candidateId: 'd1', selected: true, elementsMarkdown: '- X' },
      },
    ],
    selectedIdeas: [],
  };

  const before = Date.now();
  assert.equal(gen.selectBrainstormCandidate('si_2', 'd2'), true);

  const bc = gen.workflowData.brainstormCandidates;
  assert.equal(bc.source, 'user');
  assert.ok(typeof bc.updatedAt === 'number' && bc.updatedAt >= before);

  const row = bc.candidatesBySlide.find((r) => r.slideIntentId === 'si_2');
  assert.equal(row.selectedCandidateId, 'd2');
  assert.equal(row.selectedCandidate.candidateId, 'd2');
  assert.equal(row.selectedCandidate.selected, true);
  assert.equal(row.candidates.find((c) => c.candidateId === 'd1').selected, false);
  assert.equal(row.candidates.find((c) => c.candidateId === 'd2').selected, true);

  assert.ok(Array.isArray(bc.selectedIdeas) && bc.selectedIdeas.length >= 2);
  assert.equal(bc.selectedIdeas.find((x) => x.slideIntentId === 'si_2')?.candidateId, 'd2');
  assert.equal(gen.selectBrainstormCandidate('si_2', 'missing'), false);
});

test('design.batch injects workflowData.brainstormCandidates into contentPackage', async () => {
  setupDom('<!doctype html><html><body></body></html>');
  globalThis.SlideParser = require('../../js/ppt/slide-parser.js').SlideParser;

  const gen = new globalThis.PPTGenerator();
  gen.updateTodos = () => {};
  gen.renderPreviewArea = () => {};
  gen.logTerminal = () => {};
  gen.addChatMessage = () => {};
  gen._setAgentStatus = () => {};

  gen.workflowData.contentPackage = makeContentPackage(2);
  gen.workflowData.brainstormCandidates = {
    schemaVersion: '0.1',
    source: 'user',
    updatedAt: Date.now(),
    candidatesBySlide: [
      {
        slideIntentId: 'si_1',
        slideIndex: 0,
        candidates: [{ candidateId: 'si_1_a', selected: true }, { candidateId: 'si_1_b', selected: false }],
        selectedCandidateId: 'si_1_a',
        selectedCandidate: { candidateId: 'si_1_a', selected: true },
      },
      {
        slideIntentId: 'si_2',
        slideIndex: 1,
        candidates: [{ candidateId: 'si_2_a', selected: true }, { candidateId: 'si_2_b', selected: false }],
        selectedCandidateId: 'si_2_a',
        selectedCandidate: { candidateId: 'si_2_a', selected: true },
      },
    ],
    selectedIdeas: [],
  };

  await gen._ensureRuntime({ mode: 'textprep' });

  const design = await import('../../js/agents/stages/design/index.js');
  const originalRun = design.DesignStage.prototype.run;
  design.DesignStage.prototype.run = async function (contentPackage) {
    assert.ok(contentPackage && typeof contentPackage === 'object');
    assert.ok(contentPackage.brainstormCandidates && typeof contentPackage.brainstormCandidates === 'object');
    assert.equal(contentPackage.brainstormCandidates.source, 'user');
    assert.equal(contentPackage.brainstormCandidates, gen.workflowData.brainstormCandidates);
    return {
      schemaVersion: '0.1',
      runId: 'run_test',
      deckHtmlDsl: '<section data-type="freeform"><h1>Ok</h1></section>',
      slidesMeta: [{ slideNo: 1, degraded: false, qa: { pass: true, reasons: [] } }],
      editHints: { degradedCount: 0 },
    };
  };

  try {
    const deckPackage = await gen._orchestrator.runStage('design.batch');
    assert.ok(deckPackage && typeof deckPackage.deckHtmlDsl === 'string');
  } finally {
    design.DesignStage.prototype.run = originalRun;
  }
});

test('_pushToProcessPanel derives slideRange from slideIndexes', () => {
  const gen = new globalThis.PPTGenerator();
  const steps = [];
  gen.addProcessPanelStep = (evt) => steps.push(evt);

  gen._pushToProcessPanel('design.batch.started', { slideIndexes: [0, 3] });

  assert.equal(steps.length, 1);
  assert.equal(steps[0].text, '正在生成页面 1-4');
  assert.deepEqual(steps[0].details, { slides: '1-4' });
});

test('_pushToProcessPanel supports totalCandidates as totalIdeas', () => {
  const gen = new globalThis.PPTGenerator();
  const steps = [];
  gen.addProcessPanelStep = (evt) => steps.push(evt);

  gen._pushToProcessPanel('design.brainstorm.completed', { totalCandidates: 7 });

  assert.equal(steps.length, 1);
  assert.equal(steps[0].text, '脑暴完成：7 个候选');
  assert.deepEqual(steps[0].details, { ideas: 7 });
});

test('_handleRuntimeEvent updates designer activity for design sub-stages', () => {
  const gen = new globalThis.PPTGenerator();

  gen._pushFlowVizEvent = () => {};
  gen._pushToProcessPanel = () => {};

  const agentCalls = [];
  gen._setAgentStatus = (id, status, activity) => agentCalls.push({ id, status, activity });

  gen._runtimeDesignSubStageUi = {
    'design.tokens': { label: '设计规范提取', agentId: 'designer' },
    'design.brainstorm': { label: '创意构思', agentId: 'designer' },
    'design.image.planning': { label: '图片规划', agentId: 'designer' },
    'design.visual.render': { label: '视觉渲染', agentId: 'designer' },
    'design.refine': { label: '质量精炼', agentId: 'designer' },
    'design.qa': { label: '质量检查', agentId: 'designer' }
  };

  gen._handleRuntimeEvent({ name: 'design.visual.render.started', payload: { planned: { total: 2 } } });
  gen._handleRuntimeEvent({ name: 'design.visual.render.completed', payload: { report: { planned: { 'ai-image': 1 }, completed: { 'ai-image': 1 } } } });
  gen._handleRuntimeEvent({ name: 'design.visual.render.failed', payload: { report: { planned: { 'ai-image': 2 }, completed: { 'ai-image': 1 } } } });

  gen._handleRuntimeEvent({ name: 'design.refine.started', payload: {} });
  gen._handleRuntimeEvent({ name: 'design.refine.ended', payload: {} });

  gen._handleRuntimeEvent({ name: 'design.degraded', payload: { slideNo: 2 } });

  assert.deepEqual(agentCalls[0], { id: 'designer', status: 'active', activity: '视觉渲染' });
  assert.deepEqual(agentCalls[1], { id: 'designer', status: 'active', activity: '视觉渲染完成' });
  assert.deepEqual(agentCalls[2], { id: 'designer', status: 'idle', activity: '视觉渲染失败' });
  assert.deepEqual(agentCalls[3], { id: 'designer', status: 'active', activity: '质量精炼' });
  assert.deepEqual(agentCalls[4], { id: 'designer', status: 'active', activity: '质量精炼完成' });
  assert.deepEqual(agentCalls[5], { id: 'designer', status: 'active', activity: '降级渲染 (第 2 页)' });
});

test('_ensureRuntime populates _runtimeDesignSubStageUi mapping', async () => {
  const gen = new globalThis.PPTGenerator();
  gen.updateTodos = () => {};
  gen.renderPreviewArea = () => {};
  gen.logTerminal = () => {};
  gen.addChatMessage = () => {};
  gen._setAgentStatus = () => {};

  await gen._ensureRuntime({ mode: 'textprep' });

  assert.ok(gen._runtimeDesignSubStageUi && typeof gen._runtimeDesignSubStageUi === 'object');
  assert.deepEqual(gen._runtimeDesignSubStageUi['design.image.planning'], { label: '图片规划', agentId: 'designer' });
});

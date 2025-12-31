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

require('../../js/ppt/generator/ppt_generator_workflow.js');

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

test('design.batch calls DesignAgentLoop and populates deckHtmlDsl + slides', async () => {
  setupDom('<!doctype html><html><body></body></html>');
  globalThis.SlideParser = require('../../js/ppt/core/slide-parser.js').SlideParser;

  const gen = new globalThis.PPTGenerator();
  gen.updateTodos = () => {};
  gen.renderPreviewArea = () => {};
  gen.logTerminal = () => {};
  gen.addChatMessage = () => {};
  gen._setAgentStatus = () => {};

  gen.workflowData.contentPackage = makeContentPackage(4);

  await gen._ensureRuntime({ mode: 'textprep' });

  const design = await import('../../js/agents/stages/design/index.js');
  const originalExecute = design.DesignAgentLoop.prototype.execute;
  let runCalls = 0;
  design.DesignAgentLoop.prototype.execute = async function () {
    runCalls += 1;
    return {
      schemaVersion: '0.1',
      runId: 'run_test',
      deckHtmlDsl: '<section data-type="freeform" data-layout="content"><h1>Ok</h1></section>',
      slidesMeta: [{ slideNo: 1, degraded: false, qa: { pass: true, reasons: [] } }],
      editHints: { degradedCount: 0 },
    };
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
    design.DesignAgentLoop.prototype.execute = originalExecute;
  }
});

test('design.batch falls back to mock deck when DesignAgentLoop throws', async () => {
  setupDom('<!doctype html><html><body></body></html>');
  globalThis.SlideParser = require('../../js/ppt/core/slide-parser.js').SlideParser;

  const gen = new globalThis.PPTGenerator();
  gen.updateTodos = () => {};
  gen.renderPreviewArea = () => {};
  gen.logTerminal = () => {};
  gen.addChatMessage = () => {};
  gen._setAgentStatus = () => {};

  gen.workflowData.contentPackage = makeContentPackage(2);

  await gen._ensureRuntime({ mode: 'textprep' });

  const design = await import('../../js/agents/stages/design/index.js');
  const originalExecute = design.DesignAgentLoop.prototype.execute;
  design.DesignAgentLoop.prototype.execute = async () => {
    throw new Error('boom');
  };

  try {
    const deckPackage = await gen._orchestrator.runStage('design.batch');
    assert.ok(deckPackage && typeof deckPackage === 'object');
    assert.equal(deckPackage.degraded, true);
    assert.equal(deckPackage.degradedReason, 'design_failed');
    assert.equal(deckPackage.degradedError, 'boom');
    assert.equal(typeof deckPackage.degradedAt, 'number');
    assert.ok(typeof gen.workflowData.deckHtmlDsl === 'string' && gen.workflowData.deckHtmlDsl.includes('<section'));
    assert.ok(gen.workflowData.deckHtmlDsl.includes('mock-slide-'));
    assert.ok(Array.isArray(gen.slides) && gen.slides.length > 0);
  } finally {
    design.DesignAgentLoop.prototype.execute = originalExecute;
  }
});

test('design.batch emits design.phase.transition and persists designPhase', async () => {
  setupDom('<!doctype html><html><body></body></html>');
  globalThis.SlideParser = require('../../js/ppt/core/slide-parser.js').SlideParser;

  const gen = new globalThis.PPTGenerator();
  gen.updateTodos = () => {};
  gen.renderPreviewArea = () => {};
  gen.logTerminal = () => {};
  gen.addChatMessage = () => {};
  gen._setAgentStatus = () => {};

  gen.workflowData.contentPackage = makeContentPackage(1);

  await gen._ensureRuntime({ mode: 'textprep' });

  const design = await import('../../js/agents/stages/design/index.js');
  const originalExecute = design.DesignAgentLoop.prototype.execute;
  design.DesignAgentLoop.prototype.execute = async function (_runContext, _contentPackage, stageApi) {
    stageApi?.emit?.('design.phase.transition', { from: 'style_confirming', to: 'generating' }, { status: 'progress' });
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
    assert.equal(gen.workflowData.designPhase?.status, 'generating');
  } finally {
    design.DesignAgentLoop.prototype.execute = originalExecute;
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

test('_pushToProcessPanel shows design phase transitions', () => {
  const gen = new globalThis.PPTGenerator();
  const steps = [];
  gen.addProcessPanelStep = (evt) => steps.push(evt);

  gen._pushToProcessPanel('design.phase.transition', { to: 'generating' });

  assert.equal(steps.length, 1);
  assert.equal(steps[0].text, '设计阶段：生成页面');
  assert.deepEqual(steps[0].details, { phase: '生成页面' });
});

test('_handleRuntimeEvent updates designer activity for design sub-stages', () => {
  const gen = new globalThis.PPTGenerator();

  gen._pushFlowVizEvent = () => {};
  gen._pushToProcessPanel = () => {};

  const agentCalls = [];
  gen._setAgentStatus = (id, status, activity) => agentCalls.push({ id, status, activity });

  gen._runtimeDesignSubStageUi = {
    'design.tokens': { label: '设计规范提取', agentId: 'designer' },
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

test('_handleRuntimeEvent updates slideStatuses for design.slide events', () => {
  const gen = new globalThis.PPTGenerator();
  gen._pushFlowVizEvent = () => {};
  gen._pushToProcessPanel = () => {};

  gen._handleRuntimeEvent({
    name: 'design.slide.started',
    payload: { slideIndex: 0, slideIntent: { id: 'si_1' } }
  });
  assert.equal(gen.workflowData.slideStatuses.bySlideIntentId.si_1.status, 'generating');

  gen._handleRuntimeEvent({
    name: 'design.slide.completed',
    payload: { slideIndex: 0, source: 'llm', duration: 1200 }
  });
  assert.equal(gen.workflowData.slideStatuses.byIndex[0].status, 'completed');
  assert.equal(gen.workflowData.slideStatuses.byIndex[0].duration, 1200);

  gen._handleRuntimeEvent({
    name: 'design.degraded',
    payload: { slideIndex: 0, reason: 'qa_failed' }
  });
  assert.equal(gen.workflowData.slideStatuses.byIndex[0].degraded, true);
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
  assert.equal(gen._runtimeDesignSubStageUi['design.brainstorm'], undefined);
});

test('AgentEventBridge forwards plan.* events', async () => {
  const { EventBus } = await import('../../js/agents/runtime/events/event-bus.js');
  const { AgentEventBridge } = await import('../../js/ppt/workflow/agent-event-bridge.js');

  const source = new EventBus({ runId: 'run_test' });
  const bridge = new AgentEventBridge(source);
  bridge.start();

  const seen = [];
  const off = bridge.subscribe('plan.*', (evt) => seen.push(evt));

  source.emit('plan.created', { hello: 'world' });

  assert.equal(seen.length, 1);
  assert.equal(seen[0].name, 'plan.created');
  assert.deepEqual(seen[0].payload, { hello: 'world' });

  off();
  bridge.stop();
});

test('_updateWorkflowPlanFromStageLifecycle starts script review after deepsearch.pipeline ends', async () => {
  const gen = new globalThis.PPTGenerator();
  gen._currentRunId = 'run_test';
  gen._workflowPlan = null;
  gen._workflowPlanLatestArtifactId = null;
  gen._runStore = null;
  gen._orchestrator = null;

  await gen._ensureWorkflowPlan({ runId: gen._currentRunId });
  await gen._updateWorkflowPlanFromStageLifecycle('deepsearch.ingest', 'ended', { runId: gen._currentRunId }, { name: 'deepsearch.ingest.ended' });
  await gen._updateWorkflowPlanFromStageLifecycle('deepsearch.pipeline', 'started', { runId: gen._currentRunId }, { name: 'deepsearch.pipeline.started' });
  await gen._updateWorkflowPlanFromStageLifecycle('deepsearch.pipeline', 'ended', { runId: gen._currentRunId }, { name: 'deepsearch.pipeline.ended' });

  const plan = gen._workflowPlan;
  assert.ok(plan && typeof plan === 'object');
  const statuses = Object.fromEntries(plan.steps.map((s) => [s.stepId, s.status]));
  assert.equal(statuses['deepsearch.ingest'], 'completed');
  assert.equal(statuses['deepsearch.pipeline'], 'completed');
  assert.equal(statuses['workflow.script_review'], 'in_progress');
});

test('_confirmScriptToPageLayout updates workflow plan steps', () => {
  const gen = new globalThis.PPTGenerator();
  gen.state = 'script_review';
  gen.renderPreviewArea = () => {};
  gen.updateTodos = () => {};
  gen.phase3_PageLayout = () => {};

  const calls = [];
  gen._setWorkflowPlanStepStatus = (stepId, status, options) => {
    calls.push({ stepId, status, options });
    return Promise.resolve(null);
  };

  gen._confirmScriptToPageLayout();

  assert.deepEqual(
    calls.map((c) => ({ stepId: c.stepId, status: c.status, reason: c.options?.reason || null, select: c.options?.select })),
    [
      { stepId: 'workflow.script_review', status: 'completed', reason: 'script_confirmed', select: false },
      { stepId: 'textprep.align', status: 'in_progress', reason: 'script_confirmed.next', select: true },
    ]
  );
});

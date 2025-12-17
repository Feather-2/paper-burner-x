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

// Ensure a window exists before loading dashboard modules (they register on `window.PPTDashboard`).
setupDom();

if (!globalThis.PPTGenerator) {
  globalThis.PPTGenerator = class PPTGenerator {
    constructor() {
      this.state = 'page_layout';
      this._prevState = null;
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
        '最终渲染与质量检查',
      ];
    }
  };
}

require('../../js/ppt/ppt_dashboard_utils.js');
require('../../js/ppt/ppt_dashboard_page_layout.js');

Object.assign(globalThis.PPTGenerator.prototype, window.PPTDashboard.utils, window.PPTDashboard.pageLayout);

test.afterEach(() => {
  teardownDom();
});

function makeGenerator() {
  const gen = new globalThis.PPTGenerator();
  gen.renderPreviewArea = () => {};
  gen.addChatMessage = () => {};
  return gen;
}

function makeContentPackage(count = 3) {
  return {
    schemaVersion: '0.1',
    slideIntents: Array.from({ length: count }, (_, i) => ({
      slideIntentId: `si_${i + 1}`,
      index: i,
      title: `Slide ${i + 1}`,
      pageType: i === 0 ? 'cover' : 'overview',
      objective: '',
      keyPoints: [`Point ${i + 1}`],
      claimIds: [],
      dataTableIds: [],
    })),
  };
}

function makeBrainstormCandidates({ slideIds = ['si_1'], candidatesPerSlide = 2 } = {}) {
  return {
    schemaVersion: '0.1',
    source: 'auto',
    updatedAt: Date.now(),
    candidatesBySlide: slideIds.map((sid, i) => ({
      slideIntentId: sid,
      slideIndex: i,
      candidates: Array.from({ length: candidatesPerSlide }, (_, j) => ({
        candidateId: `${sid}_c${j + 1}`,
        composite: 0.5 + j * 0.1,
        atmosphere: { mood: `Mood ${j + 1}`, colorScheme: 'Use tokens', visualWeight: 'Balanced' },
        elementsMarkdown: `- Element ${j + 1}\n- {{IMAGE:slot_${j + 1}}}`,
        selected: j === 0,
      })),
      selectedCandidateId: `${sid}_c1`,
      selectedCandidate: { candidateId: `${sid}_c1`, selected: true, elementsMarkdown: '- Element 1' },
    })),
    selectedIdeas: [],
  };
}

test('_hasBrainstormCandidates detects candidatesBySlide', () => {
  const gen = makeGenerator();
  assert.equal(gen._hasBrainstormCandidates(), false);
  gen.workflowData.brainstormCandidates = { candidatesBySlide: [] };
  assert.equal(gen._hasBrainstormCandidates(), false);
  gen.workflowData.brainstormCandidates = makeBrainstormCandidates({ slideIds: ['si_1'] });
  assert.equal(gen._hasBrainstormCandidates(), true);
});

test('_setPageLayoutTab clamps max tab based on brainstormCandidates', () => {
  const gen = makeGenerator();
  let renders = 0;
  gen.renderPreviewArea = () => {
    renders += 1;
  };

  gen.workflowData.brainstormCandidates = null;
  gen._setPageLayoutTab(3);
  assert.equal(gen._pageLayoutTab, 2);

  gen.workflowData.brainstormCandidates = makeBrainstormCandidates({ slideIds: ['si_1'] });
  gen._setPageLayoutTab(3);
  assert.equal(gen._pageLayoutTab, 3);
  assert.equal(renders >= 2, true);
});

test('_renderPageLayoutReview shows brainstorm tab only when data exists', () => {
  setupDom('<!doctype html><html><body></body></html>');
  const gen = makeGenerator();
  gen._renderPagePlanTab = () => '<div id="plan"></div>';
  gen._renderPageDetailTab = () => '<div id="detail"></div>';
  gen._renderDesignSpecView = () => '<div id="spec"></div>';

  gen._pageLayoutTab = 3;
  gen.workflowData.contentPackage = makeContentPackage(2);
  gen.workflowData.brainstormCandidates = makeBrainstormCandidates({ slideIds: ['si_1'] });
  document.body.innerHTML = gen._renderPageLayoutReview();
  assert.ok(document.body.textContent.includes('创意候选'));
  assert.ok(document.querySelector('.brainstorm-candidates-panel'));

  const gen2 = makeGenerator();
  gen2._renderPagePlanTab = () => '<div id="plan"></div>';
  gen2._renderPageDetailTab = () => '<div id="detail"></div>';
  gen2._renderDesignSpecView = () => '<div id="spec"></div>';
  gen2._pageLayoutTab = 3;
  gen2.workflowData.contentPackage = makeContentPackage(2);
  gen2.workflowData.brainstormCandidates = null;
  document.body.innerHTML = gen2._renderPageLayoutReview();
  assert.equal(document.body.textContent.includes('创意候选'), false);
  assert.ok(document.querySelector('#spec'));
  assert.equal(gen2._pageLayoutTab, 2);
});

test('_renderBrainstormCandidatesPanel renders slide groups + cards with expected DOM structure', () => {
  setupDom('<!doctype html><html><body></body></html>');
  const gen = makeGenerator();
  gen.workflowData.contentPackage = makeContentPackage(3);
  gen.workflowData.brainstormCandidates = makeBrainstormCandidates({ slideIds: ['si_1', 'si_2'], candidatesPerSlide: 3 });

  document.body.innerHTML = gen._renderBrainstormCandidatesPanel();
  const panel = document.querySelector('.brainstorm-candidates-panel');
  assert.ok(panel);

  const groups = Array.from(document.querySelectorAll('.brainstorm-slide-group'));
  assert.equal(groups.length, 2);

  const cards = Array.from(document.querySelectorAll('.brainstorm-card'));
  assert.equal(cards.length, 6);

  const selected = Array.from(document.querySelectorAll('.brainstorm-card.selected'));
  assert.equal(selected.length, 2);

  assert.ok(document.querySelector('.brainstorm-card-actions'));
  assert.ok(document.querySelector('.brainstorm-card-grid'));

  const firstCard = cards[0];
  assert.ok(firstCard.getAttribute('onclick')?.includes('_selectBrainstormCandidateFromUI'));
  assert.ok(firstCard.getAttribute('data-slide-intent-id'));
  assert.ok(firstCard.getAttribute('data-candidate-id'));
});

test('_selectBrainstormCandidateFromUI calls selectBrainstormCandidate and re-renders', () => {
  const gen = makeGenerator();
  let called = null;
  let renders = 0;
  gen.selectBrainstormCandidate = (sid, cid) => {
    called = { sid, cid };
    return true;
  };
  gen.renderPreviewArea = () => {
    renders += 1;
  };

  assert.equal(gen._selectBrainstormCandidateFromUI('si_1', 'c1'), true);
  assert.deepEqual(called, { sid: 'si_1', cid: 'c1' });
  assert.equal(renders, 1);
});

test('_selectBrainstormCandidateFromUI reports failure when API returns false', () => {
  const gen = makeGenerator();
  let msg = '';
  gen.selectBrainstormCandidate = () => false;
  gen.addChatMessage = (_role, text) => {
    msg = String(text || '');
  };
  assert.equal(gen._selectBrainstormCandidateFromUI('si_1', 'missing'), false);
  assert.ok(msg.includes('选择失败'));
});

test('_regenerateBrainstormForSlideFromUI tracks in-progress state and re-renders', async () => {
  const gen = makeGenerator();
  let renders = 0;
  gen.renderPreviewArea = () => {
    renders += 1;
  };

  let regenCalls = 0;
  gen.regenerateBrainstormForSlide = async () => {
    regenCalls += 1;
  };

  const p1 = gen._regenerateBrainstormForSlideFromUI('si_1');
  const p2 = gen._regenerateBrainstormForSlideFromUI('si_1');
  assert.equal(gen._brainstormRegenInProgress.si_1, true);
  assert.equal(await p2, false);
  assert.equal(await p1, true);
  assert.equal(regenCalls, 1);
  assert.equal(gen._brainstormRegenInProgress.si_1, undefined);
  assert.ok(renders >= 2);
});

test('_getEditableContentPackage initializes workflowData.contentPackage and slideIntents', () => {
  const gen = makeGenerator();
  gen.workflowData = {};
  const pkg = gen._getEditableContentPackage();
  assert.ok(pkg && typeof pkg === 'object');
  assert.ok(Array.isArray(pkg.slideIntents));
});

test('slide intent CRUD: add, duplicate, delete', () => {
  setupDom('<!doctype html><html><body></body></html>');
  const gen = makeGenerator();
  gen.renderPreviewArea = () => {};

  gen.workflowData.contentPackage = makeContentPackage(1);
  gen._insertSlideIntentAt = (pkg, idx) => {
    pkg.slideIntents.splice(idx, 0, { slideIntentId: 'si_new', index: idx, title: 'New', pageType: 'overview', keyPoints: [] });
    return true;
  };
  gen.addSlideIntent(1);
  assert.equal(gen.workflowData.slideIntents.length, 2);
  assert.equal(gen._selectedSlideIntentId, 'si_new');

  gen.duplicateSlideIntent('si_new');
  assert.equal(gen.workflowData.slideIntents.length, 3);

  window.confirm = () => true;
  gen._selectedSlideIntentId = 'si_new';
  gen.deleteSlideIntent('si_new');
  assert.equal(gen.workflowData.slideIntents.length, 2);
  assert.notEqual(gen._selectedSlideIntentId, 'si_new');
});

test('_commitSlideIntentOrder reorders contentPackage.slideIntents based on DOM', () => {
  setupDom('<!doctype html><html><body><div id="pptSlideIntentList"></div></body></html>');
  const gen = makeGenerator();
  gen.workflowData.contentPackage = makeContentPackage(3);
  gen._getEditableContentPackage();

  const list = document.getElementById('pptSlideIntentList');
  list.innerHTML = `
    <div class="slide-intent-card" data-slide-intent-id="si_2"></div>
    <div class="slide-intent-card" data-slide-intent-id="si_1"></div>
    <div class="slide-intent-card" data-slide-intent-id="si_3"></div>
  `;

  gen._commitSlideIntentOrder();
  const ids = gen.workflowData.slideIntents.map((s) => s.slideIntentId);
  assert.deepEqual(ids, ['si_2', 'si_1', 'si_3']);
  assert.deepEqual(gen.workflowData.slideIntents.map((s) => s.index), [0, 1, 2]);
});

test('_setupSlideIntentDrag wires events and commits order on dragend', () => {
  setupDom('<!doctype html><html><body><div id="pptSlideIntentList"></div></body></html>');
  const gen = makeGenerator();
  gen.workflowData.contentPackage = makeContentPackage(2);
  gen._getEditableContentPackage();

  const list = document.getElementById('pptSlideIntentList');
  list.innerHTML = `
    <div class="slide-intent-card" data-slide-intent-id="si_1"><div draggable="true" id="h1"></div></div>
    <div class="slide-intent-card" data-slide-intent-id="si_2"><div draggable="true" id="h2"></div></div>
  `;
  const card1 = list.querySelector('[data-slide-intent-id="si_1"]');
  const card2 = list.querySelector('[data-slide-intent-id="si_2"]');
  card1.getBoundingClientRect = () => ({ top: 0, height: 100 });
  card2.getBoundingClientRect = () => ({ top: 0, height: 100 });

  gen._setupSlideIntentDrag();
  assert.equal(list.dataset.dndBound, '1');

  const dt = { setData: () => {}, setDragImage: () => {} };
  const dragStart = new window.Event('dragstart', { bubbles: true, cancelable: true });
  Object.defineProperty(dragStart, 'dataTransfer', { value: dt });
  list.querySelector('#h1').dispatchEvent(dragStart);

  const dragOver = new window.Event('dragover', { bubbles: true, cancelable: true });
  Object.defineProperty(dragOver, 'clientY', { value: 90 });
  card2.dispatchEvent(dragOver);

  const dragEnd = new window.Event('dragend', { bubbles: true, cancelable: true });
  card1.dispatchEvent(dragEnd);

  assert.deepEqual(gen.workflowData.slideIntents.map((s) => s.slideIntentId), ['si_2', 'si_1']);
});

test('_renderPageDetailTab renders empty state when no selection and form when selected', () => {
  setupDom('<!doctype html><html><body></body></html>');
  const gen = makeGenerator();
  gen.workflowData.contentPackage = makeContentPackage(2);

  gen._selectedSlideIntentId = '';
  assert.ok(gen._renderPageDetailTab().includes('未选择页面'));

  gen._selectedSlideIntentId = 'si_1';
  const html = gen._renderPageDetailTab();
  assert.ok(html.includes('标题'));
  assert.ok(html.includes('页面类型'));
  assert.ok(html.includes('要点（KeyPoints）'));
});

test('edit helpers update slide intents: updateSlideIntent, keypoints, merge, split', () => {
  const gen = makeGenerator();
  gen.addChatMessage = () => {};
  gen.workflowData.contentPackage = makeContentPackage(2);
  gen._selectedSlideIntentId = 'si_1';

  gen.updateSlideIntent('si_1', { title: 'T1', pageType: 'summary', objective: 'O', keyPoints: ['A', 'B'], claimIds: ['c1'] });
  const s1 = gen.workflowData.slideIntents.find((s) => s.slideIntentId === 'si_1');
  assert.equal(s1.title, 'T1');
  assert.equal(s1.pageType, 'summary');
  assert.equal(s1.objective, 'O');
  assert.deepEqual(s1.keyPoints, ['A', 'B']);

  gen.updateSlideIntentKeyPoint('si_1', 0, 'A1');
  assert.equal(s1.keyPoints[0], 'A1');

  gen.addSlideIntentKeyPoint('si_1');
  assert.equal(s1.keyPoints.length, 3);
  gen.removeSlideIntentKeyPoint('si_1', 2);
  assert.equal(s1.keyPoints.length, 2);

  // Merge slide 2 into slide 1
  gen.workflowData.slideIntents.find((s) => s.slideIntentId === 'si_2').objective = 'O2';
  gen.workflowData.slideIntents.find((s) => s.slideIntentId === 'si_2').keyPoints = ['B', 'C'];
  gen.mergeSlideIntents('si_1', 'si_2');
  assert.equal(gen.workflowData.slideIntents.length, 1);
  assert.ok(gen.workflowData.slideIntents[0].objective.includes('O2'));
  assert.deepEqual(gen.workflowData.slideIntents[0].keyPoints, ['A1', 'B', 'C']);

  // Split requires >=2 keyPoints
  gen.workflowData.slideIntents[0].keyPoints = ['K1', 'K2'];
  gen.splitSlideIntent('si_1');
  assert.equal(gen.workflowData.slideIntents.length, 2);
  assert.equal(gen.workflowData.slideIntents[0].keyPoints.length, 1);
});


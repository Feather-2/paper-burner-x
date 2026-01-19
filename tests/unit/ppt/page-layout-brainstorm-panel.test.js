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

await import('../../js/ppt/dashboard/ppt_dashboard_utils.js');
await import('../../js/ppt/dashboard/ppt_dashboard_page_layout.js');

Object.assign(globalThis.PPTGenerator.prototype, window.PPTDashboard.utils, window.PPTDashboard.pageLayout);

afterEach(() => {
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

test('_setPageLayoutTab clamps max tab to 2', () => {
  const gen = makeGenerator();
  let renders = 0;
  gen.renderPreviewArea = () => {
    renders += 1;
  };

  gen._setPageLayoutTab(3);
  expect(gen._pageLayoutTab).toBe(2);

  gen._setPageLayoutTab(1);
  expect(gen._pageLayoutTab).toBe(1);
  expect(renders >= 2).toBe(true);
});

test('_renderPageLayoutReview shows design phase progress', () => {
  setupDom('<!doctype html><html><body></body></html>');
  const gen = makeGenerator();
  gen._renderPagePlanTab = () => '<div id="plan"></div>';
  gen._renderPageDetailTab = () => '<div id="detail"></div>';
  gen._renderDesignSpecView = () => '<div id="spec"></div>';

  gen._pageLayoutTab = 2;
  gen.workflowData.contentPackage = makeContentPackage(2);
  gen.workflowData.designPhase = { status: 'generating' };
  document.body.innerHTML = gen._renderPageLayoutReview();
  expect(document.body.textContent.includes('设计阶段进度')).toBeTruthy();
  expect(document.body.textContent.includes('生成页面')).toBeTruthy();
});

test('_renderPagePlanTab shows slide status badges', () => {
  const gen = makeGenerator();
  gen.workflowData.contentPackage = makeContentPackage(1);
  gen.workflowData.slideStatuses = {
    schemaVersion: '0.1',
    bySlideIntentId: { si_1: { status: 'completed' } },
    byIndex: {}
  };

  const html = gen._renderPagePlanTab();
  expect(html.includes('已完成')).toBeTruthy();
});

test('_getEditableContentPackage initializes workflowData.contentPackage and slideIntents', () => {
  const gen = makeGenerator();
  gen.workflowData = {};
  const pkg = gen._getEditableContentPackage();
  expect(pkg && typeof pkg === 'object').toBeTruthy();
  expect(Array.isArray(pkg.slideIntents).toBeTruthy());
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
  expect(gen.workflowData.slideIntents.length).toBe(2);
  expect(gen._selectedSlideIntentId).toBe('si_new');

  gen.duplicateSlideIntent('si_new');
  expect(gen.workflowData.slideIntents.length).toBe(3);

  window.confirm = () => true;
  gen._selectedSlideIntentId = 'si_new';
  gen.deleteSlideIntent('si_new');
  expect(gen.workflowData.slideIntents.length).toBe(2);
  expect(gen._selectedSlideIntentId).not.toBe('si_new');
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
  expect(ids).toEqual(['si_2', 'si_1', 'si_3']);
  expect(gen.workflowData.slideIntents.map((s) => s.index)).toEqual([0, 1, 2]);
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
  expect(list.dataset.dndBound).toBe('1');

  const dt = { setData: () => {}, setDragImage: () => {} };
  const dragStart = new window.Event('dragstart', { bubbles: true, cancelable: true });
  Object.defineProperty(dragStart, 'dataTransfer', { value: dt });
  list.querySelector('#h1').dispatchEvent(dragStart);

  const dragOver = new window.Event('dragover', { bubbles: true, cancelable: true });
  Object.defineProperty(dragOver, 'clientY', { value: 90 });
  card2.dispatchEvent(dragOver);

  const dragEnd = new window.Event('dragend', { bubbles: true, cancelable: true });
  card1.dispatchEvent(dragEnd);

  expect(gen.workflowData.slideIntents.map((s) => s.slideIntentId)).toEqual(['si_2', 'si_1']);
});

test('_renderPageDetailTab renders empty state when no selection and form when selected', () => {
  setupDom('<!doctype html><html><body></body></html>');
  const gen = makeGenerator();
  gen.workflowData.contentPackage = makeContentPackage(2);

  gen._selectedSlideIntentId = '';
  expect(gen._renderPageDetailTab().toBeTruthy().includes('未选择页面'));

  gen._selectedSlideIntentId = 'si_1';
  const html = gen._renderPageDetailTab();
  expect(html.includes('标题')).toBeTruthy();
  expect(html.includes('页面类型')).toBeTruthy();
  expect(html.includes('要点（KeyPoints）')).toBeTruthy();
});

test('edit helpers update slide intents: updateSlideIntent, keypoints, merge, split', () => {
  const gen = makeGenerator();
  gen.addChatMessage = () => {};
  gen.workflowData.contentPackage = makeContentPackage(2);
  gen._selectedSlideIntentId = 'si_1';

  gen.updateSlideIntent('si_1', { title: 'T1', pageType: 'summary', objective: 'O', keyPoints: ['A', 'B'], claimIds: ['c1'] });
  const s1 = gen.workflowData.slideIntents.find((s) => s.slideIntentId === 'si_1');
  expect(s1.title).toBe('T1');
  expect(s1.pageType).toBe('summary');
  expect(s1.objective).toBe('O');
  expect(s1.keyPoints).toEqual(['A', 'B']);

  gen.updateSlideIntentKeyPoint('si_1', 0, 'A1');
  expect(s1.keyPoints[0]).toBe('A1');

  gen.addSlideIntentKeyPoint('si_1');
  expect(s1.keyPoints.length).toBe(3);
  gen.removeSlideIntentKeyPoint('si_1', 2);
  expect(s1.keyPoints.length).toBe(2);

  // Merge slide 2 into slide 1
  gen.workflowData.slideIntents.find((s) => s.slideIntentId === 'si_2').objective = 'O2';
  gen.workflowData.slideIntents.find((s) => s.slideIntentId === 'si_2').keyPoints = ['B', 'C'];
  gen.mergeSlideIntents('si_1', 'si_2');
  expect(gen.workflowData.slideIntents.length).toBe(1);
  expect(gen.workflowData.slideIntents[0].objective.includes('O2')).toBeTruthy();
  expect(gen.workflowData.slideIntents[0].keyPoints).toEqual(['A1', 'B', 'C']);

  // Split requires >=2 keyPoints
  gen.workflowData.slideIntents[0].keyPoints = ['K1', 'K2'];
  gen.splitSlideIntent('si_1');
  expect(gen.workflowData.slideIntents.length).toBe(2);
  expect(gen.workflowData.slideIntents[0].keyPoints.length).toBe(1);
});

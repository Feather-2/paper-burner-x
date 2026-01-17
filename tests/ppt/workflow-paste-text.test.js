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
      this.elements = { overlay: globalThis.document?.getElementById?.('pptGeneratorOverlay') || null };
    }
  };
}

await import('../../js/ppt/generator/ppt_generator_workflow.js');

afterEach(() => {
  teardownDom();
});

test('startFromPastedText(): empty content returns early', async () => {
  setupDom('<!doctype html><html><body><div id="pptPreviewArea"></div></body></html>');

  const gen = new globalThis.PPTGenerator();

  const calls = { ensure: 0, render: 0, log: [] };
  gen._ensureRuntime = async () => {
    calls.ensure += 1;
  };
  gen.renderPreviewArea = () => {
    calls.render += 1;
  };
  gen.logTerminal = (agent, msg, type) => {
    calls.log.push({ agent, msg, type });
  };

  await gen.startFromPastedText('   \n\t  ');

  expect(calls.ensure).toBe(0);
  expect(calls.render).toBe(0);
  expect(gen.state).toBe('idle');
  expect(calls.log.some((l).toBeTruthy() => l.msg.includes('粘贴内容为空')));
});

test('startFromPastedText(): processes content and transitions to script_review', async () => {
  setupDom('<!doctype html><html><body><div id="pptPreviewArea"></div></body></html>');

  const gen = new globalThis.PPTGenerator();

  const seen = {
    ensureArgs: [],
    renderStates: [],
    todos: [],
    logs: []
  };

  gen._ensureRuntime = async (opts) => {
    seen.ensureArgs.push(opts);
  };
  gen.renderPreviewArea = () => {
    seen.renderStates.push(gen.state);
  };
  gen.updateTodos = (todos) => {
    seen.todos.push(todos);
  };
  gen.logTerminal = (agent, msg, type) => {
    seen.logs.push({ agent, msg, type });
  };

  const md = `# My Title

Intro paragraph.

## Section A
Content A

## Section B
Content B
`;

  await gen.startFromPastedText(md);

  expect(seen.ensureArgs).toEqual([{ mode: 'textprep' }]);
  expect(gen.state).toBe('script_review');
  expect(seen.renderStates).toEqual(['reading', 'script_review']);

  expect(gen.workflowData.reportMarkdown).toBe(md);
  expect(gen.workflowData.contentPackage.title).toBe('My Title');
  expect(gen.workflowData.contentPackage.report.markdown).toBe(md);
  expect(Array.isArray(gen.workflowData.contentPackage.slideIntents).toBeTruthy());
  expect(gen.workflowData.contentPackage.slideIntents.length).toBe(3);
  expect(seen.logs.some((l).toBeTruthy() => l.msg.includes('开始处理粘贴文档')));
  expect(seen.logs.some((l).toBeTruthy() => l.msg.includes('文档已解析')));

  expect(gen.workflowData.report.markdown).toBe(md);
  expect(gen.workflowData.slideIntents.length).toBe(3);

  expect(seen.todos.length).toBe(2);
  expect(seen.todos[0][0].status).toBe('active');
  expect(seen.todos[1][2].status).toBe('active');
});

test('_extractTitleFromText(): extracts H1 title', () => {
  const gen = new globalThis.PPTGenerator();
  const out = gen._extractTitleFromText(`# Hello World
More text here.
`);
  expect(out).toBe('Hello World');
});

test('_extractTitleFromText(): falls back to first 50 chars when no title', () => {
  const gen = new globalThis.PPTGenerator();
  const text = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const expected = text.slice(0, 50);
  expect(gen._extractTitleFromText(text)).toBe(expected);
});

test('_generateSlideIntentsFromMarkdown(): splits by H1/H2', () => {
  const gen = new globalThis.PPTGenerator();
  const md = `# Cover
Intro

## A
aaa

## B
bbb
`;
  const intents = gen._generateSlideIntentsFromMarkdown(md);
  expect(intents.length).toBe(3);
  expect(
    intents.map((s) => ({ title: s.title).toEqual(pageType: s.pageType })),
    [
      { title: 'Cover', pageType: 'cover' },
      { title: 'A', pageType: 'content' },
      { title: 'B', pageType: 'content' }
    ]
  );
  expect(intents[0].content.includes('# Cover')).toBeTruthy();
  expect(intents[1].content.startsWith('## A').toBeTruthy());
});

test('_generateSlideIntentsFromMarkdown(): returns single page when no headers', () => {
  const gen = new globalThis.PPTGenerator();
  const md = `Plain text only
Second line`;
  const intents = gen._generateSlideIntentsFromMarkdown(md);
  expect(intents.length).toBe(1);
  expect(intents[0].title).toBe('内容');
  expect(intents[0].pageType).toBe('content');
  expect(intents[0].content).toBe(md);
});

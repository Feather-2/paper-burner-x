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

require('../../js/ppt/generator/ppt_generator_workflow.js');

test.afterEach(() => {
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

  assert.equal(calls.ensure, 0);
  assert.equal(calls.render, 0);
  assert.equal(gen.state, 'idle');
  assert.ok(calls.log.some((l) => l.msg.includes('粘贴内容为空')));
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

  assert.deepEqual(seen.ensureArgs, [{ mode: 'textprep' }]);
  assert.equal(gen.state, 'script_review');
  assert.deepEqual(seen.renderStates, ['reading', 'script_review']);

  assert.equal(gen.workflowData.reportMarkdown, md);
  assert.equal(gen.workflowData.contentPackage.title, 'My Title');
  assert.equal(gen.workflowData.contentPackage.report.markdown, md);
  assert.ok(Array.isArray(gen.workflowData.contentPackage.slideIntents));
  assert.equal(gen.workflowData.contentPackage.slideIntents.length, 3);
  assert.ok(seen.logs.some((l) => l.msg.includes('开始处理粘贴文档')));
  assert.ok(seen.logs.some((l) => l.msg.includes('文档已解析')));

  assert.equal(gen.workflowData.report.markdown, md);
  assert.equal(gen.workflowData.slideIntents.length, 3);

  assert.equal(seen.todos.length, 2);
  assert.equal(seen.todos[0][0].status, 'active');
  assert.equal(seen.todos[1][2].status, 'active');
});

test('_extractTitleFromText(): extracts H1 title', () => {
  const gen = new globalThis.PPTGenerator();
  const out = gen._extractTitleFromText(`# Hello World
More text here.
`);
  assert.equal(out, 'Hello World');
});

test('_extractTitleFromText(): falls back to first 50 chars when no title', () => {
  const gen = new globalThis.PPTGenerator();
  const text = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const expected = text.slice(0, 50);
  assert.equal(gen._extractTitleFromText(text), expected);
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
  assert.equal(intents.length, 3);
  assert.deepEqual(
    intents.map((s) => ({ title: s.title, pageType: s.pageType })),
    [
      { title: 'Cover', pageType: 'cover' },
      { title: 'A', pageType: 'content' },
      { title: 'B', pageType: 'content' }
    ]
  );
  assert.ok(intents[0].content.includes('# Cover'));
  assert.ok(intents[1].content.startsWith('## A'));
});

test('_generateSlideIntentsFromMarkdown(): returns single page when no headers', () => {
  const gen = new globalThis.PPTGenerator();
  const md = `Plain text only
Second line`;
  const intents = gen._generateSlideIntentsFromMarkdown(md);
  assert.equal(intents.length, 1);
  assert.equal(intents[0].title, '内容');
  assert.equal(intents[0].pageType, 'content');
  assert.equal(intents[0].content, md);
});


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
  delete globalThis.PPTXSlideParser;
  delete globalThis.PPTGenerator;
}

test.afterEach(() => {
  teardownDom();
  delete require.cache[require.resolve('../../js/ppt/ppt_generator_workflow.js')];
});

test('import PPTX as deck: parsed → slideIntents set → design.batch template branch populates deckHtmlDsl', async () => {
  setupDom('<!doctype html><html><body></body></html>');
  globalThis.SlideParser = require('../../js/ppt/slide-parser.js').SlideParser;

  globalThis.PPTGenerator = class PPTGenerator {
    constructor() {
      this.state = 'idle';
      this._prevState = null;
      this.workflowData = { files: [] };
      this.processLogs = [];
      this.currentProject = { title: 'Demo', chatHistory: [] };
      this.elements = { overlay: null };
      this.agents = { reader: {}, analyst: {}, designer: {}, reviewer: {} };
      this.sampleHTML = '';
      this.slides = [];
    }
  };

  require('../../js/ppt/ppt_generator_workflow.js');

  const gen = new globalThis.PPTGenerator();
  gen.updateTodos = () => {};
  gen.renderPreviewArea = () => {};
  gen.logTerminal = () => {};
  gen.addChatMessage = () => {};
  gen._setAgentStatus = () => {};

  globalThis.PPTXSlideParser = class PPTXSlideParser {
    async parse() {
      return {
        metadata: { slideCount: 1 },
        slides: [
          {
            background: '#ffffff',
            elements: [
              {
                type: 'image',
                id: 'img1',
                x: '12%',
                y: '34%',
                w: '20%',
                h: '30%',
                src: 'data:image/png;base64,AAAA',
                alt: '图片',
              },
              {
                type: 'text',
                id: 't1',
                role: 'title',
                x: '8%',
                y: '8%',
                w: '84%',
                h: '10%',
                content: 'Hello PPTX',
                font: 32,
                color: '#111111',
                bold: true,
                align: 'left',
              },
            ],
          },
        ],
      };
    }
  };

  const fakeFile = {
    name: 'template.pptx',
    async arrayBuffer() {
      return new ArrayBuffer(8);
    }
  };

  await gen.__pptWorkflowMixinsReady;
  const res = await gen.importPptxAsDeck(fakeFile);
  assert.equal(res.ok, true);
  assert.equal(Array.isArray(gen.workflowData.slideIntents), true);
  assert.equal(gen.workflowData.slideIntents.length, 1);

  assert.ok(typeof gen.workflowData.deckHtmlDsl === 'string' && gen.workflowData.deckHtmlDsl.includes('<section'));
  assert.ok(gen.workflowData.deckHtmlDsl.includes('data-el="image"'));
  assert.ok(gen.workflowData.deckHtmlDsl.includes('data-x="12%"'));
  assert.ok(gen.workflowData.deckHtmlDsl.includes('data-y="34%"'));

  assert.ok(gen.workflowData.deckPackage);
  assert.equal(gen.workflowData.deckPackage.slidesMeta?.[0]?.source, 'pptx_template');
});

test('import PPTX as deck: parse failure falls back to manual flow', async () => {
  setupDom('<!doctype html><html><body></body></html>');

  globalThis.PPTGenerator = class PPTGenerator {
    constructor() {
      this.state = 'idle';
      this.workflowData = { files: [] };
      this.processLogs = [];
      this.currentProject = { title: 'Demo', chatHistory: [] };
      this.elements = { overlay: null };
      this.agents = { reader: {}, analyst: {}, designer: {}, reviewer: {} };
      this.sampleHTML = '';
      this.slides = [];
    }
  };

  require('../../js/ppt/ppt_generator_workflow.js');

  const gen = new globalThis.PPTGenerator();
  gen.updateTodos = () => {};
  gen.renderPreviewArea = () => {};

  const messages = [];
  gen.addChatMessage = (role, content) => messages.push({ role, content });

  let opened = 0;
  gen.openPasteDocumentModal = () => {
    opened += 1;
  };

  globalThis.PPTXSlideParser = class PPTXSlideParser {
    async parse() {
      throw new Error('boom');
    }
  };

  const fakeFile = {
    name: 'bad.pptx',
    async arrayBuffer() {
      return new ArrayBuffer(8);
    }
  };

  await gen.__pptWorkflowMixinsReady;
  const res = await gen.importPptxAsDeck(fakeFile);
  assert.equal(res.ok, false);
  assert.equal(gen.state, 'idle');
  assert.equal(opened, 1);
  assert.ok(messages.some((m) => m.role === 'ai' && m.content.includes('PPTX 导入失败')));
});


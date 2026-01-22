// TODO: Manual fix needed for dynamic require() calls
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
  delete globalThis.SlideParser;
  delete globalThis.PPTXSlideParser;
  delete globalThis.PPTGenerator;
}

afterEach(() => {
  teardownDom();
  // `require.cache` does not reliably clear Vite/Vitest module cache for ESM modules.
  // Reset the module graph so workflow mixins re-install onto the per-test PPTGenerator class.
  vi.resetModules();
});

test('import PPTX as deck: parsed → slideIntents set → design.batch template branch populates deckHtmlDsl', async () => {
  setupDom('<!doctype html><html><body></body></html>');
  globalThis.SlideParser = (await import('../../../js/ppt/core/slide-parser.js')).SlideParser;

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

  await import('../../../js/ppt/generator/ppt_generator_workflow.js');

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
  expect(res.ok).toBe(true);
  expect(Array.isArray(gen.workflowData.slideIntents)).toBe(true);
  expect(gen.workflowData.slideIntents.length).toBe(1);

  expect(typeof gen.workflowData.deckHtmlDsl === 'string' && gen.workflowData.deckHtmlDsl.includes('<section')).toBeTruthy();
  expect(gen.workflowData.deckHtmlDsl.includes('data-el="image"')).toBeTruthy();
  expect(gen.workflowData.deckHtmlDsl.includes('data-x="12%"')).toBeTruthy();
  expect(gen.workflowData.deckHtmlDsl.includes('data-y="34%"')).toBeTruthy();

  expect(gen.workflowData.deckPackage).toBeTruthy();
  expect(gen.workflowData.deckPackage.slidesMeta?.[0]?.source).toBe('pptx_template');
});

test('import PPTX as deck: parse failure falls back to manual flow', async () => {
  setupDom('<!doctype html><html><body></body></html>');
  globalThis.SlideParser = (await import('../../../js/ppt/core/slide-parser.js')).SlideParser;

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

  await import('../../../js/ppt/generator/ppt_generator_workflow.js');

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
  expect(res.ok).toBe(false);
  expect(gen.state).toBe('idle');
  expect(opened).toBe(1);
  expect(messages.some((m) => m.role === 'ai' && m.content.includes('PPTX 导入失败'))).toBeTruthy();
});

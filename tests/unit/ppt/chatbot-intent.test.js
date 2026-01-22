import { describe, it, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { parseHTML } from 'linkedom';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

beforeEach(() => {
  setupDom();
});

afterEach(() => {
  teardownDom();
  delete globalThis.IntentParser;
  delete globalThis.PPTGenerator;
});

async function importFresh(specifier) {
  const url = new URL(specifier, import.meta.url);
  url.searchParams.set('t', `${Date.now()}_${Math.random().toString(16).slice(2)}`);
  return import(url.href);
}

async function reload(modulePath) {
  // Ensure mixins run against the current global PPTGenerator binding.
  await importFresh(modulePath);
}

test('chatbot: "把标题改成xxx" routes to edit (OperationPlanner via executeNaturalLanguage)', async () => {
  // Provide a global PPTGenerator class before requiring the mixin.
  globalThis.PPTGenerator = class PPTGenerator {
    constructor() {
      this.currentSlideIndex = 1;
      this.currentProject = { chatHistory: [] };
      this.workflowData = {};
      this.sampleHTML = '';
    }
  };

  await reload('../../../js/ppt/generator/ppt_generator_utilities.js');

  // Real IntentParser (with parse alias)
  await reload('../../../js/ppt/editor/intent/intent-parser.js');

  const planCalls = [];
  window.OperationPlanner = {
    planOperations: (...args) => {
      planCalls.push(args);
      return [];
    }
  };

  const gen = new globalThis.PPTGenerator();
  gen.addChatMessage = () => {};
  gen.syncDSL = () => {};

  const execCalls = [];
  gen.initEditor = async () => {
    gen.editor = {
      executeNaturalLanguage: async (input, context) => {
        execCalls.push({ input, context });
        const intent = await window.IntentParser.parse(input, context);
        window.OperationPlanner.planOperations(intent, []);
        return { intent, operations: [] };
      }
    };
  };

  await gen.handleUserMessage('把标题改成 你好');

  expect(execCalls.length).toBe(1);
  expect(planCalls.length).toBe(1);
  expect(execCalls[0].context.currentSlideIndex).toBe(1);
});

test('chatbot: "重新设计第3页" routes to generation (Design Agent)', async () => {
  globalThis.PPTGenerator = class PPTGenerator {
    constructor() {
      this.currentSlideIndex = 0;
      this.currentProject = { chatHistory: [] };
      this.workflowData = { contentPackage: { slideIntents: [{ title: 'A' }] } };
      this.sampleHTML = '';
    }
  };

  await reload('../../../js/ppt/generator/ppt_generator_utilities.js');
  await reload('../../../js/ppt/editor/intent/intent-parser.js');

  const gen = new globalThis.PPTGenerator();
  gen.addChatMessage = () => {};
  gen.initEditor = async () => {
    throw new Error('should not init editor for generation intent');
  };

  let ensureCalls = 0;
  gen._ensureRuntime = async () => {
    ensureCalls += 1;
    gen._orchestrator = {
      runStage: async (name, input) => {
        expect(name).toBe('design.batch');
        expect(input && typeof input === 'object').toBeTruthy();
      }
    };
  };

  await gen.handleUserMessage('重新设计第3页');

  expect(ensureCalls).toBe(1);
});

test('chatbot: IntentParser failure returns friendly message', async () => {
  globalThis.PPTGenerator = class PPTGenerator {
    constructor() {
      this.currentSlideIndex = 0;
      this.currentProject = { chatHistory: [] };
      this.workflowData = {};
      this.sampleHTML = '';
    }
  };

  await reload('../../../js/ppt/generator/ppt_generator_utilities.js');

  window.IntentParser = {
    parse: async () => {
      throw new Error('boom');
    }
  };

  const messages = [];
  const gen = new globalThis.PPTGenerator();
  gen.addChatMessage = (role, content) => messages.push({ role, content });

  await gen.handleUserMessage('hello');

  expect(messages.some((m) => m.role === 'ai' && m.content.includes('抱歉'))).toBeTruthy();
});

test('chatbot: concurrent intents are queued (no overlap)', async () => {
  globalThis.PPTGenerator = class PPTGenerator {
    constructor() {
      this.currentSlideIndex = 0;
      this.currentProject = { chatHistory: [] };
      this.workflowData = { contentPackage: { slideIntents: [{ title: 'A' }, { title: 'B' }] } };
      this.sampleHTML = '';
    }
  };

  await reload('../../../js/ppt/generator/ppt_generator_utilities.js');
  await reload('../../../js/ppt/editor/intent/intent-parser.js');

  const gen = new globalThis.PPTGenerator();
  gen.addChatMessage = () => {};
  gen._ensureRuntime = async () => {
    gen._orchestrator = gen._orchestrator || {
      inFlight: 0,
      overlaps: 0,
      calls: 0,
      runStage: async () => {
        gen._orchestrator.calls += 1;
        gen._orchestrator.inFlight += 1;
        if (gen._orchestrator.inFlight > 1) gen._orchestrator.overlaps += 1;
        await sleep(40);
        gen._orchestrator.inFlight -= 1;
      }
    };
  };

  await Promise.all([gen.handleUserMessage('重新设计第1页'), gen.handleUserMessage('重新设计第2页')]);

  expect(gen._orchestrator.calls).toBe(2);
  expect(gen._orchestrator.overlaps).toBe(0);
});

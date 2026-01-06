import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

const { window, document } = parseHTML('<!doctype html><html><head></head><body></body></html>');
globalThis.window = window;
globalThis.document = document;

function resetDom(bodyHtml = '<div id="pptGeneratorOverlay"></div>') {
  document.body.innerHTML = bodyHtml;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Ensure a baseline DOM before loading dashboard modules.
resetDom();

// Provide a global PPTGenerator binding before requiring mixins.
if (!globalThis.PPTGenerator) {
  globalThis.PPTGenerator = class PPTGenerator {
    constructor() {
      this.state = 'idle';
      this._prevState = null;
      this.workflowData = { files: [] };
      this.processLogs = [];
      this.currentProject = { title: 'Demo' };
      this.elements = { overlay: globalThis.document?.getElementById?.('pptGeneratorOverlay') || null };
    }
  };
}

await import('../../js/ppt/dashboard/ppt_dashboard_utils.js');
await import('../../js/ppt/dashboard/ppt_dashboard_upload.js');
await import('../../js/ppt/dashboard/ppt_dashboard_history.js');
await import('../../js/ppt/dashboard/ppt_dashboard_url_input.js');
await import('../../js/ppt/dashboard/ppt_dashboard_paste.js');
await import('../../js/ppt/dashboard/ppt_dashboard_modals.js');
await import('../../js/ppt/dashboard/ppt_dashboard_deepsearch.js');
await import('../../js/ppt/dashboard/ppt_dashboard_page_layout.js');
await import('../../js/ppt/dashboard/ppt_dashboard_design_spec.js');
await import('../../js/ppt/dashboard/ppt_dashboard_outline.js');
await import('../../js/ppt/dashboard/ppt_dashboard_core.js');

test.afterEach(() => {
  delete globalThis.VditorAdapter;
  resetDom();
});

test('upload view: renders "直接粘贴文档" button', () => {
  const gen = new globalThis.PPTGenerator();
  const html = gen._renderUploadView();
  assert.ok(html.includes('data-action="openPasteDocumentModal"'));
  assert.ok(html.includes('carbon:paste'));
  assert.ok(html.includes('直接粘贴文档'));
});

test('openPasteDocumentModal(): creates modal and mounts Vditor when available', async () => {
  resetDom('<div id="pptGeneratorOverlay"></div>');

  const mountCalls = [];
  globalThis.VditorAdapter = {
    isAvailable: () => true,
    mount: (opts) => {
      mountCalls.push(opts);
      return { ok: true };
    },
    destroy: () => {}
  };

  const gen = new globalThis.PPTGenerator();
  gen.elements.overlay = document.getElementById('pptGeneratorOverlay');

  gen.openPasteDocumentModal();
  assert.ok(document.getElementById('pptPasteDocumentModal'));

  await sleep(130);
  assert.equal(mountCalls.length, 1);
  assert.equal(mountCalls[0].container, 'pasteDocumentEditor');
  assert.equal(mountCalls[0].mode, 'ir');
});

test('closePasteDocumentModal(): clears timer, destroys adapter, and removes modal', async () => {
  resetDom('<div id="pptGeneratorOverlay"></div>');

  let destroyCalls = 0;
  let mountCalls = 0;
  globalThis.VditorAdapter = {
    isAvailable: () => true,
    mount: () => {
      mountCalls += 1;
      return { ok: true };
    },
    destroy: () => {
      destroyCalls += 1;
    }
  };

  const gen = new globalThis.PPTGenerator();
  gen.elements.overlay = document.getElementById('pptGeneratorOverlay');

  gen.openPasteDocumentModal();
  gen.closePasteDocumentModal();

  await sleep(130);
  assert.equal(mountCalls, 0);
  assert.equal(destroyCalls, 1);

  await sleep(320);
  assert.equal(document.getElementById('pptPasteDocumentModal'), null);
});

test('confirmPasteDocument(): reads from VditorAdapter and calls startFromPastedText()', async () => {
  resetDom('<div id="pptGeneratorOverlay"></div>');

  globalThis.VditorAdapter = {
    isAvailable: () => true,
    mount: () => ({ ok: true }),
    getValue: () => 'from-vditor',
    destroy: () => {}
  };

  const gen = new globalThis.PPTGenerator();
  gen.elements.overlay = document.getElementById('pptGeneratorOverlay');

  const seen = [];
  gen.startFromPastedText = (content) => seen.push(content);

  gen.openPasteDocumentModal();
  await sleep(130);

  gen.confirmPasteDocument();
  assert.deepEqual(seen, ['from-vditor']);

  await sleep(320);
  assert.equal(document.getElementById('pptPasteDocumentModal'), null);
});

test('confirmPasteDocument(): falls back to textarea when Vditor unavailable', async () => {
  resetDom('<div id="pptGeneratorOverlay"></div>');

  globalThis.VditorAdapter = {
    isAvailable: () => false,
    destroy: () => {}
  };

  const gen = new globalThis.PPTGenerator();
  gen.elements.overlay = document.getElementById('pptGeneratorOverlay');

  const seen = [];
  gen.startFromPastedText = (content) => seen.push(content);

  gen.openPasteDocumentModal();
  await sleep(130);

  const textarea = document.getElementById('pasteDocumentTextarea');
  assert.ok(textarea);
  textarea.value = 'from-textarea';

  gen.confirmPasteDocument();
  assert.deepEqual(seen, ['from-textarea']);

  await sleep(320);
  assert.equal(document.getElementById('pptPasteDocumentModal'), null);
});

test('esm entrypoints: dashboard/generator/model-config/renderers import and expose APIs', async () => {
  const dashboard = await import('../../js/ppt/dashboard/index.js');
  const generator = await import('../../js/ppt/generator/index.js');
  const modelConfig = await import('../../js/ppt/model-config/index.js');
  const renderers = await import('../../js/ppt/renderers/index.js');
  const unified = await import('../../js/ppt/index.js');

  assert.ok(dashboard.PPTDashboard);
  assert.ok(dashboard.VditorAdapter);
  assert.ok(typeof generator.ensurePptGenerator === 'function');
  assert.ok(modelConfig.PPTModelConfig);
  assert.ok(modelConfig.PPTModelConfigModal);
  assert.ok(renderers.HTMLSlideRenderer);
  assert.ok(renderers.PPTXSlideRenderer);

  assert.ok(unified.Core);
  assert.ok(unified.Generator);
  assert.ok(window.PPT);
  assert.ok(window.PPTDashboard);
});

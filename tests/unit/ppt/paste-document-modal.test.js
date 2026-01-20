import { describe, it, test, expect, beforeEach, afterEach, vi } from 'vitest';
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

await import('../../../js/ppt/dashboard/ppt_dashboard_utils.js');
await import('../../../js/ppt/dashboard/ppt_dashboard_upload.js');
await import('../../../js/ppt/dashboard/ppt_dashboard_history.js');
await import('../../../js/ppt/dashboard/ppt_dashboard_url_input.js');
await import('../../../js/ppt/dashboard/ppt_dashboard_paste.js');
await import('../../../js/ppt/dashboard/ppt_dashboard_modals.js');
await import('../../../js/ppt/dashboard/ppt_dashboard_deepsearch.js');
await import('../../../js/ppt/dashboard/ppt_dashboard_page_layout.js');
await import('../../../js/ppt/dashboard/ppt_dashboard_design_spec.js');
await import('../../../js/ppt/dashboard/ppt_dashboard_outline.js');
await import('../../../js/ppt/dashboard/ppt_dashboard_core.js');

afterEach(() => {
  delete globalThis.VditorAdapter;
  resetDom();
});

test('upload view: renders "直接粘贴文档" button', () => {
  const gen = new globalThis.PPTGenerator();
  const html = gen._renderUploadView();
  expect(html.includes('data-action="openPasteDocumentModal"')).toBeTruthy();
  expect(html.includes('carbon:paste')).toBeTruthy();
  expect(html.includes('直接粘贴文档')).toBeTruthy();
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
  expect(document.getElementById('pptPasteDocumentModal').toBeTruthy());

  await sleep(130);
  expect(mountCalls.length).toBe(1);
  expect(mountCalls[0].container).toBe('pasteDocumentEditor');
  expect(mountCalls[0].mode).toBe('ir');
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
  expect(mountCalls).toBe(0);
  expect(destroyCalls).toBe(1);

  await sleep(320);
  expect(document.getElementById('pptPasteDocumentModal')).toBe(null);
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
  expect(seen).toEqual(['from-vditor']);

  await sleep(320);
  expect(document.getElementById('pptPasteDocumentModal')).toBe(null);
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
  expect(textarea).toBeTruthy();
  textarea.value = 'from-textarea';

  gen.confirmPasteDocument();
  expect(seen).toEqual(['from-textarea']);

  await sleep(320);
  expect(document.getElementById('pptPasteDocumentModal')).toBe(null);
});

test('esm entrypoints: dashboard/generator/model-config/renderers import and expose APIs', async () => {
  const dashboard = await import('../../../js/ppt/dashboard/index.js');
  const generator = await import('../../../js/ppt/generator/index.js');
  const modelConfig = await import('../../../js/ppt/model-config/index.js');
  const renderers = await import('../../../js/ppt/renderers/index.js');
  const unified = await import('../../../js/ppt/index.js');

  expect(dashboard.PPTDashboard).toBeTruthy();
  expect(dashboard.VditorAdapter).toBeTruthy();
  expect(typeof generator.ensurePptGenerator === 'function').toBeTruthy();
  expect(modelConfig.PPTModelConfig).toBeTruthy();
  expect(modelConfig.PPTModelConfigModal).toBeTruthy();
  expect(renderers.HTMLSlideRenderer).toBeTruthy();
  expect(renderers.PPTXSlideRenderer).toBeTruthy();

  expect(unified.Core).toBeTruthy();
  expect(unified.Generator).toBeTruthy();
  expect(window.PPT).toBeTruthy();
  expect(window.PPTDashboard).toBeTruthy();
});

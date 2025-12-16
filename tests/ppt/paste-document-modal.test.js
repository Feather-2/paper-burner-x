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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Ensure a window exists before loading dashboard modules (they register on `window.PPTDashboard`).
setupDom();

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

require('../../js/ppt/ppt_dashboard_utils.js');
require('../../js/ppt/ppt_dashboard_upload.js');
require('../../js/ppt/ppt_dashboard_history.js');
require('../../js/ppt/ppt_dashboard_url_input.js');
require('../../js/ppt/ppt_dashboard_paste.js');
require('../../js/ppt/ppt_dashboard_modals.js');
require('../../js/ppt/ppt_dashboard_deepsearch.js');
require('../../js/ppt/ppt_dashboard_page_layout.js');
require('../../js/ppt/ppt_dashboard_design_spec.js');
require('../../js/ppt/ppt_dashboard_outline.js');
require('../../js/ppt/ppt_dashboard_core.js');

test.afterEach(() => {
  delete globalThis.VditorAdapter;
  teardownDom();
});

test('upload view: renders "直接粘贴文档" button', () => {
  const gen = new globalThis.PPTGenerator();
  const html = gen._renderUploadView();
  assert.ok(html.includes('openPasteDocumentModal()'));
  assert.ok(html.includes('carbon:paste'));
  assert.ok(html.includes('直接粘贴文档'));
});

test('openPasteDocumentModal(): creates modal and mounts Vditor when available', async () => {
  setupDom('<!doctype html><html><head></head><body><div id="pptGeneratorOverlay"></div></body></html>');

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
  setupDom('<!doctype html><html><head></head><body><div id="pptGeneratorOverlay"></div></body></html>');

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
  setupDom('<!doctype html><html><head></head><body><div id="pptGeneratorOverlay"></div></body></html>');

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
  setupDom('<!doctype html><html><head></head><body><div id="pptGeneratorOverlay"></div></body></html>');

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

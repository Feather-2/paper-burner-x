const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { parseHTML } = require("linkedom");

function readText(relPath) {
  const absPath = path.resolve(__dirname, "..", "..", relPath);
  return fs.readFileSync(absPath, "utf8");
}

test("ppt.html: includes Vditor CDN CSS/JS (v3.10.7) before other CSS", () => {
  const html = readText("ppt.html");
  const { document } = parseHTML(html);

  const cssHref = "https://gcore.jsdelivr.net/npm/vditor@3.10.7/dist/index.css";
  const jsSrc = "https://gcore.jsdelivr.net/npm/vditor@3.10.7/dist/index.min.js";

  assert.ok(document.querySelector(`head link[rel="stylesheet"][href="${cssHref}"]`));
  assert.ok(document.querySelector(`head script[src="${jsSrc}"]`));

  assert.ok(html.indexOf(cssHref) !== -1);
  assert.ok(html.indexOf(cssHref) < html.indexOf("css/ppt/ppt_generation_variables.css"));
});

test("ppt.html: includes css/ppt/ppt_vditor.css after other ppt CSS", () => {
  const html = readText("ppt.html");
  const { document } = parseHTML(html);

  const href = "css/ppt/ppt_vditor.css";
  assert.ok(document.querySelector(`head link[rel="stylesheet"][href="${href}"]`));

  assert.ok(html.indexOf("css/slide-editor.css") !== -1);
  assert.ok(html.indexOf("css/slide-editor.css") < html.indexOf(href));
});

test("css/ppt/ppt_vditor.css: exists and uses --ppt- variables", () => {
  const absCssPath = path.resolve(__dirname, "..", "..", "css/ppt/ppt_vditor.css");
  assert.ok(fs.existsSync(absCssPath));

  const css = fs.readFileSync(absCssPath, "utf8");
  assert.ok(css.includes("#pptPreviewArea .vditor"));
  assert.match(css, /var\(--ppt-/);
});


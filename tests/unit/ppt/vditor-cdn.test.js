import { describe, it, test, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseHTML } from "linkedom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readText(relPath) {
  const absPath = path.resolve(__dirname, "..", "..", "..", relPath);
  return fs.readFileSync(absPath, "utf8");
}

test("ppt.html: includes Vditor CDN CSS/JS (v3.10.7) before other CSS", () => {
  const html = readText("ppt.html");
  const { document } = parseHTML(html);

  const cssHref = "https://gcore.jsdelivr.net/npm/vditor@3.10.7/dist/index.css";
  const jsSrc = "https://gcore.jsdelivr.net/npm/vditor@3.10.7/dist/index.min.js";

  expect(document.querySelector(`head link[rel="stylesheet"][href="${cssHref}"]`)).toBeTruthy();
  expect(document.querySelector(`head script[src="${jsSrc}"]`)).toBeTruthy();

  expect(html.indexOf(cssHref) !== -1).toBeTruthy();
  expect(html.indexOf(cssHref) < html.indexOf("css/ppt/ppt_generation_variables.css")).toBeTruthy();
});

test("ppt.html: includes css/ppt/ppt_vditor.css after other ppt CSS", () => {
  const html = readText("ppt.html");
  const { document } = parseHTML(html);

  const href = "css/ppt/ppt_vditor.css";
  expect(document.querySelector(`head link[rel="stylesheet"][href="${href}"]`)).toBeTruthy();

  expect(html.indexOf("css/slide-editor.css") !== -1).toBeTruthy();
  expect(html.indexOf("css/slide-editor.css") < html.indexOf(href)).toBeTruthy();
});

test("css/ppt/ppt_vditor.css: exists and uses --ppt- variables", () => {
  const absCssPath = path.resolve(__dirname, "..", "..", "..", "css/ppt/ppt_vditor.css");
  expect(fs.existsSync(absCssPath)).toBeTruthy();

  const css = fs.readFileSync(absCssPath, "utf8");
  expect(css.includes("#pptPreviewArea .vditor")).toBeTruthy();
  expect(css).toMatch(/var\(--ppt-/);
});

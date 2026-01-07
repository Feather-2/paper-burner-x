/**
 * ReDoS-safe: 查找指定标签的开始标记
 */
function findTagStart(html, tagName, startPos = 0) {
  const lower = html.toLowerCase();
  const pattern = `<${tagName.toLowerCase()}`;
  const idx = lower.indexOf(pattern, startPos);
  if (idx === -1) return null;
  const endIdx = html.indexOf(">", idx);
  if (endIdx === -1) return null;
  return { start: idx, end: endIdx + 1, tag: html.slice(idx, endIdx + 1) };
}

/**
 * ReDoS-safe: 查找所有带 data-el 属性的元素
 */
function findDataElElements(html) {
  const results = [];
  let pos = 0;
  while (pos < html.length) {
    const tagStart = html.indexOf("<", pos);
    if (tagStart === -1) break;
    const tagEnd = html.indexOf(">", tagStart);
    if (tagEnd === -1) break;
    const tag = html.slice(tagStart, tagEnd + 1);
    if (tag.includes("data-el=")) {
      results.push({ start: tagStart, end: tagEnd + 1, tag });
    }
    pos = tagEnd + 1;
  }
  return results;
}

function parseAttrs(tag) {
  const attrs = {};
  const re = /([a-zA-Z_:][\w:.-]*)="([^"]*)"/g;
  let m;
  while ((m = re.exec(tag))) attrs[m[1]] = m[2];
  return attrs;
}

function parsePercent(v) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s.endsWith("%")) return null;
  const n = Number.parseFloat(s.slice(0, -1));
  return Number.isFinite(n) ? n : null;
}

function parseCssFontSize(style) {
  if (!style) return null;
  const m = String(style).match(/font-size\s*:\s*([0-9.]+)\s*px/i);
  if (!m) return null;
  const n = Number.parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
}

function parseCssColor(style) {
  if (!style) return null;
  const m = String(style).match(/color\s*:\s*([^;]+)/i);
  return m ? m[1].trim() : null;
}

function hexToRgb(hex) {
  if (typeof hex !== "string") return null;
  const s = hex.trim();
  if (!s.startsWith("#")) return null;
  const h = s.slice(1);
  if (h.length === 3) {
    const r = Number.parseInt(h[0] + h[0], 16);
    const g = Number.parseInt(h[1] + h[1], 16);
    const b = Number.parseInt(h[2] + h[2], 16);
    return Number.isFinite(r) ? { r, g, b } : null;
  }
  if (h.length === 6) {
    const r = Number.parseInt(h.slice(0, 2), 16);
    const g = Number.parseInt(h.slice(2, 4), 16);
    const b = Number.parseInt(h.slice(4, 6), 16);
    return Number.isFinite(r) ? { r, g, b } : null;
  }
  return null;
}

function srgbToLin(c) {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function luminance(rgb) {
  const r = srgbToLin(rgb.r);
  const g = srgbToLin(rgb.g);
  const b = srgbToLin(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(fg, bg) {
  const L1 = luminance(fg);
  const L2 = luminance(bg);
  const hi = Math.max(L1, L2);
  const lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * QA validator for a single slide HTML DSL.
 * Checks: min font size, simple overflow (x/y/w/h percent bounds), basic contrast ratio for text.
 *
 * @param {string} slideHtml
 * @returns {{valid:boolean, violations:Array<{type:string,message:string,severity:"warn"|"error",elementId?:string}>, pass:boolean, issues:Array<{code:string,message:string,severity:"warn"|"error",elementId?:string}>}}
 */
export function validateSlide(slideHtml) {
  /** @type {Array<{ code: string, message: string, severity: "warn" | "error", elementId?: string }>} */
  const issues = [];
  const html = typeof slideHtml === "string" ? slideHtml : "";

  // ReDoS-safe: 使用安全的标签查找
  const sectionResult = findTagStart(html, "section");
  const sectionTag = sectionResult?.tag || "";
  const sectionAttrs = parseAttrs(sectionTag);
  const bgRaw = sectionAttrs["data-bg"] || "#ffffff";
  const bgRgb = hexToRgb(bgRaw) || hexToRgb("#ffffff");

  // ReDoS-safe: 使用迭代查找替代 [^>]* 正则
  const dataElElements = findDataElElements(html);
  for (const { tag } of dataElElements) {
    const attrs = parseAttrs(tag);
    const type = attrs["data-el"];
    const elementId = typeof attrs.id === "string" ? attrs.id : undefined;

    const x = parsePercent(attrs["data-x"]);
    const y = parsePercent(attrs["data-y"]);
    const w = parsePercent(attrs["data-w"]);
    const h = parsePercent(attrs["data-h"]);

    if (x !== null && w !== null && (x < 0 || x + w > 100.0001)) {
      issues.push({
        code: "overflow_x",
        severity: "error",
        elementId,
        message: `Element overflows horizontally: x=${attrs["data-x"]} w=${attrs["data-w"]}`,
      });
    }
    if (y !== null && h !== null && (y < 0 || y + h > 100.0001)) {
      issues.push({
        code: "overflow_y",
        severity: "error",
        elementId,
        message: `Element overflows vertically: y=${attrs["data-y"]} h=${attrs["data-h"]}`,
      });
    }

    if (type === "text") {
      const font = Number.parseFloat(attrs["data-font"] || "") || parseCssFontSize(attrs.style) || null;
      const minFont = 12;
        if (font !== null && font < minFont) {
          issues.push({
            code: "min_font",
            severity: "error",
            elementId,
            message: `Font too small: ${font}px < ${minFont}px`,
          });
        }

      const fgRaw = attrs["data-color"] || parseCssColor(attrs.style) || "#333333";
      const fgRgb = hexToRgb(fgRaw);
      if (fgRgb && bgRgb) {
        const ratio = contrastRatio(fgRgb, bgRgb);
        if (ratio < 3) {
          issues.push({
            code: "contrast",
            severity: "warn",
            elementId,
            message: `Low contrast: ratio=${ratio.toFixed(2)} fg=${fgRaw} bg=${bgRaw}`,
          });
        }
      }
    }
  }

  const pass = issues.every((i) => i.severity !== "error");
  const violations = issues.map((i) => ({ type: i.code, message: i.message, severity: i.severity, elementId: i.elementId }));
  return { valid: pass, violations, pass, issues };
}

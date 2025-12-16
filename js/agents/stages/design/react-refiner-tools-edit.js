/**
 * ReactRefiner 扩展工具层（Edit 阶段）
 *
 * 追加编辑工具：addSlide/deleteSlide/reorderSlides/diff/revert/saveCheckpoint
 * 所有工具返回统一格式：{success: boolean, data?: any, error?: string}
 */

import { parseSections, joinSections } from "./react-refiner-tools.js";

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function toNonEmptyString(v) {
  if (v === undefined || v === null) return "";
  const s = String(v).trim();
  return s.length ? s : "";
}

function safeIntLike(v) {
  if (typeof v === "number" && Number.isFinite(v)) return Math.floor(v);
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    const n = Number(s);
    if (Number.isFinite(n)) return Math.floor(n);
  }
  return null;
}

function deepClone(value) {
  if (typeof globalThis.structuredClone === "function") return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function escapeAttrValue(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function ensureContextShape(context) {
  if (!isPlainObject(context)) throw new TypeError("Edit tools: context must be an object");
  if (!context.deckPackage || typeof context.deckPackage !== "object") context.deckPackage = {};
  if (!context.contentPackage || typeof context.contentPackage !== "object") context.contentPackage = {};
  context._checkpoints = Array.isArray(context._checkpoints) ? context._checkpoints : [];
}

function getDeckHtmlDsl(context) {
  return typeof context?.deckPackage?.deckHtmlDsl === "string" ? context.deckPackage.deckHtmlDsl : "";
}

function setDeckHtmlDsl(context, deckHtmlDsl) {
  if (!context.deckPackage || typeof context.deckPackage !== "object") context.deckPackage = {};
  context.deckPackage.deckHtmlDsl = typeof deckHtmlDsl === "string" ? deckHtmlDsl : "";
}

function getSlidesMeta(context) {
  return Array.isArray(context?.deckPackage?.slidesMeta) ? context.deckPackage.slidesMeta : [];
}

function setSlidesMeta(context, slidesMeta) {
  if (!context.deckPackage || typeof context.deckPackage !== "object") context.deckPackage = {};
  context.deckPackage.slidesMeta = Array.isArray(slidesMeta) ? slidesMeta : [];
}

function getSlideIntents(context) {
  return Array.isArray(context?.contentPackage?.slideIntents) ? context.contentPackage.slideIntents : [];
}

function setSlideIntents(context, slideIntents) {
  if (!context.contentPackage || typeof context.contentPackage !== "object") context.contentPackage = {};
  context.contentPackage.slideIntents = Array.isArray(slideIntents) ? slideIntents : [];
}

function getImageSlots(context) {
  return Array.isArray(context?.deckPackage?.imageSlots) ? context.deckPackage.imageSlots : [];
}

function setImageSlots(context, imageSlots) {
  if (!context.deckPackage || typeof context.deckPackage !== "object") context.deckPackage = {};
  context.deckPackage.imageSlots = Array.isArray(imageSlots) ? imageSlots : [];
}

function buildSlideIndexError(slideIndex, slideCount) {
  return `Invalid slideIndex: ${String(slideIndex)} (expected 0..${Math.max(0, slideCount - 1)})`;
}

function normalizeSlidesMeta(slidesMeta, slideCount) {
  const out = [];
  const src = Array.isArray(slidesMeta) ? slidesMeta : [];
  for (let i = 0; i < slideCount; i++) {
    const m = isPlainObject(src[i]) ? { ...src[i] } : {};
    m.slideNo = i + 1;
    if (!("degraded" in m)) m.degraded = false;
    if (!("source" in m)) m.source = "refiner";
    out.push(m);
  }
  return out;
}

function buildNewSectionHtml(content) {
  const c = isPlainObject(content) ? content : {};
  const rawHtml = toNonEmptyString(c.html);
  const hasSection = rawHtml && /<section\b/i.test(rawHtml) && /<\/section>/i.test(rawHtml);
  if (hasSection) {
    const m = rawHtml.match(/<section\b[\s\S]*<\/section>/i);
    return (m ? m[0] : rawHtml).trim();
  }

  const attrs = [];
  const title = toNonEmptyString(c.title);
  if (title) attrs.push(`data-title="${escapeAttrValue(title)}"`);
  const bg = toNonEmptyString(c.background);
  if (bg) attrs.push(`data-bg="${escapeAttrValue(bg)}"`);
  const pageType = toNonEmptyString(c.pageType);
  if (pageType) attrs.push(`data-type="${escapeAttrValue(pageType)}"`);

  const inner = rawHtml ? rawHtml : "";
  const attrText = attrs.length ? " " + attrs.join(" ") : "";
  return `<section${attrText}>${inner}</section>`;
}

function parseInsertPosition(position, slideCount) {
  const p = toNonEmptyString(position) || "end";
  if (p === "end") return { ok: true, insertIndex: slideCount };

  const m = p.match(/^(before|after)\s*:\s*(\d+)\s*$/i);
  if (!m) return { ok: false, error: `Invalid position: ${p} (expected 'before:N' | 'after:N' | 'end')` };
  const kind = String(m[1]).toLowerCase();
  const n = safeIntLike(m[2]);
  if (n === null) return { ok: false, error: `Invalid position index in: ${p}` };

  if (kind === "before") {
    if (n < 0 || n > slideCount) return { ok: false, error: `Invalid position index: ${n} (expected 0..${slideCount})` };
    return { ok: true, insertIndex: n };
  }

  // after
  if (slideCount <= 0) return { ok: false, error: "Cannot use 'after:N' when there are no slides" };
  if (n < 0 || n >= slideCount) return { ok: false, error: `Invalid position index: ${n} (expected 0..${Math.max(0, slideCount - 1)})` };
  return { ok: true, insertIndex: n + 1 };
}

function validateNewOrder(newOrder, slideCount) {
  if (!Array.isArray(newOrder)) return { ok: false, error: "newOrder must be an array of integers" };
  if (newOrder.length !== slideCount) return { ok: false, error: `newOrder length must match slide count (${slideCount})` };

  const seen = new Set();
  for (let i = 0; i < newOrder.length; i++) {
    const v = safeIntLike(newOrder[i]);
    if (v === null) return { ok: false, error: `newOrder[${i}] must be an integer` };
    if (v < 0 || v >= slideCount) return { ok: false, error: `newOrder[${i}] out of range: ${v} (expected 0..${Math.max(0, slideCount - 1)})` };
    if (seen.has(v)) return { ok: false, error: `newOrder contains duplicate index: ${v}` };
    seen.add(v);
  }
  if (seen.size !== slideCount) return { ok: false, error: "newOrder must be a permutation of [0..slideCount-1]" };
  return { ok: true };
}

function reorderArray(arr, newOrder, fillValue) {
  const src = Array.isArray(arr) ? arr : [];
  const out = [];
  for (let i = 0; i < newOrder.length; i++) {
    const oldIdx = newOrder[i];
    out.push(oldIdx < src.length ? src[oldIdx] : fillValue);
  }
  return out;
}

function shiftImageSlotsForInsert(imageSlots, insertIndex) {
  const slots = Array.isArray(imageSlots) ? imageSlots : [];
  for (const s of slots) {
    const idx = Number.isFinite(s?.slideIndex) ? s.slideIndex : null;
    if (idx === null) continue;
    if (idx >= insertIndex) s.slideIndex = idx + 1;
  }
  return slots;
}

function shiftImageSlotsForDelete(imageSlots, deletedIndex) {
  const slots = Array.isArray(imageSlots) ? imageSlots : [];
  const out = [];
  for (const s of slots) {
    const idx = Number.isFinite(s?.slideIndex) ? s.slideIndex : null;
    if (idx === null) {
      out.push(s);
      continue;
    }
    if (idx === deletedIndex) continue;
    if (idx > deletedIndex) {
      out.push({ ...s, slideIndex: idx - 1 });
    } else {
      out.push(s);
    }
  }
  return out;
}

function remapImageSlotsForReorder(imageSlots, newOrder) {
  const slots = Array.isArray(imageSlots) ? imageSlots : [];
  const inverse = new Map();
  for (let newIdx = 0; newIdx < newOrder.length; newIdx++) inverse.set(newOrder[newIdx], newIdx);

  for (const s of slots) {
    const idx = Number.isFinite(s?.slideIndex) ? s.slideIndex : null;
    if (idx === null) continue;
    const mapped = inverse.get(idx);
    if (typeof mapped === "number") s.slideIndex = mapped;
  }
  return slots;
}

// 生成 checkpoint ID
function generateCheckpointId() {
  return `ckpt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// 简单文本 diff（行级）
function computeSimpleDiff(oldText, newText) {
  const a = String(oldText ?? "");
  const b = String(newText ?? "");
  if (a === b) return { changed: false, added: 0, removed: 0, prefixLines: 0, suffixLines: 0, addedPreview: [], removedPreview: [] };

  const aLines = a.split(/\r?\n/);
  const bLines = b.split(/\r?\n/);

  let prefix = 0;
  while (prefix < aLines.length && prefix < bLines.length && aLines[prefix] === bLines[prefix]) prefix++;

  let suffix = 0;
  while (
    suffix < aLines.length - prefix &&
    suffix < bLines.length - prefix &&
    aLines[aLines.length - 1 - suffix] === bLines[bLines.length - 1 - suffix]
  ) {
    suffix++;
  }

  const aMid = aLines.slice(prefix, aLines.length - suffix);
  const bMid = bLines.slice(prefix, bLines.length - suffix);

  return {
    changed: true,
    added: bMid.length,
    removed: aMid.length,
    prefixLines: prefix,
    suffixLines: suffix,
    removedPreview: aMid.slice(0, 12),
    addedPreview: bMid.slice(0, 12),
  };
}

function getCheckpointById(context, checkpointId) {
  const id = toNonEmptyString(checkpointId);
  if (!id) return null;
  return (Array.isArray(context?._checkpoints) ? context._checkpoints : []).find((c) => isPlainObject(c) && c.id === id) || null;
}

function snapshotFromRef(context, ref) {
  const r = toNonEmptyString(ref) || "current";
  if (r === "current") {
    const deckHtmlDsl = getDeckHtmlDsl(context);
    const slidesMeta = getSlidesMeta(context);
    return { ok: true, ref: "current", deckHtmlDsl, slidesMeta };
  }
  const ckpt = getCheckpointById(context, r);
  if (!ckpt) return { ok: false, error: `Checkpoint not found: ${r}` };
  return { ok: true, ref: ckpt.id, deckHtmlDsl: String(ckpt.deckHtmlDsl || ""), slidesMeta: Array.isArray(ckpt.slidesMeta) ? ckpt.slidesMeta : [] };
}

// 1. addSlide(position, content) - 添加页面
async function addSlide(context, params) {
  try {
    ensureContextShape(context);

    const deckHtmlDsl = getDeckHtmlDsl(context);
    const sections = parseSections(deckHtmlDsl);
    const slideCount = sections.length;

    const pos = parseInsertPosition(params?.position, slideCount);
    if (!pos.ok) return { success: false, error: `addSlide: ${pos.error}` };

    const sectionHtml = buildNewSectionHtml(params?.content);
    const nextSections = sections.slice();
    nextSections.splice(pos.insertIndex, 0, sectionHtml);
    const nextDeckHtmlDsl = joinSections(nextSections);
    setDeckHtmlDsl(context, nextDeckHtmlDsl);

    // Best-effort: keep metadata arrays aligned.
    const nextSlidesMeta = normalizeSlidesMeta(
      (() => {
        const c = isPlainObject(params?.content) ? params.content : {};
        const meta = getSlidesMeta(context).slice();
        meta.splice(pos.insertIndex, 0, {
          slideNo: pos.insertIndex + 1,
          slideIntentId: null,
          pageType: toNonEmptyString(c.pageType) || undefined,
          title: toNonEmptyString(c.title) || undefined,
          degraded: false,
          source: "refiner_addSlide",
        });
        return meta;
      })(),
      nextSections.length
    );
    setSlidesMeta(context, nextSlidesMeta);

    const intents = getSlideIntents(context);
    if (intents.length) {
      const c = isPlainObject(params?.content) ? params.content : {};
      const nextIntents = intents.slice();
      nextIntents.splice(pos.insertIndex, 0, {
        slideIntentId: null,
        pageType: toNonEmptyString(c.pageType) || undefined,
        title: toNonEmptyString(c.title) || undefined,
        keyPoints: [],
        claimIds: [],
      });
      setSlideIntents(context, nextIntents);
    }

    const slots = getImageSlots(context);
    if (slots.length) setImageSlots(context, shiftImageSlotsForInsert(slots, pos.insertIndex));

    return {
      success: true,
      data: {
        insertIndex: pos.insertIndex,
        slideCount: nextSections.length,
        insertedSectionHtml: sectionHtml,
        deckPackage: { ...(context.deckPackage || {}), deckHtmlDsl: nextDeckHtmlDsl, slidesMeta: getSlidesMeta(context) },
      },
    };
  } catch (err) {
    return { success: false, error: `addSlide failed: ${err.message}` };
  }
}

// 2. deleteSlide(slideIndex) - 删除页面
async function deleteSlide(context, params) {
  try {
    ensureContextShape(context);

    const slideIndex = safeIntLike(params?.slideIndex);
    if (slideIndex === null) return { success: false, error: "deleteSlide: slideIndex must be an integer" };

    const deckHtmlDsl = getDeckHtmlDsl(context);
    const sections = parseSections(deckHtmlDsl);
    if (!sections.length) return { success: false, error: "deleteSlide: deckHtmlDsl contains no <section> slides" };
    if (slideIndex < 0 || slideIndex >= sections.length) return { success: false, error: `deleteSlide: ${buildSlideIndexError(slideIndex, sections.length)}` };

    const removedSectionHtml = sections[slideIndex];
    const nextSections = sections.slice();
    nextSections.splice(slideIndex, 1);
    const nextDeckHtmlDsl = joinSections(nextSections);
    setDeckHtmlDsl(context, nextDeckHtmlDsl);

    const nextSlidesMeta = normalizeSlidesMeta(
      (() => {
        const meta = getSlidesMeta(context).slice();
        if (slideIndex < meta.length) meta.splice(slideIndex, 1);
        return meta;
      })(),
      nextSections.length
    );
    setSlidesMeta(context, nextSlidesMeta);

    const intents = getSlideIntents(context);
    if (intents.length) {
      const nextIntents = intents.slice();
      if (slideIndex < nextIntents.length) nextIntents.splice(slideIndex, 1);
      setSlideIntents(context, nextIntents);
    }

    const slots = getImageSlots(context);
    if (slots.length) setImageSlots(context, shiftImageSlotsForDelete(slots, slideIndex));

    return {
      success: true,
      data: {
        slideIndex,
        removedSectionHtml,
        slideCount: nextSections.length,
        deckPackage: { ...(context.deckPackage || {}), deckHtmlDsl: nextDeckHtmlDsl, slidesMeta: getSlidesMeta(context) },
      },
    };
  } catch (err) {
    return { success: false, error: `deleteSlide failed: ${err.message}` };
  }
}

// 3. reorderSlides(newOrder) - 重新排序
async function reorderSlides(context, params) {
  try {
    ensureContextShape(context);

    const deckHtmlDsl = getDeckHtmlDsl(context);
    const sections = parseSections(deckHtmlDsl);
    if (!sections.length) return { success: false, error: "reorderSlides: deckHtmlDsl contains no <section> slides" };

    const slideCount = sections.length;
    const order = Array.isArray(params?.newOrder) ? params.newOrder : null;
    const v = validateNewOrder(order, slideCount);
    if (!v.ok) return { success: false, error: `reorderSlides: ${v.error}` };

    const nextSections = reorderArray(sections, order, "");
    const nextDeckHtmlDsl = joinSections(nextSections);
    setDeckHtmlDsl(context, nextDeckHtmlDsl);

    const nextSlidesMeta = normalizeSlidesMeta(reorderArray(getSlidesMeta(context), order, {}), slideCount);
    setSlidesMeta(context, nextSlidesMeta);

    const intents = getSlideIntents(context);
    if (intents.length) setSlideIntents(context, reorderArray(intents, order, null));

    const slots = getImageSlots(context);
    if (slots.length) setImageSlots(context, remapImageSlotsForReorder(slots, order));

    return {
      success: true,
      data: {
        slideCount,
        newOrder: order.slice(),
        deckPackage: { ...(context.deckPackage || {}), deckHtmlDsl: nextDeckHtmlDsl, slidesMeta: getSlidesMeta(context) },
      },
    };
  } catch (err) {
    return { success: false, error: `reorderSlides failed: ${err.message}` };
  }
}

// 4. diff(from, to) - 对比版本
async function diff(context, params) {
  try {
    ensureContextShape(context);

    const fromRef = snapshotFromRef(context, params?.from);
    if (!fromRef.ok) return { success: false, error: `diff: ${fromRef.error}` };

    const toRef = snapshotFromRef(context, params?.to);
    if (!toRef.ok) return { success: false, error: `diff: ${toRef.error}` };

    const fromSlides = parseSections(fromRef.deckHtmlDsl);
    const toSlides = parseSections(toRef.deckHtmlDsl);

    const deckDiff = computeSimpleDiff(fromRef.deckHtmlDsl, toRef.deckHtmlDsl);
    const fromMetaJson = JSON.stringify(Array.isArray(fromRef.slidesMeta) ? fromRef.slidesMeta : [], null, 2);
    const toMetaJson = JSON.stringify(Array.isArray(toRef.slidesMeta) ? toRef.slidesMeta : [], null, 2);
    const metaDiff = computeSimpleDiff(fromMetaJson, toMetaJson);

    const summary = {
      from: fromRef.ref,
      to: toRef.ref,
      slideCount: { from: fromSlides.length, to: toSlides.length },
      deckHtmlDsl: { addedLines: deckDiff.added, removedLines: deckDiff.removed, changed: deckDiff.changed },
      slidesMeta: { addedLines: metaDiff.added, removedLines: metaDiff.removed, changed: metaDiff.changed },
    };

    return {
      success: true,
      data: {
        summary,
        deckHtmlDsl: deckDiff,
        slidesMeta: metaDiff,
      },
    };
  } catch (err) {
    return { success: false, error: `diff failed: ${err.message}` };
  }
}

// 5. revert(checkpointId) - 回滚版本
async function revert(context, params) {
  try {
    ensureContextShape(context);

    const checkpointId = toNonEmptyString(params?.checkpointId);
    if (!checkpointId) return { success: false, error: "revert: checkpointId is required" };

    const ckpt = getCheckpointById(context, checkpointId);
    if (!ckpt) return { success: false, error: `revert: checkpoint not found: ${checkpointId}` };

    setDeckHtmlDsl(context, String(ckpt.deckHtmlDsl || ""));
    setSlidesMeta(context, deepClone(Array.isArray(ckpt.slidesMeta) ? ckpt.slidesMeta : []));

    return {
      success: true,
      data: {
        checkpointId: ckpt.id,
        label: ckpt.label,
        timestamp: ckpt.timestamp,
        deckPackage: { ...(context.deckPackage || {}) },
      },
    };
  } catch (err) {
    return { success: false, error: `revert failed: ${err.message}` };
  }
}

// 6. saveCheckpoint(label) - 保存检查点
async function saveCheckpoint(context, params) {
  try {
    ensureContextShape(context);

    const id = generateCheckpointId();
    const label = toNonEmptyString(params?.label) || "";
    const timestamp = Date.now();

    const deckHtmlDsl = getDeckHtmlDsl(context);
    const slidesMeta = deepClone(getSlidesMeta(context));

    const ckpt = { id, label, timestamp, deckHtmlDsl, slidesMeta };
    context._checkpoints.push(ckpt);
    while (context._checkpoints.length > 10) context._checkpoints.shift();

    return {
      success: true,
      data: {
        checkpointId: id,
        checkpoint: ckpt,
        checkpointCount: context._checkpoints.length,
      },
    };
  } catch (err) {
    return { success: false, error: `saveCheckpoint failed: ${err.message}` };
  }
}

export const EDIT_TOOLS = ["addSlide", "deleteSlide", "reorderSlides", "diff", "revert", "saveCheckpoint"];

const EDIT_HANDLERS = {
  addSlide,
  deleteSlide,
  reorderSlides,
  diff,
  revert,
  saveCheckpoint,
};

// 工具 Schema 扩展
export const EDIT_TOOL_SCHEMAS = {
  addSlide: { params: ["position", "content?"], description: "Add a new <section> slide at position ('before:N' | 'after:N' | 'end')." },
  deleteSlide: { params: ["slideIndex"], description: "Delete a <section> slide by slideIndex (0-based) and update slidesMeta." },
  reorderSlides: { params: ["newOrder"], description: "Reorder slides by providing a permutation array of old indices (length must match slide count)." },
  diff: { params: ["from", "to"], description: "Compare two versions ('current' or checkpointId) and return a simple line-level diff summary." },
  revert: { params: ["checkpointId"], description: "Restore deckHtmlDsl and slidesMeta to a saved checkpoint." },
  saveCheckpoint: { params: ["label?"], description: "Save current deckHtmlDsl and slidesMeta into a checkpoint (max 10 kept, FIFO)." },
};

export function createEditToolExecutor(context, baseExecutor) {
  ensureContextShape(context);
  if (typeof baseExecutor !== "function") {
    throw new TypeError("createEditToolExecutor(context, baseExecutor): baseExecutor must be a function");
  }

  return async (toolName, params) => {
    const name = toNonEmptyString(toolName);
    if (!name) return { success: false, error: "Tool name is required" };

    if (EDIT_TOOLS.includes(name)) {
      const handler = EDIT_HANDLERS[name];
      if (!handler) return { success: false, error: `Unknown edit tool: ${name}` };
      try {
        return await handler(context, params || {});
      } catch (err) {
        return { success: false, error: `Tool execution failed: ${err.message}` };
      }
    }

    return baseExecutor(name, params || {});
  };
}

export { generateCheckpointId, computeSimpleDiff };


import { buildPrompt } from "../image/image-prompt-builder.js";
import { EventStatus, ImageTaskStatus, SlotSelectionStatus, VisualDataStatus } from "../constants.js";
import { DesignEvents } from "../../../runtime/events/events.js";
import { makeSecureTimestampedId } from "../../../shared/utils/secure-id.js";

import { nowMs, toNonEmptyString, escapeHtml as escapeAttr } from "../shared/design-utils.js";
import { parseTagAttributes } from "../shared/html-parser.js";
import { safeEmit } from "../shared/safe-emit.js";

function safeNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeBudget(budget = {}) {
  return {
    maxImages: Math.max(0, safeNumber(budget.maxImages, 5)),
    maxCostUSD: Math.max(0, safeNumber(budget.maxCostUSD, 1.0)),
    maxRetries: Math.max(0, safeNumber(budget.maxRetries, 2)),
    timeoutMs: Math.max(1, safeNumber(budget.timeoutMs, 30_000)),
    candidatesPerSlot: Math.max(1, safeNumber(budget.candidatesPerSlot, 1)),
  };
}

function priorityRank(priority) {
  if (priority === "critical") return 0;
  if (priority === "important") return 1;
  return 2;
}

function makeTimeoutError(message, { timeoutMs } = {}) {
  const err = new Error(message || "Network timeout");
  err.name = "TimeoutError";
  err.code = "ETIMEDOUT";
  if (typeof timeoutMs === "number") err.timeoutMs = timeoutMs;
  return err;
}

async function withTimeout(promise, timeoutMs) {
  const ms = Math.max(1, safeNumber(timeoutMs, 30_000));
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(makeTimeoutError(`Timed out after ${ms}ms`, { timeoutMs: ms })), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function normalizeImageSrc(result) {
  const url = toNonEmptyString(result?.url);
  if (url) return url;
  const base64 = toNonEmptyString(result?.base64);
  if (!base64) return "";
  const mimeType = toNonEmptyString(result?.mimeType) || "image/png";
  return `data:${mimeType};base64,${base64}`;
}

function candidateIndexFromTaskId(taskId) {
  const s = String(taskId || "");
  const m = s.match(/:c(\d+)\s*$/);
  if (!m) return 0;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n - 1;
}

function estimateCostUSDForProvider(providerName, { model } = {}) {
  const p = String(providerName || "").toLowerCase();
  const m = String(model || "").toLowerCase();

  if (p.includes("openai")) {
    // Approximation; DALL-E 3 standard ~ $0.04, hd ~ $0.08.
    if (m.includes("hd")) return 0.08;
    return 0.04;
  }

  // Gemini and local/self-hosted providers default to "free/unknown" cost.
  return 0.0;
}

async function callImageService(provider, request, opts) {
  if (!provider) throw new Error("ImageGenerator: image provider is not configured");
  if (typeof provider.generate === "function") return provider.generate(request, opts);
  if (typeof provider.generateImage === "function") return provider.generateImage(request, opts);
  if (typeof provider === "function") return provider(request, opts);
  throw new Error("ImageGenerator: invalid image provider (expected .generate/.generateImage/function)");
}

function cloneSlot(slot) {
  const out = { ...(slot || {}) };
  if (Array.isArray(slot?.claimIds)) out.claimIds = slot.claimIds.slice();
  if (Array.isArray(slot?.candidates)) out.candidates = slot.candidates.map((c) => ({ ...(c || {}) }));
  return out;
}

function computeSummary(slots, tasks) {
  const attempted = tasks.filter((t) => t.status === ImageTaskStatus.SUCCESS || t.status === ImageTaskStatus.FAILED).length;
  const succeeded = tasks.filter((t) => t.status === ImageTaskStatus.SUCCESS).length;
  const failed = tasks.filter((t) => t.status === ImageTaskStatus.FAILED).length;
  const skipped = tasks.filter((t) => t.status === ImageTaskStatus.SKIPPED).length;
  const totalCostUSD = tasks.reduce((sum, t) => sum + (Number.isFinite(t.costUSD) ? t.costUSD : 0), 0);
  const totalDurationMs = tasks.reduce((sum, t) => sum + (Number.isFinite(t.durationMs) ? t.durationMs : 0), 0);

  return {
    planned: slots.length,
    attempted,
    succeeded,
    failed,
    skipped,
    totalCostUSD: Number(totalCostUSD.toFixed(6)),
    totalDurationMs: Math.floor(totalDurationMs),
  };
}

export class ImageGenerator {
  constructor(opts = {}) {
    this.provider = opts.imageProvider || opts.stageApi?.imageService;
    this.budget = normalizeBudget(opts.budget || { maxImages: 5, maxCostUSD: 1.0, maxRetries: 2, timeoutMs: 30000, candidatesPerSlot: 1 });
    this.concurrency = Math.max(1, safeNumber(opts.concurrency, 2));
  }

  async generate(imageSlots, contentPackage, designSystem, opts = {}) {
    const emit = typeof opts.emit === "function" ? opts.emit : null;
    const runId = toNonEmptyString(opts.runId) || toNonEmptyString(contentPackage?.runId) || makeSecureTimestampedId("run");
    const policy =
      toNonEmptyString(opts.policy) ||
      toNonEmptyString(contentPackage?.constraints?.imagePolicy) ||
      "balanced";

    const budget = normalizeBudget({ ...this.budget, ...(opts.budget || {}) });
    const concurrency = Math.max(1, safeNumber(opts.concurrency, this.concurrency));
    const provider = opts.imageProvider || this.provider;

    const slots = Array.isArray(imageSlots) ? imageSlots.map(cloneSlot) : [];
    const bySlotId = new Map(slots.map((s) => [String(s?.slotId || ""), s]));

    const tasks = [];
    for (const slot of slots) {
      const slotId = String(slot?.slotId || "").trim();
      if (!slotId) continue;

      const prompt = buildPrompt(slot, designSystem, contentPackage);
      const providerName = toNonEmptyString(provider?.provider) || toNonEmptyString(provider?.id) || toNonEmptyString(opts.provider) || "unknown";
      const model = toNonEmptyString(provider?.model) || toNonEmptyString(opts.model) || "unknown";

      const count = Math.max(1, safeNumber(budget.candidatesPerSlot, 1));
      for (let i = 0; i < count; i++) {
        tasks.push({
          taskId: `${runId}:${slotId}:c${i + 1}`,
          slotId,
          prompt,
          provider: providerName,
          model,
          status: ImageTaskStatus.PENDING,
          retryCount: 0,
          result: null,
          error: null,
          costUSD: 0,
          durationMs: 0,
        });
      }
    }

    tasks.sort((a, b) => {
      const sa = bySlotId.get(a.slotId) || {};
      const sb = bySlotId.get(b.slotId) || {};
      const pr = priorityRank(sa.priority) - priorityRank(sb.priority);
      if (pr !== 0) return pr;
      const si = safeNumber(sa.slideIndex, 0) - safeNumber(sb.slideIndex, 0);
      if (si !== 0) return si;
      return String(a.taskId).localeCompare(String(b.taskId));
    });

    const budgetState = {
      startedImages: 0,
      spentCostUSD: 0,
    };

    const reserveForFirstAttempt = (estimatedCostUSD) => {
      if (budgetState.startedImages >= budget.maxImages) return { ok: false, reason: "maxImages" };
      if (budgetState.spentCostUSD + estimatedCostUSD > budget.maxCostUSD) return { ok: false, reason: "maxCostUSD" };
      budgetState.startedImages += 1;
      budgetState.spentCostUSD += estimatedCostUSD;
      return { ok: true };
    };

    const reserveForRetryAttempt = (estimatedCostUSD) => {
      if (budgetState.spentCostUSD + estimatedCostUSD > budget.maxCostUSD) return { ok: false, reason: "maxCostUSD" };
      budgetState.spentCostUSD += estimatedCostUSD;
      return { ok: true };
    };

    const runTask = async (task) => {
      const slot = bySlotId.get(task.slotId) || {};
      const timeoutMs = Math.max(1, safeNumber(opts.timeoutMs, budget.timeoutMs));

      const estimatedCostUSD =
        typeof opts.estimateCostUSD === "function"
          ? Math.max(0, safeNumber(opts.estimateCostUSD(task, slot, budget), 0))
          : estimateCostUSDForProvider(task.provider, { model: task.model });

      const canStart = reserveForFirstAttempt(estimatedCostUSD);
      if (!canStart.ok) {
        task.status = ImageTaskStatus.SKIPPED;
        task.error = canStart.reason === "maxImages" ? "Skipped: maxImages budget reached" : "Skipped: maxCostUSD budget reached";
        safeEmit(emit, DesignEvents.IMAGE_GENERATE_SKIPPED, EventStatus.SKIPPED, {
          runId,
          slotId: task.slotId,
          slideIndex: Number.isFinite(slot?.slideIndex) ? slot.slideIndex : null,
          slideIntentId: toNonEmptyString(slot?.slideIntentId) || null,
          purpose: toNonEmptyString(slot?.purpose) || null,
          taskId: task.taskId,
          reason: canStart.reason,
        });
        return;
      }

      safeEmit(emit, DesignEvents.IMAGE_GENERATE_STARTED, EventStatus.STARTED, {
        runId,
        slotId: task.slotId,
        slideIndex: Number.isFinite(slot?.slideIndex) ? slot.slideIndex : null,
        slideIntentId: toNonEmptyString(slot?.slideIntentId) || null,
        purpose: toNonEmptyString(slot?.purpose) || null,
        taskId: task.taskId,
        priority: slot?.priority,
      });

      task.status = ImageTaskStatus.RUNNING;

      let totalDuration = 0;
      let totalCost = estimatedCostUSD;

      const maxRetries = Math.max(0, safeNumber(opts.maxRetries, budget.maxRetries));
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0) {
          const ok = reserveForRetryAttempt(estimatedCostUSD);
          if (!ok.ok) {
            task.retryCount = attempt - 1;
            task.status = ImageTaskStatus.FAILED;
            task.error = "Failed: budget exhausted during retries";
            task.costUSD = Number(totalCost.toFixed(6));
            task.durationMs = Math.floor(totalDuration);
            safeEmit(emit, DesignEvents.IMAGE_GENERATE_FAILED, EventStatus.FAILED, {
              runId,
              slotId: task.slotId,
              slideIndex: Number.isFinite(slot?.slideIndex) ? slot.slideIndex : null,
              slideIntentId: toNonEmptyString(slot?.slideIntentId) || null,
              purpose: toNonEmptyString(slot?.purpose) || null,
              taskId: task.taskId,
              retryCount: task.retryCount,
              error: task.error,
            });
            return;
          }
          totalCost += estimatedCostUSD;
          task.retryCount = attempt;
        }

        const t0 = nowMs();
        try {
          const result = await withTimeout(
            callImageService(
              provider,
              {
                prompt: task.prompt,
                aspectRatio: toNonEmptyString(slot?.aspectRatio) || "16:9",
              },
              { timeoutMs }
            ),
            timeoutMs
          );

          const t1 = nowMs();
          totalDuration += t1 - t0;
          task.status = ImageTaskStatus.SUCCESS;
          task.durationMs = Math.floor(totalDuration);
          task.costUSD = Number(totalCost.toFixed(6));

          const candidateIndex = candidateIndexFromTaskId(task.taskId);
          const candidateId = `${task.slotId}_c${candidateIndex + 1}`;
          const src = normalizeImageSrc(result);

          task.result = {
            candidateId,
            index: candidateIndex,
            url: toNonEmptyString(result?.url) || null,
            base64: toNonEmptyString(result?.base64) || null,
            mimeType: toNonEmptyString(result?.mimeType) || "image/png",
            width: Number.isFinite(result?.width) ? result.width : null,
            height: Number.isFinite(result?.height) ? result.height : null,
            src: src || null,
          };

          if (!Array.isArray(slot.candidates)) slot.candidates = [];
          slot.candidates.push({
            candidateId,
            slotId: task.slotId,
            index: candidateIndex,
            url: src,
            prompt: task.prompt,
            provider: toNonEmptyString(result?.provider) || task.provider,
            model: toNonEmptyString(result?.model) || task.model,
            costUSD: task.costUSD,
            durationMs: Math.floor(totalDuration),
            metadata: {
              mimeType: task.result.mimeType,
              width: task.result.width,
              height: task.result.height,
            },
          });

          if (!toNonEmptyString(slot.selectedId)) {
            slot.selectedId = candidateId;
            slot.selectionStatus = SlotSelectionStatus.AUTO_SELECTED;
          }

          safeEmit(emit, DesignEvents.IMAGE_GENERATE_SUCCEEDED, EventStatus.SUCCEEDED, {
            runId,
            slotId: task.slotId,
            slideIndex: Number.isFinite(slot?.slideIndex) ? slot.slideIndex : null,
            slideIntentId: toNonEmptyString(slot?.slideIntentId) || null,
            purpose: toNonEmptyString(slot?.purpose) || null,
            taskId: task.taskId,
            retryCount: task.retryCount,
            costUSD: task.costUSD,
            durationMs: task.durationMs,
          });
          return;
        } catch (e) {
          const t1 = nowMs();
          totalDuration += t1 - t0;
          const msg = e instanceof Error ? e.message : String(e);
          task.error = msg;

          if (attempt >= maxRetries) {
            task.status = ImageTaskStatus.FAILED;
            task.durationMs = Math.floor(totalDuration);
            task.costUSD = Number(totalCost.toFixed(6));
            safeEmit(emit, DesignEvents.IMAGE_GENERATE_FAILED, EventStatus.FAILED, {
              runId,
              slotId: task.slotId,
              slideIndex: Number.isFinite(slot?.slideIndex) ? slot.slideIndex : null,
              slideIntentId: toNonEmptyString(slot?.slideIntentId) || null,
              purpose: toNonEmptyString(slot?.purpose) || null,
              taskId: task.taskId,
              retryCount: task.retryCount,
              error: task.error,
            });
            return;
          }
        }
      }
    };

    const workers = [];
    let cursor = 0;
    const workerCount = Math.max(1, concurrency);

    for (let i = 0; i < workerCount; i++) {
      workers.push(
        (async () => {
          while (true) {
            const idx = cursor;
            cursor += 1;
            if (idx >= tasks.length) return;
            const task = tasks[idx];
            try {
              await runTask(task);
            } catch (e) {
              task.status = task.status === ImageTaskStatus.SKIPPED ? task.status : ImageTaskStatus.FAILED;
              task.error = task.error || (e instanceof Error ? e.message : String(e));
              const slot = bySlotId.get(task.slotId) || {};
              safeEmit(emit, DesignEvents.IMAGE_GENERATE_FAILED, EventStatus.FAILED, {
                runId,
                slotId: task.slotId,
                slideIndex: Number.isFinite(slot?.slideIndex) ? slot.slideIndex : null,
                slideIntentId: toNonEmptyString(slot?.slideIntentId) || null,
                purpose: toNonEmptyString(slot?.purpose) || null,
                taskId: task.taskId,
                retryCount: task.retryCount,
                error: task.error,
              });
            }
          }
        })()
      );
    }

    await Promise.all(workers);

    const report = {
      schemaVersion: "0.1",
      runId,
      policy,
      budget,
      slots,
      tasks,
      summary: computeSummary(slots, tasks),
    };

    safeEmit(emit, DesignEvents.IMAGE_FILL_COMPLETED, EventStatus.COMPLETED, {
      runId,
      report,
    });

    return { filledSlots: slots, report };
  }
}

export function createImageGenerator(opts) {
  return new ImageGenerator(opts);
}

export async function generateImages(imageSlots, contentPackage, designSystem, opts = {}) {
  const generator = new ImageGenerator(opts);
  return generator.generate(imageSlots, contentPackage, designSystem, opts);
}

// escapeAttr is now imported from design-utils as escapeAttr

function chooseSelectedCandidate(slot) {
  const candidates = Array.isArray(slot?.candidates) ? slot.candidates : [];
  const selectedId = toNonEmptyString(slot?.selectedId);
  if (selectedId) {
    const found = candidates.find((c) => String(c?.candidateId) === selectedId);
    if (found) return found;
  }
  return candidates[0] || null;
}

/**
 * Replace `<div data-el="image-placeholder" ...>` with `<img data-el="image" ...>` for selected candidates.
 * Pure string patch (Node-friendly; no DOM required).
 *
 * @param {string} deckHtmlDsl
 * @param {Array<object>} filledSlots slots returned by ImageGenerator.generate()
 * @returns {{deckHtmlDsl:string, filledSlotIds:string[], skippedSlotIds:string[]}}
 */
export function fillImagePlaceholders(deckHtmlDsl, filledSlots = []) {
  const html = typeof deckHtmlDsl === "string" ? deckHtmlDsl : "";
  const slots = Array.isArray(filledSlots) ? filledSlots : [];
  if (!html || slots.length === 0) return { deckHtmlDsl: html, filledSlotIds: [], skippedSlotIds: [] };

  const filledSlotIds = [];
  const skippedSlotIds = [];

  const isWs = (c) => c === " " || c === "\n" || c === "\r" || c === "\t" || c === "\f";
  const findTagEnd = (s, start) => {
    let quote = null;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (quote) {
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }
      if (ch === ">") return i;
    }
    return -1;
  };
  const findMatchingDivClose = (s, start) => {
    let depth = 1;
    let pos = start;
    while (pos < s.length) {
      const lt = s.indexOf("<", pos);
      if (lt === -1) return null;
      if (s.startsWith("<!--", lt)) {
        const end = s.indexOf("-->", lt + 4);
        pos = end === -1 ? s.length : end + 3;
        continue;
      }
      const next = s[lt + 1];
      // </div ...>
      if (next === "/" && s.slice(lt + 2, lt + 5).toLowerCase() === "div") {
        const tagEnd = findTagEnd(s, lt + 2);
        if (tagEnd === -1) return null;
        depth--;
        const closeStart = lt;
        const closeEnd = tagEnd + 1;
        pos = closeEnd;
        if (depth === 0) return { closeStart, closeEnd };
        continue;
      }
      // <div ...>
      if (s.slice(lt + 1, lt + 4).toLowerCase() === "div") {
        const tagEnd = findTagEnd(s, lt + 4);
        if (tagEnd === -1) return null;
        let k = tagEnd - 1;
        while (k > lt && isWs(s[k])) k--;
        const isSelfClosing = s[k] === "/";
        if (!isSelfClosing) depth++;
        pos = tagEnd + 1;
        continue;
      }
      pos = lt + 1;
    }
    return null;
  };
  const findImagePlaceholders = (s) => {
    const results = [];
    let pos = 0;
    while (pos < s.length) {
      const divStart = s.indexOf("<div", pos);
      if (divStart === -1) break;
      const tagEnd = findTagEnd(s, divStart + 4);
      if (tagEnd === -1) break;
      const openTag = s.slice(divStart, tagEnd + 1);
      const attrs = parseTagAttributes(openTag);
      if (String(attrs["data-el"] || "").toLowerCase() !== "image-placeholder") {
        pos = tagEnd + 1;
        continue;
      }

      let k = tagEnd - 1;
      while (k > divStart && isWs(s[k])) k--;
      const isSelfClosing = s[k] === "/";
      if (isSelfClosing) {
        const end = tagEnd + 1;
        results.push({ start: divStart, end, openTag, inner: "", isSelfClosing: true });
        pos = end;
        continue;
      }

      const close = findMatchingDivClose(s, tagEnd + 1);
      if (!close) {
        pos = tagEnd + 1;
        continue;
      }
      results.push({ start: divStart, end: close.closeEnd, openTag, inner: s.slice(tagEnd + 1, close.closeStart), isSelfClosing: false });
      pos = close.closeEnd;
    }
    return results;
  };

  const bySlotId = new Map();
  for (const slot of slots) {
    const slotId = toNonEmptyString(slot?.slotId);
    if (!slotId) continue;
    const chosen = chooseSelectedCandidate(slot);
    const src = toNonEmptyString(chosen?.url) || toNonEmptyString(chosen?.src) || "";
    if (!src) {
      skippedSlotIds.push(slotId);
      continue;
    }
    bySlotId.set(slotId, { src });
  }
  if (bySlotId.size === 0) return { deckHtmlDsl: html, filledSlotIds: [], skippedSlotIds };

  const placeholders = findImagePlaceholders(html);
  let finalOut = html;
  for (let i = placeholders.length - 1; i >= 0; i--) {
    const { start, end, openTag } = placeholders[i];
    const attrs = parseTagAttributes(openTag);
    const slotId = toNonEmptyString(attrs["data-slot-id"]) || toNonEmptyString(attrs.id);
    if (!slotId || !bySlotId.has(slotId)) continue;

    const { src } = bySlotId.get(slotId);
    filledSlotIds.push(slotId);

    const imgAttrs = { ...attrs };
    imgAttrs["data-el"] = "image";
    imgAttrs["data-status"] = VisualDataStatus.FILLED;
    delete imgAttrs["data-fallback"];
    delete imgAttrs["data-aspect-ratio"];

    imgAttrs["data-src"] = src;
    imgAttrs.src = src;
    if (!toNonEmptyString(imgAttrs.alt)) imgAttrs.alt = "Generated image";
    if (!toNonEmptyString(imgAttrs["data-fit"])) imgAttrs["data-fit"] = "cover";

    const attrPairs = Object.entries(imgAttrs).map(([k, v]) => `${k}="${escapeAttr(v)}"`);
    const replacement = `<img ${attrPairs.join(" ")} />`;
    finalOut = finalOut.slice(0, start) + replacement + finalOut.slice(end);
  }

  // De-dup in case both regexes matched the same slot in weird HTML.
  const uniqFilled = [...new Set(filledSlotIds)];
  return { deckHtmlDsl: finalOut, filledSlotIds: uniqFilled, skippedSlotIds: [...new Set(skippedSlotIds)] };
}

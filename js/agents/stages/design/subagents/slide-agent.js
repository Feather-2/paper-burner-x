import { generateSingleSlide } from "../generators/batch-generator.js";
import { getDslRules } from "../dsl/dsl-rules.js";
import { SlideStatus, VisualSlotStatus, slideStatusMachine } from "../states.js";
import { normalizeRenderType } from "../../../shared/utils/value-utils.js";
import { safeJsonParse } from "../../../shared/utils/safe-json.js";

const MAX_LINKED_FILE_CHARS = 1200;
const isBrowser = typeof window !== "undefined" && typeof window.document !== "undefined";
let fsPromises = null;
let pathModule = null;

async function ensureNodeModules() {
  if (fsPromises && pathModule) return true;
  if (isBrowser) return false;
  try {
    const fsMod = await import("node:fs");
    const pathMod = await import("node:path");
    fsPromises = fsMod.promises || (fsMod.default && fsMod.default.promises) || fsMod;
    pathModule = pathMod.default || pathMod;
    return true;
  } catch {
    return false;
  }
}

function toNonEmptyString(value) {
  if (value === undefined || value === null) return "";
  const s = String(value).trim();
  return s.length ? s : "";
}

function parseTagAttributes(tag) {
  const attrs = {};
  const re = /\b([a-zA-Z0-9_:-]+)\s*=\s*(["'])(.*?)\2/g;
  let m;
  while ((m = re.exec(tag))) attrs[m[1]] = m[3];
  return attrs;
}

async function readLinkedFiles(linkedFiles = []) {
  const files = Array.isArray(linkedFiles) ? linkedFiles : [];
  const sections = [];

  if (!files.length) return "";
  const ready = await ensureNodeModules();
  if (!ready || !fsPromises?.readFile) return "";

  for (const filePath of files) {
    const file = toNonEmptyString(filePath);
    if (!file) continue;
    try {
      const raw = await fsPromises.readFile(file, "utf8");
      const trimmed = raw.length > MAX_LINKED_FILE_CHARS
        ? `${raw.slice(0, MAX_LINKED_FILE_CHARS)}\n...(truncated)`
        : raw;
      const label = typeof pathModule?.basename === "function"
        ? pathModule.basename(file)
        : (file.split(/[/\\]/).pop() || file);
      sections.push(`--- ${label} ---\n${trimmed}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sections.push(`--- ${file} ---\n[read failed: ${msg}]`);
    }
  }

  return sections.length ? sections.join("\n\n") : "";
}

function describeAsset(asset) {
  const parts = [];
  const type = toNonEmptyString(asset?.type);
  const source = toNonEmptyString(asset?.source);
  const context = toNonEmptyString(asset?.context) || toNonEmptyString(asset?.description);
  if (context) parts.push(context);
  if (type) parts.push(type);
  if (source) parts.push(`source:${source}`);
  if (Array.isArray(asset?.tags) && asset.tags.length) {
    parts.push(`tags:${asset.tags.join(", ")}`);
  }
  return parts.join("; ") || "asset";
}

async function buildSupplementalMarkdown(slideIntent, assetRegistry) {
  const parts = [];
  const userNotes = toNonEmptyString(slideIntent?.userNotes);
  if (userNotes) parts.push(`User notes: ${userNotes}`);

  const linkedAssets = Array.isArray(slideIntent?.linkedAssets) ? slideIntent.linkedAssets : [];
  if (linkedAssets.length && assetRegistry) {
    const assetLines = linkedAssets.map((assetId) => {
      const id = toNonEmptyString(assetId);
      if (!id) return "";
      const asset = assetRegistry.getAsset?.(id);
      const desc = asset ? describeAsset(asset) : "asset";
      return `- ${id}: ${desc}`;
    }).filter(Boolean);
    if (assetLines.length) parts.push(`Linked assets:\n${assetLines.join("\n")}`);
  }

  const linkedFiles = await readLinkedFiles(slideIntent?.linkedFiles);
  if (linkedFiles) parts.push(`Linked files:\n${linkedFiles}`);

  return parts.join("\n\n");
}

function withSupplementalContent(slideIntent, supplementalMarkdown) {
  if (!supplementalMarkdown) return slideIntent;
  const enriched = { ...(slideIntent || {}) };
  const content = enriched.content;

  if (typeof content === "string") {
    enriched.content = `${content}\n\n${supplementalMarkdown}`;
    return enriched;
  }

  if (content && typeof content === "object") {
    const markdown = typeof content.markdown === "string" ? content.markdown : "";
    enriched.content = { ...content, markdown: markdown ? `${markdown}\n\n${supplementalMarkdown}` : supplementalMarkdown };
    return enriched;
  }

  enriched.content = { markdown: supplementalMarkdown };
  return enriched;
}

function extractVisualSlotsFromHtml(html, { slideIntentId, slideIndex }) {
  const input = typeof html === "string" ? html : "";
  if (!input) return [];

  const slots = [];
  const seen = new Set();
  // ReDoS-safe: 使用迭代字符串解析替代 [^>]* 正则
  let pos = 0;
  while (pos < input.length) {
    const divStart = input.toLowerCase().indexOf("<div", pos);
    if (divStart === -1) break;
    const tagEnd = input.indexOf(">", divStart);
    if (tagEnd === -1) break;
    const tag = input.slice(divStart, tagEnd + 1);
    const tagLower = tag.toLowerCase();
    pos = tagEnd + 1;
    if (!tagLower.includes('data-el="image-placeholder"') && !tagLower.includes("data-el='image-placeholder'")) continue;

    const attrs = parseTagAttributes(tag);
    const slotId = toNonEmptyString(attrs["data-slot-id"]) || toNonEmptyString(attrs.id);
    if (!slotId || seen.has(slotId)) continue;
    seen.add(slotId);

    const renderTypeRaw = toNonEmptyString(attrs["data-render-type"]);
    const renderType = renderTypeRaw ? normalizeRenderType(renderTypeRaw) : "ai-image";

    const position = {};
    if (attrs["data-x"]) position.x = attrs["data-x"];
    if (attrs["data-y"]) position.y = attrs["data-y"];
    if (attrs["data-w"]) position.w = attrs["data-w"];
    if (attrs["data-h"]) position.h = attrs["data-h"];

    const effects = safeJsonParse(attrs["data-effects"]);
    const aspectRatio = toNonEmptyString(attrs["data-aspect-ratio"]);

    slots.push({
      slotId,
      slideIntentId: slideIntentId || null,
      slideIndex: Number.isFinite(slideIndex) ? slideIndex : null,
      renderType,
      status: VisualSlotStatus.PENDING,
      ...(Object.keys(position).length ? { position } : {}),
      ...(effects ? { effects } : {}),
      ...(aspectRatio ? { aspectRatio } : {}),
    });
  }

  return slots;
}

export class SlideSubAgent {
  constructor({ slideIntent, designSystem, assetRegistry, ...options } = {}) {
    this.slideIntent = slideIntent || null;
    this.designSystem = designSystem || null;
    this.assetRegistry = assetRegistry || null;
    this.options = { ...options };
    this.state = { status: SlideStatus.PENDING };
    this.statusLog = [];
  }

  _transition(to, context = {}) {
    const from = this.state.status;
    const ok = slideStatusMachine.transition(this.state, to, context);
    if (ok) this.statusLog.push({ from, to, context });
    return ok;
  }

  get status() {
    return this.state.status;
  }

  async run(runOptions = {}) {
    const slideIntent = runOptions.slideIntent || this.slideIntent;
    const designSystem = runOptions.designSystem || this.designSystem;
    const assetRegistry = runOptions.assetRegistry || this.assetRegistry;
    const options = { ...this.options, ...runOptions };

    if (!slideIntent) throw new Error("SlideSubAgent: slideIntent is required");
    if (!designSystem) throw new Error("SlideSubAgent: designSystem is required");

    const slideIntentId = toNonEmptyString(slideIntent?.slideIntentId || slideIntent?.slideIntentID);
    const slideIndex = Number.isFinite(slideIntent?.slideIndex)
      ? slideIntent.slideIndex
      : (Number.isFinite(options.slideIndex) ? options.slideIndex : 0);
    const slideNo = Number.isFinite(options.slideNo) ? options.slideNo : slideIndex + 1;

    this._transition(SlideStatus.ASSIGNED, { slideIntentId, slideIndex });
    this._transition(SlideStatus.GENERATING, { slideIntentId, slideIndex });

    try {
      const supplemental = await buildSupplementalMarkdown(slideIntent, assetRegistry);
      const enrichedSlideIntent = withSupplementalContent(slideIntent, supplemental);
      const dslRules = options.dslRules || this.options.dslRules || await getDslRules();
      const contentPackage = options.contentPackage || {};

      const res = await generateSingleSlide(enrichedSlideIntent, designSystem, dslRules, {
        contentPackage,
        imageSlotsForSlide: Array.isArray(options.imageSlotsForSlide) ? options.imageSlotsForSlide : [],
        selectedIdeas: Array.isArray(options.selectedIdeas) ? options.selectedIdeas : [],
        modelCaller: options.modelCaller,
        modelRouter: options.modelRouter,
        aiApiService: options.aiApiService,
        emit: options.emit,
        signal: options.signal,
        slideNo,
        slideIndex,
      });

      const htmlDsl = res?.slideHtml || "";
      this._transition(SlideStatus.GENERATED, { slideIntentId, slideIndex, source: res?.source });

      const visualSlots = extractVisualSlotsFromHtml(htmlDsl, { slideIntentId, slideIndex });
      if (visualSlots.length) {
        this._transition(SlideStatus.VISUAL_PENDING, { slideIntentId, slideIndex });
      } else {
        this._transition(SlideStatus.VISUAL_PENDING, { slideIntentId, slideIndex });
        this._transition(SlideStatus.COMPLETED, { slideIntentId, slideIndex });
      }

      return {
        slideIntentId,
        slideIndex,
        htmlDsl,
        visualSlots,
        status: this.state.status,
        source: res?.source || "unknown",
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._transition(SlideStatus.FAILED, { slideIntentId, slideIndex, error: msg });
      return {
        slideIntentId,
        slideIndex,
        htmlDsl: "",
        visualSlots: [],
        status: this.state.status,
        source: "error",
        error: msg,
      };
    }
  }
}

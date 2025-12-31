import { AssetManager } from "./asset-manager.js";
import { MarkdownAdapter } from "./adapters/markdown.js";
import { RawTextAdapter } from "./adapters/raw-text.js";
import { HistoryAdapter } from "./adapters/history.js";
import { PdfAdapter } from "./adapters/pdf.js";
import { DocxAdapter } from "./adapters/docx.js";
import { PptxAdapter } from "./adapters/pptx.js";
import { HtmlAdapter } from "./adapters/html.js";
import { EpubAdapter } from "./adapters/epub.js";
import { AudioAdapter } from "./adapters/audio.js";
import { VideoAdapter } from "./adapters/video.js";
import { CodeAdapter } from "./adapters/code.js";
import { understandAssets as runAssetUnderstanding } from "./asset-understanding.js";
import { normalizeText } from "../stages/textprep/normalize.js";

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function toNonEmptyString(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function makeStageEmitter(stageApi, actor = "ingest") {
  const emitFn = stageApi?.emit || stageApi?.eventBus?.emit;
  if (typeof emitFn !== "function") return null;
  return (name, payload, { status = "completed" } = {}) => emitFn.call(stageApi?.eventBus || null, name, { actor, status, payload });
}

function checkCancelled(stageApi) {
  if (typeof stageApi?.checkCancelled === "function") stageApi.checkCancelled();
  if (stageApi?.signal?.aborted) {
    const reason = stageApi.signal.reason;
    throw new Error(typeof reason === "string" ? reason : "Run cancelled");
  }
}

function extOfName(name) {
  const n = String(name || "");
  const dot = n.lastIndexOf(".");
  if (dot === -1) return "";
  return n.slice(dot + 1).toLowerCase();
}

function mimeOfFile(file) {
  if (!file || typeof file !== "object") return "";
  return toNonEmptyString(file.type) || toNonEmptyString(file.mimeType) || "";
}

function fileLabel(file) {
  if (typeof file === "string") return file;
  if (file && typeof file === "object") return toNonEmptyString(file.name) || toNonEmptyString(file.filename) || "file";
  return "file";
}

export const INGEST_RESULT_ARTIFACT_TYPE = "ingest_result.json";
const INGEST_RESULT_KIND = "ingest_result";

function safeDocId(sourceType, textHash) {
  const kind = toNonEmptyString(sourceType) || "doc";
  const hex = String(textHash || "").startsWith("sha256:") ? String(textHash).slice("sha256:".length) : String(textHash || "");
  const short = hex.slice(0, 12) || "unknown";
  return `${kind}_${short}`;
}

function originKeyForRawText(input) {
  const text = typeof input === "string" ? input : String(input?.text || "");
  const normalized = normalizeText(text);
  const docId = safeDocId("user_text", normalized.textHash);
  return `raw:${docId}`;
}

function normalizeIngestArtifact(data) {
  const raw = data && typeof data === "object" && !Array.isArray(data) ? data : null;
  if (raw) return raw;
  if (typeof data !== "string") return null;
  try {
    const parsed = JSON.parse(data);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeFingerprint(fp) {
  const src = fp && typeof fp === "object" && !Array.isArray(fp) ? fp : {};
  const files = Array.isArray(src.files) ? src.files : [];
  const historyIds = Array.isArray(src.historyIds) ? src.historyIds : [];
  const rawTexts = Array.isArray(src.rawTexts) ? src.rawTexts : [];
  const urls = Array.isArray(src.urls) ? src.urls : [];
  return {
    files: files
      .map((f) => ({
        name: toNonEmptyString(f?.name) || "",
        type: toNonEmptyString(f?.type) || "",
        size: Number.isFinite(f?.size) ? f.size : null,
      }))
      .filter((f) => f.name)
      .sort((a, b) => `${a.name}|${a.size ?? ""}|${a.type}`.localeCompare(`${b.name}|${b.size ?? ""}|${b.type}`)),
    historyIds: historyIds.map((id) => toNonEmptyString(id)).filter(Boolean).sort(),
    rawTexts: rawTexts
      .map((r) => ({
        origin: toNonEmptyString(r?.origin) || "",
        length: Number.isFinite(r?.length) ? r.length : null,
      }))
      .filter((r) => r.origin)
      .sort((a, b) => a.origin.localeCompare(b.origin)),
    urls: urls.map((u) => toNonEmptyString(u)).filter(Boolean).sort(),
  };
}

function buildInputFingerprint({ files = [], urls = [], historyIds = [], rawTexts = [] } = {}) {
  const fileMeta = (Array.isArray(files) ? files : []).map((f) => {
    if (typeof f === "string") return { name: f, type: "", size: null };
    const name = toNonEmptyString(f?.name) || toNonEmptyString(f?.filename) || "file";
    const type = toNonEmptyString(f?.type) || toNonEmptyString(f?.mimeType) || "";
    const size = Number.isFinite(f?.size) ? f.size : null;
    return { name, type, size };
  });

  const rawMeta = (Array.isArray(rawTexts) ? rawTexts : []).map((t) => {
    const text = typeof t === "string" ? t : String(t?.text || "");
    return { origin: originKeyForRawText(t), length: text.length };
  });

  return normalizeFingerprint({
    files: fileMeta,
    urls,
    historyIds,
    rawTexts: rawMeta,
  });
}

function fingerprintsEqual(a, b) {
  try {
    return JSON.stringify(normalizeFingerprint(a)) === JSON.stringify(normalizeFingerprint(b));
  } catch {
    return false;
  }
}

function normalizeTimeoutMs(value) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

function withTimeout(promise, timeoutMs, { signal, label } = {}) {
  const ms = normalizeTimeoutMs(timeoutMs);
  if (!ms) return Promise.resolve(promise);

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (signal && typeof signal.removeEventListener === "function") {
        signal.removeEventListener("abort", onAbort);
      }
    };

    const doneResolve = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const doneReject = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const onAbort = () => {
      const err = new Error("Run cancelled");
      err.name = "AbortError";
      doneReject(err);
    };

    if (signal && typeof signal.addEventListener === "function") {
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
    }

    timer = setTimeout(() => {
      const err = new Error(`Timeout after ${ms}ms${label ? `: ${label}` : ""}`);
      err.name = "TimeoutError";
      doneReject(err);
    }, ms);

    Promise.resolve(promise).then(doneResolve, doneReject);
  });
}

function sourceFromParsed(parsed, assetIds) {
  const kind = toNonEmptyString(parsed?.sourceType) || "markdown";
  const title = toNonEmptyString(parsed?.metadata?.title) || toNonEmptyString(parsed?.origin?.filename) || toNonEmptyString(parsed?.origin?.title);
  const uri = toNonEmptyString(parsed?.origin?.url);

  return {
    sourceId: parsed.docId,
    kind,
    ...(title ? { title } : {}),
    ...(uri ? { uri } : {}),
    sourceTextNormalized: parsed.textNormalized,
    textHash: parsed.textHash,
    ...(Array.isArray(parsed.toc) ? { toc: parsed.toc } : {}),
    ...(Array.isArray(parsed.chunks) ? { chunks: parsed.chunks } : {}),
    ...(Array.isArray(assetIds) && assetIds.length ? { assetIds } : {}),
    metadata: { ...(isPlainObject(parsed.metadata) ? parsed.metadata : {}), ...(isPlainObject(parsed.origin) ? { origin: parsed.origin } : {}) },
  };
}

export class IngestStage {
  constructor({ defaultChunkOptions } = {}) {
    this.defaultChunkOptions = isPlainObject(defaultChunkOptions)
      ? defaultChunkOptions
      : { chunkSize: 2000, overlap: 200, includeLineNumbers: true };
  }

  /**
   * Stage interface (Runtime): execute(runContext, input) -> IngestStageOutput.
   * @param {object} runContext
   * @param {object} input IngestInput or {input:IngestInput,config?:object}
   * @param {{emit?:Function,eventBus?:object,signal?:AbortSignal,checkCancelled?:Function,storageAdapter?:object}=} stageApi
   * @returns {Promise<object>} IngestStageOutput
   */
  async execute(runContext, input, stageApi = {}) {
    const t0 = Date.now();
    const emit = makeStageEmitter(stageApi, "ingest");

    const ingestInput = isPlainObject(input?.input) ? input.input : input;
    const config = isPlainObject(input?.config) ? input.config : {};
    const chunkOptions = { ...this.defaultChunkOptions, ...(isPlainObject(config?.chunkOptions) ? config.chunkOptions : {}) };
    if (Number.isFinite(config?.chunkSize)) chunkOptions.chunkSize = Math.max(1, Math.floor(config.chunkSize));
    if (Number.isFinite(config?.chunkOverlap)) chunkOptions.overlap = Math.max(0, Math.floor(config.chunkOverlap));

    const files = Array.isArray(ingestInput?.files) ? ingestInput.files : [];
    const urls = Array.isArray(ingestInput?.urls) ? ingestInput.urls : [];
    const historyIds = Array.isArray(ingestInput?.historyIds) ? ingestInput.historyIds : [];
    const rawTexts = Array.isArray(ingestInput?.rawTexts) ? ingestInput.rawTexts : [];

    const inputCount = files.length + urls.length + historyIds.length + rawTexts.length;
    emit?.("ingest.started", { inputCount, runId: runContext?.runId }, { status: "started" });

    const runId = runContext?.runId;
    const runStore = stageApi?.runStore || null;
    const resumeEnabled = config?.resume !== false;
    const persistEnabled = config?.persist !== false;
    const docTimeoutMs = normalizeTimeoutMs(config?.docTimeoutMs ?? config?.perDocTimeoutMs ?? 0);
    const inputFingerprint = buildInputFingerprint({ files, urls, historyIds, rawTexts });

    const assets = new AssetManager();
    const adapters = {
      markdown: new MarkdownAdapter({ defaultChunkOptions: chunkOptions }),
      rawText: new RawTextAdapter({ defaultChunkOptions: chunkOptions }),
      history: new HistoryAdapter(stageApi?.storageAdapter || config?.storageAdapter || null, { defaultChunkOptions: chunkOptions }),
      pdf: new PdfAdapter({ defaultChunkOptions: chunkOptions }),
      docx: new DocxAdapter({ defaultChunkOptions: chunkOptions }),
      pptx: new PptxAdapter({ defaultChunkOptions: chunkOptions }),
      html: new HtmlAdapter({ defaultChunkOptions: chunkOptions }),
      epub: new EpubAdapter({ defaultChunkOptions: chunkOptions }),
      audio: new AudioAdapter({ defaultChunkOptions: chunkOptions, whisperApi: stageApi?.whisperApi || config?.whisperApi || null }),
      video: new VideoAdapter({ defaultChunkOptions: chunkOptions, whisperApi: stageApi?.whisperApi || config?.whisperApi || null }),
      code: new CodeAdapter({ defaultChunkOptions: chunkOptions }),
    };

    let sources = [];
    let parseErrors = [];
    let processedOrigins = new Set();
    let successDocs = 0;
    let failedDocs = 0;

    const persistResume = async ({ lastDoc } = {}) => {
      if (!persistEnabled) return null;
      if (!runStore || typeof runStore.saveArtifact !== "function") return null;
      if (!runId || typeof runId !== "string") return null;

      const payload = {
        schemaVersion: "0.1",
        kind: INGEST_RESULT_KIND,
        runId,
        updatedAt: new Date().toISOString(),
        inputFingerprint,
        processedOrigins: Array.from(processedOrigins),
        ...(lastDoc && typeof lastDoc === "object" ? { lastDoc } : {}),
        output: {
          sources,
          assets: assets.listAssets(),
          parseErrors,
          metrics: {
            totalDocs: inputCount,
            successDocs,
            failedDocs,
            totalAssets: assets.count(),
            durationMs: Date.now() - t0,
          },
        },
      };

      try {
        return await runStore.saveArtifact(runId, INGEST_RESULT_ARTIFACT_TYPE, payload, {
          artifactId: `ingest_${runId}`,
          storageKey: `runs/${runId}/${INGEST_RESULT_ARTIFACT_TYPE}`,
          mime: "application/json",
        });
      } catch {
        return null;
      }
    };

    // Resume from persisted partial ingest (best-effort).
    if (resumeEnabled && runStore && typeof runStore.getArtifact === "function" && typeof runId === "string" && runId) {
      try {
        const cachedRaw = await runStore.getArtifact(runId, INGEST_RESULT_ARTIFACT_TYPE);
        const cached = normalizeIngestArtifact(cachedRaw);
        const cachedFp = cached?.inputFingerprint;
        const cachedOut = cached?.output;
        const cachedOrigins = Array.isArray(cached?.processedOrigins) ? cached.processedOrigins : [];

        if (cached?.kind === INGEST_RESULT_KIND && fingerprintsEqual(cachedFp, inputFingerprint) && isPlainObject(cachedOut)) {
          sources = Array.isArray(cachedOut.sources) ? cachedOut.sources : [];
          parseErrors = Array.isArray(cachedOut.parseErrors) ? cachedOut.parseErrors : [];
          successDocs = sources.length;
          failedDocs = parseErrors.length;
          processedOrigins = new Set(cachedOrigins.map((o) => String(o)));

          try {
            const cachedAssets = Array.isArray(cachedOut.assets) ? cachedOut.assets : [];
            assets.addAssets(cachedAssets);
          } catch {
            // ignore resume asset hydration failures
          }

          emit?.(
            "ingest.resumed",
            { runId, processed: processedOrigins.size, sourceCount: sources.length, assetCount: assets.count() },
            { status: "info" }
          );
        }
      } catch {
        // ignore resume failures
      }
    }

    const shouldSkipOrigin = (origin) => {
      const key = String(origin || "");
      return !!key && processedOrigins.has(key);
    };

    const markOriginProcessed = async (origin, lastDoc) => {
      const key = String(origin || "");
      if (!key) return null;
      processedOrigins.add(key);
      return await persistResume({ lastDoc });
    };

    // rawTexts
    for (const item of rawTexts) {
      checkCancelled(stageApi);
      const origin = originKeyForRawText(item);
      if (shouldSkipOrigin(origin)) {
        emit?.("ingest.doc.skipped", { origin }, { status: "skipped" });
        continue;
      }
      emit?.("ingest.doc.started", { origin }, { status: "started" });
      try {
        const parsed = await withTimeout(adapters.rawText.parse(item), docTimeoutMs, { signal: stageApi?.signal, label: origin });
        const addedAssetIds = assets.addAssets(Array.isArray(parsed.assets) ? parsed.assets.map((a) => ({ ...a, docId: parsed.docId })) : []);
        const assetIds = Array.from(new Set(addedAssetIds));
        sources.push(sourceFromParsed(parsed, assetIds));
        successDocs++;
        emit?.("ingest.doc.completed", { docId: parsed.docId, assetCount: assetIds.length, chunkCount: parsed.chunks?.length || 0 }, { status: "completed" });
        await markOriginProcessed(origin, { origin, status: "completed", docId: parsed.docId });
      } catch (e) {
        failedDocs++;
        const msg = e instanceof Error ? e.message : String(e);
        parseErrors.push({ origin, error: msg });
        emit?.("ingest.doc.failed", { origin, error: msg }, { status: "failed" });
        await markOriginProcessed(origin, { origin, status: "failed", error: msg });
      }
    }

    // historyIds
    for (const hid of historyIds) {
      checkCancelled(stageApi);
      const origin = `history:${hid}`;
      if (shouldSkipOrigin(origin)) {
        emit?.("ingest.doc.skipped", { origin, historyId: hid }, { status: "skipped" });
        continue;
      }
      emit?.("ingest.doc.started", { origin, historyId: hid }, { status: "started" });
      try {
        const parsed = await withTimeout(adapters.history.parse(hid), docTimeoutMs, { signal: stageApi?.signal, label: origin });
        const addedAssetIds = assets.addAssets(Array.isArray(parsed.assets) ? parsed.assets.map((a) => ({ ...a, docId: parsed.docId })) : []);
        const assetIds = Array.from(new Set(addedAssetIds));
        sources.push(sourceFromParsed(parsed, assetIds));
        successDocs++;
        emit?.("ingest.doc.completed", { docId: parsed.docId, assetCount: assetIds.length, chunkCount: parsed.chunks?.length || 0 }, { status: "completed" });
        await markOriginProcessed(origin, { origin, status: "completed", docId: parsed.docId });
      } catch (e) {
        failedDocs++;
        const msg = e instanceof Error ? e.message : String(e);
        parseErrors.push({ origin, error: msg });
        emit?.("ingest.doc.failed", { origin, error: msg }, { status: "failed" });
        await markOriginProcessed(origin, { origin, status: "failed", error: msg });
      }
    }

    // files
    for (const f of files) {
      checkCancelled(stageApi);
      const label = fileLabel(f);
      const ext = extOfName(label);
      const mimeType = mimeOfFile(f);
      const origin = `file:${label}`;
      if (shouldSkipOrigin(origin)) {
        emit?.("ingest.doc.skipped", { origin, filename: label }, { status: "skipped" });
        continue;
      }
      emit?.("ingest.doc.started", { origin, filename: label }, { status: "started" });

      const isPdf = mimeType === "application/pdf" || ext === "pdf";
      const isMarkdown = ext === "md" || ext === "markdown" || ext === "txt";
      const isDocx = mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || ext === "docx";
      const isPptx = mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation" || ext === "pptx";
      const isHtml = mimeType === "text/html" || ext === "html" || ext === "htm";
      const isEpub = mimeType === "application/epub+zip" || ext === "epub";
      const isAudio = mimeType.startsWith("audio/") || ["mp3", "wav", "m4a", "aac", "flac", "ogg", "oga", "webm"].includes(ext);
      const isVideo = mimeType.startsWith("video/") || ["mp4", "m4v", "webm", "mov", "mkv", "avi"].includes(ext);
      const isCode = CodeAdapter.isSupported(label);

      if (!isMarkdown && !isPdf && !isDocx && !isPptx && !isHtml && !isEpub && !isAudio && !isVideo && !isCode) {
        failedDocs++;
        const msg = `Unsupported file type: .${ext || "(none)"}${mimeType ? ` (${mimeType})` : ""}`;
        parseErrors.push({ origin, error: msg });
        emit?.("ingest.doc.failed", { origin, error: msg }, { status: "failed" });
        await markOriginProcessed(origin, { origin, status: "failed", error: msg });
        continue;
      }

      try {
        const parsePromise = isPdf
          ? adapters.pdf.parse(f, stageApi)
          : isDocx
            ? adapters.docx.parse(f, stageApi)
            : isPptx
              ? adapters.pptx.parse(f, stageApi)
              : isHtml
                ? adapters.html.parse(f, stageApi)
                : isEpub
                  ? adapters.epub.parse(f, stageApi)
                  : isVideo
                    ? adapters.video.parse(f, stageApi)
                    : isAudio
                      ? adapters.audio.parse(f, stageApi)
                      : isCode
                        ? adapters.code.parse(f, stageApi)
                        : adapters.markdown.parse(f, stageApi);
        const parsed = await withTimeout(parsePromise, docTimeoutMs, { signal: stageApi?.signal, label: origin });
        const addedAssetIds = assets.addAssets(Array.isArray(parsed.assets) ? parsed.assets.map((a) => ({ ...a, docId: parsed.docId })) : []);
        const assetIds = Array.from(new Set(addedAssetIds));
        sources.push(sourceFromParsed(parsed, assetIds));
        successDocs++;
        emit?.("ingest.doc.completed", { docId: parsed.docId, assetCount: assetIds.length, chunkCount: parsed.chunks?.length || 0 }, { status: "completed" });
        await markOriginProcessed(origin, { origin, status: "completed", docId: parsed.docId });
      } catch (e) {
        failedDocs++;
        const msg = e instanceof Error ? e.message : String(e);
        parseErrors.push({ origin, error: msg });
        emit?.("ingest.doc.failed", { origin, error: msg }, { status: "failed" });
        await markOriginProcessed(origin, { origin, status: "failed", error: msg });
      }
    }

    // urls - 通过 MCP fetch_content 获取后再传入 rawTexts 或 files
    for (const url of urls) {
      checkCancelled(stageApi);
      const origin = `url:${url}`;
      if (shouldSkipOrigin(origin)) {
        emit?.("ingest.doc.skipped", { origin, url }, { status: "skipped" });
        continue;
      }
      emit?.("ingest.doc.started", { origin, url }, { status: "started" });
      failedDocs++;
      const error = "URL ingest not supported directly. Use MCP fetch_content to retrieve content first, then pass as rawTexts or files.";
      parseErrors.push({ origin, error });
      emit?.("ingest.doc.failed", { origin, error }, { status: "failed" });
      await markOriginProcessed(origin, { origin, status: "failed", error });
    }

    const understandingOpt = config?.understandAssets;
    const enableUnderstanding = understandingOpt === true || isPlainObject(understandingOpt);
    if (enableUnderstanding) {
      checkCancelled(stageApi);
      const allAssets = assets.listAssets();
      if (allAssets.length) {
        const understandingConfig = isPlainObject(understandingOpt) ? understandingOpt : {};
        const visionApi = stageApi?.visionApi || config?.visionApi || null;
        const modelRouter = stageApi?.modelRouter || config?.modelRouter || null;

        emit?.("ingest.assets.understanding.started", { assetCount: allAssets.length }, { status: "started" });
        try {
          const results = await runAssetUnderstanding(allAssets, {
            ...understandingConfig,
            visionApi,
            modelRouter,
            onProgress: (p) => {
              checkCancelled(stageApi);
              emit?.("ingest.assets.understanding.progress", p, { status: "progress" });
              understandingConfig?.onProgress?.(p);
            },
          });

          for (let i = 0; i < allAssets.length; i++) {
            const understanding = results[i];
            if (understanding == null) continue;
            const existing = isPlainObject(allAssets[i].understanding) ? allAssets[i].understanding : {};
            allAssets[i].understanding = isPlainObject(understanding) ? { ...existing, ...understanding } : understanding;
          }
          emit?.("ingest.assets.understanding.completed", { assetCount: allAssets.length }, { status: "completed" });
        } catch (e) {
          checkCancelled(stageApi);
          const msg = e instanceof Error ? e.message : String(e);
          emit?.("ingest.assets.understanding.failed", { error: msg }, { status: "failed" });
        }
      }
    }

    const output = {
      sources,
      assets: assets.listAssets(),
      parseErrors,
      metrics: {
        totalDocs: inputCount,
        successDocs,
        failedDocs,
        totalAssets: assets.count(),
        durationMs: Date.now() - t0,
      },
    };

    await persistResume({ lastDoc: { origin: null, status: "completed" } });
    emit?.("ingest.completed", { sourceCount: sources.length, assetCount: output.assets.length, durationMs: output.metrics.durationMs }, { status: "completed" });
    return output;
  }
}

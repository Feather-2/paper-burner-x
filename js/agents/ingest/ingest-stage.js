import { AssetManager } from "./asset-manager.js";
import { MarkdownAdapter } from "./adapters/markdown.js";
import { RawTextAdapter } from "./adapters/raw-text.js";
import { HistoryAdapter } from "./adapters/history.js";
import { PdfAdapter } from "./adapters/pdf.js";

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

    const assets = new AssetManager();
    const adapters = {
      markdown: new MarkdownAdapter({ defaultChunkOptions: chunkOptions }),
      rawText: new RawTextAdapter({ defaultChunkOptions: chunkOptions }),
      history: new HistoryAdapter(stageApi?.storageAdapter || config?.storageAdapter || null, { defaultChunkOptions: chunkOptions }),
      pdf: new PdfAdapter({ defaultChunkOptions: chunkOptions }),
    };

    const sources = [];
    const parseErrors = [];
    let successDocs = 0;
    let failedDocs = 0;

    // rawTexts
    for (const item of rawTexts) {
      checkCancelled(stageApi);
      emit?.("ingest.doc.started", { origin: "rawText" }, { status: "started" });
      try {
        const parsed = await adapters.rawText.parse(item);
        const addedAssetIds = assets.addAssets(Array.isArray(parsed.assets) ? parsed.assets.map((a) => ({ ...a, docId: parsed.docId })) : []);
        const assetIds = Array.from(new Set(addedAssetIds));
        sources.push(sourceFromParsed(parsed, assetIds));
        successDocs++;
        emit?.("ingest.doc.completed", { docId: parsed.docId, assetCount: assetIds.length, chunkCount: parsed.chunks?.length || 0 }, { status: "completed" });
      } catch (e) {
        failedDocs++;
        const msg = e instanceof Error ? e.message : String(e);
        parseErrors.push({ origin: "rawText", error: msg });
        emit?.("ingest.doc.failed", { origin: "rawText", error: msg }, { status: "failed" });
      }
    }

    // historyIds
    for (const hid of historyIds) {
      checkCancelled(stageApi);
      const origin = `history:${hid}`;
      emit?.("ingest.doc.started", { origin, historyId: hid }, { status: "started" });
      try {
        const parsed = await adapters.history.parse(hid);
        const addedAssetIds = assets.addAssets(Array.isArray(parsed.assets) ? parsed.assets.map((a) => ({ ...a, docId: parsed.docId })) : []);
        const assetIds = Array.from(new Set(addedAssetIds));
        sources.push(sourceFromParsed(parsed, assetIds));
        successDocs++;
        emit?.("ingest.doc.completed", { docId: parsed.docId, assetCount: assetIds.length, chunkCount: parsed.chunks?.length || 0 }, { status: "completed" });
      } catch (e) {
        failedDocs++;
        const msg = e instanceof Error ? e.message : String(e);
        parseErrors.push({ origin, error: msg });
        emit?.("ingest.doc.failed", { origin, error: msg }, { status: "failed" });
      }
    }

    // files
    for (const f of files) {
      checkCancelled(stageApi);
      const label = fileLabel(f);
      const ext = extOfName(label);
      const mimeType = mimeOfFile(f);
      const origin = `file:${label}`;
      emit?.("ingest.doc.started", { origin, filename: label }, { status: "started" });

      const isPdf = mimeType === "application/pdf" || ext === "pdf";
      const isMarkdown = ext === "md" || ext === "markdown" || ext === "txt";
      if (!isMarkdown && !isPdf) {
        failedDocs++;
        const msg = `Unsupported file extension: .${ext || "(none)"}`;
        parseErrors.push({ origin, error: msg });
        emit?.("ingest.doc.failed", { origin, error: msg }, { status: "failed" });
        continue;
      }

      try {
        const parsed = isPdf ? await adapters.pdf.parse(f, stageApi) : await adapters.markdown.parse(f);
        const addedAssetIds = assets.addAssets(Array.isArray(parsed.assets) ? parsed.assets.map((a) => ({ ...a, docId: parsed.docId })) : []);
        const assetIds = Array.from(new Set(addedAssetIds));
        sources.push(sourceFromParsed(parsed, assetIds));
        successDocs++;
        emit?.("ingest.doc.completed", { docId: parsed.docId, assetCount: assetIds.length, chunkCount: parsed.chunks?.length || 0 }, { status: "completed" });
      } catch (e) {
        failedDocs++;
        const msg = e instanceof Error ? e.message : String(e);
        parseErrors.push({ origin, error: msg });
        emit?.("ingest.doc.failed", { origin, error: msg }, { status: "failed" });
      }
    }

    // urls (not implemented in P0)
    for (const url of urls) {
      checkCancelled(stageApi);
      const origin = `url:${url}`;
      emit?.("ingest.doc.started", { origin, url }, { status: "started" });
      failedDocs++;
      parseErrors.push({ origin, error: "URL ingest not implemented" });
      emit?.("ingest.doc.failed", { origin, error: "URL ingest not implemented" }, { status: "failed" });
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

    emit?.("ingest.completed", { sourceCount: sources.length, assetCount: output.assets.length, durationMs: output.metrics.durationMs }, { status: "completed" });
    return output;
  }
}

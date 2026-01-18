import { BaseAdapter } from "./base.js";
import { getVideoFrames } from "../tools/video-frames.js";
import { SourceKind } from "../constants.js";
import { basenameOfPath, fileLikeFromPath as nodeFileLikeFromPath } from "./node-io.js";

import { isPlainObject, toNonEmptyString } from "../../shared/utils/value-utils.js";

async function fileLikeFromPath(path, { filename, mimeType } = {}) {
  const file = await nodeFileLikeFromPath(path, { mimeType: mimeType || "" });
  if (filename) file.name = filename;
  return file;
}

function guessMimeType(filename) {
  const name = String(filename || "").toLowerCase();
  if (name.endsWith(".mp4") || name.endsWith(".m4v")) return "video/mp4";
  if (name.endsWith(".webm")) return "video/webm";
  if (name.endsWith(".mov")) return "video/quicktime";
  if (name.endsWith(".mkv")) return "video/x-matroska";
  if (name.endsWith(".avi")) return "video/x-msvideo";
  return "application/octet-stream";
}

function resolveWhisperApi(stageApi, injected) {
  const api = stageApi?.whisperApi || stageApi?.services?.whisperApi || injected;
  if (!api) return null;
  if (typeof api.transcribe === "function") return api;
  if (typeof api.transcribeVideo === "function") return { transcribe: api.transcribeVideo.bind(api) };
  return null;
}

function coerceNumber(v) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeSegmentTimes(seg) {
  const startMs = coerceNumber(seg?.start_ms ?? seg?.startMs);
  const endMs = coerceNumber(seg?.end_ms ?? seg?.endMs);
  const startUs = coerceNumber(seg?.start_us ?? seg?.startUs);
  const endUs = coerceNumber(seg?.end_us ?? seg?.endUs);
  const start = coerceNumber(seg?.start);
  const end = coerceNumber(seg?.end);
  const duration = coerceNumber(seg?.duration);

  if (startMs !== undefined || endMs !== undefined) {
    const s = (startMs ?? 0) / 1000;
    const e = (endMs ?? (startMs ?? 0) + (duration ?? 0) * 1000) / 1000;
    return { startSec: s, endSec: e };
  }
  if (startUs !== undefined || endUs !== undefined) {
    const s = (startUs ?? 0) / 1e6;
    const e = (endUs ?? (startUs ?? 0) + (duration ?? 0) * 1e6) / 1e6;
    return { startSec: s, endSec: e };
  }

  const startSec = start !== undefined ? start : 0;
  const endSec = end !== undefined ? end : startSec + (duration ?? 0);
  if (Number.isInteger(startSec) && startSec > 6000 && endSec > 6000) return { startSec: startSec / 1000, endSec: endSec / 1000 };
  return { startSec, endSec };
}

function normalizeTranscriptSegments(rawSegments) {
  const segments = Array.isArray(rawSegments) ? rawSegments : [];
  const out = [];
  for (const seg of segments) {
    if (!seg) continue;
    const text = toNonEmptyString(seg.text ?? seg.snippet?.text ?? seg.transcript ?? seg.content) || "";
    const { startSec, endSec } = normalizeSegmentTimes(seg);
    out.push({ text, startSec: Math.max(0, startSec), endSec: Math.max(0, endSec) });
  }
  out.sort((a, b) => a.startSec - b.startSec);
  return out;
}

function lrcTimestampFromSec(sec) {
  const t = Math.max(0, Number(sec) || 0);
  const mm = Math.floor(t / 60);
  const ss = (t % 60).toFixed(2);
  return `[${String(mm).padStart(2, "0")}:${String(ss).padStart(5, "0")}]`;
}

function segmentsToLrc(segments) {
  return segments
    .map((s) => `${lrcTimestampFromSec(s.startSec)}${String(s.text || "").replace(/\s+/g, " ").trim()}`)
    .filter((line) => line !== `${lrcTimestampFromSec(0)}`)
    .join("\n");
}

function segmentsToPlainText(segments) {
  return segments
    .map((s) => String(s.text || "").trim())
    .filter(Boolean)
    .join("\n");
}

function defaultAssetId(i) {
  return `asset_video_frame_${String(i + 1).padStart(3, "0")}`;
}

export class VideoAdapter extends BaseAdapter {
  constructor(opts = {}) {
    super({ ...opts, adapterName: "video" });
    this.whisperApi = opts.whisperApi || null;
    this.extractFrames = Boolean(opts.extractFrames);
    this.frameCount = Number.isFinite(opts.frameCount) ? Math.max(0, Math.floor(opts.frameCount)) : 0;
    this.frameExtractor = typeof opts.frameExtractor === "function" ? opts.frameExtractor : getVideoFrames;
  }

  /**
   * @param {string|{name?:string,filename?:string,type?:string,mimeType?:string,size?:number,arrayBuffer?:Function}} input
   * @param {{whisperApi?:object,services?:object,extractAudioTrack?:Function,mediabunny?:any,frameToBase64?:Function}=} stageApi
   * @returns {Promise<object>}
   */
  async parse(input, stageApi = {}) {
    const t0 = Date.now();

    let file = input;
    let filename = "";
    let mimeType = "";
    let size = undefined;

    if (typeof input === "string") {
      filename = await basenameOfPath(input);
      mimeType = guessMimeType(filename);
      file = await fileLikeFromPath(input, { filename, mimeType });
      size = file.size;
    } else if (input && typeof input === "object") {
      filename = toNonEmptyString(input.name) || toNonEmptyString(input.filename) || "video";
      mimeType = toNonEmptyString(input.type) || toNonEmptyString(input.mimeType) || guessMimeType(filename);
      size = Number.isFinite(input.size) ? input.size : undefined;
      if (typeof input.arrayBuffer !== "function") throw new Error("VideoAdapter.parse(input): unsupported file-like input (missing arrayBuffer())");
    } else {
      throw new TypeError("VideoAdapter.parse(input): input must be a path string or a file-like object");
    }

    const whisperApi = resolveWhisperApi(stageApi, this.whisperApi);
    if (!whisperApi) throw new Error("VideoAdapter.parse(input): whisperApi is required (stageApi.whisperApi or opts.whisperApi)");

    const warnings = [];

    let transcriptionInput = file;
    try {
      const extractor = stageApi?.extractAudioTrack;
      if (typeof extractor === "function") {
        const audioFile = await extractor(file, { filename, mimeType });
        if (audioFile && typeof audioFile.arrayBuffer === "function") transcriptionInput = audioFile;
      }
    } catch (e) {
      warnings.push(e instanceof Error ? e.message : String(e));
    }

    const transcript = await whisperApi.transcribe(transcriptionInput, { kind: "video", filename, mimeType });
    const segments = normalizeTranscriptSegments(transcript?.segments);

    const plainText = toNonEmptyString(transcript?.text) || segmentsToPlainText(segments);
    const lrc = segmentsToLrc(segments);

    const duration = coerceNumber(transcript?.durationSec ?? transcript?.duration ?? transcript?.metadata?.duration);
    const fps = coerceNumber(transcript?.metadata?.fps);
    const resolution = toNonEmptyString(transcript?.metadata?.resolution);

    let frameAssets = [];
    const wantFrames = this.extractFrames && this.frameCount > 0;
    if (wantFrames) {
      try {
        const endSec = Number.isFinite(duration) ? duration : 0;
        const frames = await this.frameExtractor(file, 0, endSec, this.frameCount, {
          mediabunny: stageApi?.mediabunny,
          frameToBase64: stageApi?.frameToBase64,
        });
        frameAssets = (Array.isArray(frames) ? frames : []).filter(Boolean).map((b64, i) => ({
          assetId: defaultAssetId(i),
          docId: "",
          type: "image",
          mimeType: "image/jpeg",
          data: b64,
          locator: { timeSec: Number.isFinite(endSec) && this.frameCount > 1 ? (endSec * i) / (this.frameCount - 1) : 0 },
          source: "extracted",
          reusable: true,
          suggestedUse: "keyframe",
        }));
      } catch (e) {
        warnings.push(e instanceof Error ? e.message : String(e));
      }
    }

    const markdown = [`# ${filename}`, "", plainText].join("\n");
    const parsed = this.buildParsedDocument({
      sourceType: SourceKind.VIDEO,
      origin: { filename, mimeType, size },
      markdown,
      assets: frameAssets,
      metadata: {
        duration,
        ...(resolution ? { resolution } : {}),
        ...(fps !== undefined ? { fps } : {}),
        frameCount: frameAssets.length,
      },
      parseInfo: {
        adapter: "video",
        durationMs: Date.now() - t0,
        ...(warnings.length ? { warnings } : {}),
        ...(isPlainObject(transcript?.metadata) ? { transcriptMetadata: transcript.metadata } : {}),
      },
    });

    for (const a of parsed.assets) a.docId = parsed.docId;
    return { ...parsed, lrc };
  }
}


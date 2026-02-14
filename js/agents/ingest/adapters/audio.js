import { BaseAdapter } from "./base.js";
import { SourceKind } from "../constants.js";
import { basenameOfPath, fileLikeFromPath as nodeFileLikeFromPath } from "./node-io.js";
import { resolveWhisperApi } from "./resolve-deps.js";

import { isPlainObject, toNonEmptyString } from "../../shared/index.js";

function normalizeMaxBytes(value, fallback) {
  if (value === Infinity) return Infinity;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

// Default audio max file size (50MB). Override via new AudioAdapter({ maxFileSize }).
const DEFAULT_MAX_FILE_SIZE = 50 * 1024 * 1024;

async function fileLikeFromPath(path, { filename, mimeType, maxBytes } = {}) {
  const file = await nodeFileLikeFromPath(path, { maxBytes, mimeType: mimeType || "" });
  if (filename) file.name = filename;
  return file;
}

function guessMimeType(filename) {
  const name = String(filename || "").toLowerCase();
  if (name.endsWith(".mp3")) return "audio/mpeg";
  if (name.endsWith(".wav")) return "audio/wav";
  if (name.endsWith(".m4a")) return "audio/mp4";
  if (name.endsWith(".aac")) return "audio/aac";
  if (name.endsWith(".flac")) return "audio/flac";
  if (name.endsWith(".ogg") || name.endsWith(".oga")) return "audio/ogg";
  if (name.endsWith(".webm")) return "audio/webm";
  return "application/octet-stream";
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

  // Heuristic: some providers return ms in integer form; 6000s is uncommon for typical clips.
  if (Number.isInteger(startSec) && startSec > 6000 && endSec > 6000) {
    return { startSec: startSec / 1000, endSec: endSec / 1000 };
  }
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
    .filter((line) => line !== `${lrcTimestampFromSec(0)}`) // guard against empty lines
    .join("\n");
}

function segmentsToPlainText(segments) {
  return segments
    .map((s) => String(s.text || "").trim())
    .filter(Boolean)
    .join("\n");
}

export class AudioAdapter extends BaseAdapter {
  constructor(opts = {}) {
    super({ ...opts, adapterName: "audio" });
    this.whisperApi = opts.whisperApi || null;
    this.maxFileSize = normalizeMaxBytes(opts.maxFileSize, DEFAULT_MAX_FILE_SIZE);
  }

  /**
   * @param {string|{name?:string,filename?:string,type?:string,mimeType?:string,size?:number,arrayBuffer?:Function}} input
   * @param {{whisperApi?:object,services?:object}=} stageApi
   * @returns {Promise<object>}
   */
  async parse(input, stageApi = {}) {
    const t0 = Date.now();

    let file = input;
    let filename = "";
    let mimeType = "";
    let size = undefined;

    const maxBytes = this.maxFileSize;

    if (typeof input === "string") {
      filename = await basenameOfPath(input);
      mimeType = guessMimeType(filename);
      file = await fileLikeFromPath(input, { filename, mimeType, maxBytes });
      size = file.size;
    } else if (input && typeof input === "object") {
      filename = toNonEmptyString(input.name) || toNonEmptyString(input.filename) || "audio";
      mimeType = toNonEmptyString(input.type) || toNonEmptyString(input.mimeType) || guessMimeType(filename);
      size = Number.isFinite(input.size) ? input.size : undefined;
      if (typeof input.arrayBuffer !== "function") throw new Error("AudioAdapter.parse(input): unsupported file-like input (missing arrayBuffer())");
    } else {
      throw new TypeError("AudioAdapter.parse(input): input must be a path string or a file-like object");
    }

    if (Number.isFinite(maxBytes) && maxBytes > 0 && Number.isFinite(size) && size > maxBytes) {
      throw new Error(`AudioAdapter: file too large: ${size} bytes (max ${maxBytes})`);
    }

    const whisperApi = resolveWhisperApi(stageApi, this.whisperApi, 'audio');
    if (!whisperApi) throw new Error("AudioAdapter.parse(input): whisperApi is required (stageApi.whisperApi or opts.whisperApi)");

    const transcript = await whisperApi.transcribe(file, { kind: "audio", filename, mimeType });
    const segments = normalizeTranscriptSegments(transcript?.segments);

    const plainText = toNonEmptyString(transcript?.text) || segmentsToPlainText(segments);
    const lrc = segmentsToLrc(segments);

    const duration = coerceNumber(transcript?.durationSec ?? transcript?.duration ?? transcript?.metadata?.duration);
    const language = toNonEmptyString(transcript?.language ?? transcript?.metadata?.language);
    const format = toNonEmptyString(transcript?.format ?? mimeType);

    const markdown = [`# ${filename}`, "", plainText].join("\n");
    const parsed = this.buildParsedDocument({
      sourceType: SourceKind.AUDIO,
      origin: { filename, mimeType, size },
      markdown,
      assets: [],
      metadata: { duration, language, format },
      parseInfo: {
        adapter: "audio",
        durationMs: Date.now() - t0,
        ...(isPlainObject(transcript?.metadata) ? { transcriptMetadata: transcript.metadata } : {}),
      },
    });

    return { ...parsed, lrc };
  }
}

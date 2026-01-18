import { BaseAdapter } from "./base.js";
import { SourceKind } from "../constants.js";
import { basenameOfPath as nodeBasenameOfPath, readTextFromPath as nodeReadTextFromPath, isNodeEnvironment } from "./node-io.js";

import { isPlainObject, toNonEmptyString } from "../../shared/utils/value-utils.js";
function guessMimeType(filename) {
  const name = String(filename || "").toLowerCase();
  if (name.endsWith(".md") || name.endsWith(".markdown")) return "text/markdown";
  if (name.endsWith(".txt")) return "text/plain";
  return "text/plain";
}

/**
 * Read text from filesystem path (Node.js only).
 * @param {string} path
 * @param {{allowPathRead?:boolean}} options
 * @returns {Promise<{text:string,size:number}>}
 */
async function readTextFromPath(path, { allowPathRead = false } = {}) {
  if (!allowPathRead) {
    throw new Error("MarkdownAdapter: path string inputs are disabled (set allowPathRead:true to enable in Node.js)");
  }
  return nodeReadTextFromPath(path);
}

/**
 * Extract basename from path (Node.js or fallback to split).
 * @param {string} path
 * @returns {Promise<string>}
 */
async function basenameOfPath(path) {
  if (isNodeEnvironment()) {
    return nodeBasenameOfPath(path);
  }
  // Fallback for non-Node environments
  const parts = String(path || "").split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function decodeUtf8(data) {
  const buf =
    data instanceof ArrayBuffer
      ? data
      : ArrayBuffer.isView(data)
        ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
        : new ArrayBuffer(0);
  try {
    return new TextDecoder("utf-8").decode(new Uint8Array(buf));
  } catch {
    return String(buf || "");
  }
}

export class MarkdownAdapter extends BaseAdapter {
  constructor(options = {}) {
    super({ ...options, adapterName: "markdown" });
  }

  /**
   * @param {string|{name?:string,type?:string,size?:number,text?:Function,arrayBuffer?:Function}} input
   * @param {{allowPathRead?:boolean}=} stageApi
   * @returns {Promise<object>} ParsedDocument
   */
  async parse(input, stageApi = {}) {
    const t0 = Date.now();
    const allowPathRead = stageApi?.allowPathRead === true;

    let filename = "";
    let mimeType = "";
    let size = undefined;
    let markdown = "";

    if (typeof input === "string") {
      filename = await basenameOfPath(input);
      mimeType = guessMimeType(filename);
      const res = await readTextFromPath(input, { allowPathRead });
      size = res.size;
      markdown = res.text;
    } else if (input && typeof input === "object") {
      filename = toNonEmptyString(input.name) || toNonEmptyString(input.filename) || "untitled.md";
      mimeType = toNonEmptyString(input.type) || guessMimeType(filename);
      size = Number.isFinite(input.size) ? input.size : undefined;

      if (typeof input.text === "function") {
        markdown = String(await input.text());
      } else if (typeof input.arrayBuffer === "function") {
        const ab = await input.arrayBuffer();
        markdown = decodeUtf8(ab);
        size = size ?? (ab instanceof ArrayBuffer ? ab.byteLength : ArrayBuffer.isView(ab) ? ab.byteLength : undefined);
      } else if (isPlainObject(input) && typeof input.content === "string") {
        markdown = input.content;
      } else {
        throw new Error("MarkdownAdapter.parse(input): unsupported file-like input");
      }
    } else {
      throw new TypeError("MarkdownAdapter.parse(input): input must be a path string or a file-like object");
    }

    const title = filename;
    const parsed = this.buildParsedDocument({
      sourceType: SourceKind.MARKDOWN,
      origin: { filename, mimeType, size },
      markdown,
      assets: [],
      metadata: { title },
      parseInfo: { adapter: "markdown", durationMs: Date.now() - t0 },
    });

    return parsed;
  }
}

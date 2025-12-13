import { BaseAdapter } from "./base.js";

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function toNonEmptyString(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function guessMimeType(filename) {
  const name = String(filename || "").toLowerCase();
  if (name.endsWith(".md") || name.endsWith(".markdown")) return "text/markdown";
  if (name.endsWith(".txt")) return "text/plain";
  return "text/plain";
}

async function readTextFromPath(path) {
  const { readFile } = await import("node:fs/promises");
  const buf = await readFile(path);
  return { text: buf.toString("utf8"), size: buf.length };
}

async function basenameOfPath(path) {
  const { basename } = await import("node:path");
  return basename(path);
}

export class MarkdownAdapter extends BaseAdapter {
  constructor(options = {}) {
    super({ ...options, adapterName: "markdown" });
  }

  /**
   * @param {string|{name?:string,type?:string,size?:number,text?:Function,arrayBuffer?:Function}} input
   * @returns {Promise<object>} ParsedDocument
   */
  async parse(input) {
    const t0 = Date.now();

    let filename = "";
    let mimeType = "";
    let size = undefined;
    let markdown = "";

    if (typeof input === "string") {
      filename = await basenameOfPath(input);
      mimeType = guessMimeType(filename);
      const res = await readTextFromPath(input);
      size = res.size;
      markdown = res.text;
    } else if (input && typeof input === "object") {
      filename = toNonEmptyString(input.name) || toNonEmptyString(input.filename) || "untitled.md";
      mimeType = toNonEmptyString(input.type) || guessMimeType(filename);
      size = Number.isFinite(input.size) ? input.size : undefined;

      if (typeof input.text === "function") {
        markdown = String(await input.text());
      } else if (typeof input.arrayBuffer === "function") {
        const buf = Buffer.from(await input.arrayBuffer());
        markdown = buf.toString("utf8");
        size = size ?? buf.length;
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
      sourceType: "markdown",
      origin: { filename, mimeType, size },
      markdown,
      assets: [],
      metadata: { title },
      parseInfo: { adapter: "markdown", durationMs: Date.now() - t0 },
    });

    return parsed;
  }
}


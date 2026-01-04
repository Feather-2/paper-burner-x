import { BaseAdapter } from "./base.js";

import { isPlainObject, toNonEmptyString } from "../../shared/utils/value-utils.js";
function guessMimeTypeFromNameOrData(name, data) {
  const d = String(data || "");
  if (d.startsWith("data:")) {
    const semi = d.indexOf(";");
    const comma = d.indexOf(",");
    const end = semi > 5 ? semi : comma;
    const mime = d.slice("data:".length, end);
    return toNonEmptyString(mime) || "application/octet-stream";
  }

  const n = String(name || "").toLowerCase();
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".gif")) return "image/gif";
  if (n.endsWith(".svg")) return "image/svg+xml";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

function getStorageGetter(storageAdapter) {
  const fn =
    storageAdapter?.getResultFromDB ||
    storageAdapter?.getResult ||
    storageAdapter?.getHistory ||
    storageAdapter?.loadHistory ||
    storageAdapter?.get;
  return typeof fn === "function" ? fn.bind(storageAdapter) : null;
}

export class HistoryAdapter extends BaseAdapter {
  constructor(storageAdapter, options = {}) {
    super({ ...options, adapterName: "history" });
    this.storageAdapter = storageAdapter || null;
  }

  /**
   * @param {string} historyId
   * @returns {Promise<object>} ParsedDocument
   */
  async parse(historyId) {
    const t0 = Date.now();
    const hid = toNonEmptyString(historyId);
    if (!hid) throw new TypeError("HistoryAdapter.parse(historyId): historyId must be a string");

    const getter = getStorageGetter(this.storageAdapter);
    if (!getter) throw new Error("HistoryAdapter.parse(historyId): storageAdapter with getResultFromDB() is required");

    const record = await getter(hid);
    if (!record) throw new Error(`HistoryAdapter.parse(historyId): history record not found: ${hid}`);

    const markdown = toNonEmptyString(record.translation) || toNonEmptyString(record.ocr) || toNonEmptyString(record.markdown) || "";
    if (!markdown) throw new Error(`HistoryAdapter.parse(historyId): history record missing markdown/ocr: ${hid}`);

    const title = toNonEmptyString(record.name) || toNonEmptyString(record.title) || hid;
    const fileType = toNonEmptyString(record.fileType) || toNonEmptyString(record.sourceType) || "markdown";

    const images = Array.isArray(record.images) ? record.images : [];
    const assets = images
      .map((img, i) => {
        if (!img) return null;
        const name = toNonEmptyString(img.id) || toNonEmptyString(img.name) || `image_${i + 1}.png`;
        const data = toNonEmptyString(img.data) || (typeof img === "string" ? img : undefined);
        if (!data) return null;
        const mimeType = guessMimeTypeFromNameOrData(name, data);
        return {
          assetId: `asset_${hid}_${i + 1}`,
          docId: "", // filled after docId is computed
          type: "image",
          data,
          mimeType,
          source: "extracted",
          reusable: true,
        };
      })
      .filter(Boolean);

    const parsed = this.buildParsedDocument({
      sourceType: fileType,
      origin: { historyId: hid, filename: title },
      markdown,
      assets,
      metadata: { title, historyId: hid, fileType },
      parseInfo: { adapter: "history", durationMs: Date.now() - t0 },
    });

    for (const a of parsed.assets) a.docId = parsed.docId;
    return parsed;
  }
}


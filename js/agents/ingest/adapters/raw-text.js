import { BaseAdapter } from "./base.js";
import { SourceKind } from "../constants.js";

import { toNonEmptyString } from "../../shared/utils/value-utils.js";
export class RawTextAdapter extends BaseAdapter {
  constructor(options = {}) {
    super({ ...options, adapterName: "raw_text" });
  }

  /**
   * @param {{text:string,title?:string}|string} input
   * @returns {Promise<object>} ParsedDocument
   */
  async parse(input) {
    const t0 = Date.now();
    const text = typeof input === "string" ? input : String(input?.text || "");
    const title = toNonEmptyString(typeof input === "string" ? undefined : input?.title) || "User Input";

    if (!text.trim()) throw new Error("RawTextAdapter.parse(input): input.text is required");

    return this.buildParsedDocument({
      sourceType: SourceKind.USER_TEXT,
      origin: { title },
      markdown: text,
      assets: [],
      metadata: { title },
      parseInfo: { adapter: "raw_text", durationMs: Date.now() - t0 },
    });
  }
}


import { describe, it } from "node:test";
import assert from "node:assert";

import { CicadaCompressor } from "../../../js/agents/runtime/compression/cicada-compressor.js";

describe("CicadaCompressor", () => {
  describe("SESSION_HISTORY", () => {
    it("merges only merge-safe messages and preserves metadata-bearing messages", async () => {
      const compressor = new CicadaCompressor({ layers: ["session_history"] });

      const input = {
        messages: [
          { role: "assistant", content: "a" },
          { role: "assistant", content: "b" },
          { role: "assistant", content: "c", id: "m3" },
          { role: "assistant", content: "d", id: "m4" },
        ],
      };

      const { context, metadata } = await compressor.compress(input, { layers: ["session_history"], keepLastTurns: 10 });

      assert.ok(context);
      assert.ok(Array.isArray(context.messages));
      assert.strictEqual(context.messages.length, 3);
      assert.strictEqual(context.messages[0].content, "a\nb");
      assert.strictEqual(context.messages[1].id, "m3");
      assert.strictEqual(context.messages[2].id, "m4");
      assert.strictEqual(metadata?.stats?.sessionHistory?.mergedMessages, 1);
    });
  });
});


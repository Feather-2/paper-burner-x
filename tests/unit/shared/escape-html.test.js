import { describe, it, expect } from "vitest";

import { escapeHtml } from '../../../js/shared/utils/escape-html.js';

describe("shared/utils/escape-html.js", () => {
  describe("escapeHtml", () => {
    it("escapes basic HTML special characters", () => {
      const cases = [
        ["&", "&amp;"],
        ["<", "&lt;"],
        [">", "&gt;"],
        ['"', "&quot;"],
        ["'", "&#39;"],
      ];

      for (const [input, expected] of cases) {
        expect(escapeHtml(input)).toBe(expected);
      }
    });

    it("handles empty string", () => {
      expect(escapeHtml("")).toBe("");
    });

    it("handles null/undefined", () => {
      expect(escapeHtml(null)).toBe("");
      expect(escapeHtml(undefined)).toBe("");
      expect(escapeHtml()).toBe("");
    });

    it("handles non-string inputs", () => {
      expect(escapeHtml(0)).toBe("");
      expect(escapeHtml(false)).toBe("");
      expect(escapeHtml({})).toBe("");
      expect(escapeHtml([])).toBe("");
    });

    it("escapes mixed content correctly", () => {
      const input = `Hello & welcome <b>"O'Reilly"</b> > 2`;
      const expected = `Hello &amp; welcome &lt;b&gt;&quot;O&#39;Reilly&quot;&lt;/b&gt; &gt; 2`;
      expect(escapeHtml(input)).toBe(expected);
    });
  });
});


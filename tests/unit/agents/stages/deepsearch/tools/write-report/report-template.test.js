import { describe, it, expect, vi, beforeEach } from "vitest";

const externalMock = vi.hoisted(() => ({
  getPayload: vi.fn(() => "external payload"),
}));

vi.mock(
  "virtual:report-template-dependency",
  () => ({
    getPayload: externalMock.getPayload,
  }),
  { virtual: true }
);

import reportTemplateDefault, {
  renderReportTemplate,
  REPORT_TEMPLATE,
} from "../../../../../../../js/agents/stages/deepsearch/tools/write-report/report-template.js";

beforeEach(() => {
  vi.clearAllMocks();
  externalMock.getPayload.mockReturnValue("external payload");
});

function expectTemplateReturn(value) {
  let result;
  expect(() => {
    result = renderReportTemplate(value);
  }).not.toThrow();
  expect(result).toBe(REPORT_TEMPLATE);
}

describe("REPORT_TEMPLATE", () => {
  it("is a non-empty string with required headings and citation rules", () => {
    expect(typeof REPORT_TEMPLATE).toBe("string");
    expect(REPORT_TEMPLATE.trim().length).toBeGreaterThan(0);
    expect(REPORT_TEMPLATE).toContain("## 报告结构要求");
    expect(REPORT_TEMPLATE).toContain("### 必需章节");
    expect(REPORT_TEMPLATE).toContain("### 学术规范");
    expect(REPORT_TEMPLATE).toContain("[来源:页码]");
  });

  it("includes the numbered sections and confidence label", () => {
    expect(REPORT_TEMPLATE).toContain("1. **摘要**");
    expect(REPORT_TEMPLATE).toContain("2. **核心发现**");
    expect(REPORT_TEMPLATE).toContain("3. **共识与分歧**");
    expect(REPORT_TEMPLATE).toContain("4. **信息缺口**");
    expect(REPORT_TEMPLATE).toContain("5. **结论与建议**");
    expect(REPORT_TEMPLATE).toContain("置信度标注");
  });
});

describe("renderReportTemplate", () => {
  it("returns the REPORT_TEMPLATE string for the normal path", () => {
    expect(renderReportTemplate()).toBe(REPORT_TEMPLATE);
  });

  it("ignores nullish and empty inputs without throwing", () => {
    const cases = [null, undefined, "", "   ", [], {}];
    cases.forEach((value) => {
      expectTemplateReturn(value);
    });
  });

  it("handles numeric and type boundary inputs", () => {
    const arrayLike = { 0: "x", length: 1 };
    const cases = [0, -1, Number.MAX_SAFE_INTEGER, "123", arrayLike];
    cases.forEach((value) => {
      expectTemplateReturn(value);
    });
  });

  it("handles resource-heavy inputs, including mocked external payloads", async () => {
    const { getPayload } = await import("virtual:report-template-dependency");
    const hugeFile = "line\n".repeat(20000);
    const longString = "x".repeat(200000);

    const deepNested = {};
    let cursor = deepNested;
    for (let i = 0; i < 200; i += 1) {
      cursor.next = {};
      cursor = cursor.next;
    }

    externalMock.getPayload.mockReturnValueOnce(hugeFile);
    const externalPayload = getPayload();

    expectTemplateReturn(externalPayload);
    expectTemplateReturn(longString);
    expectTemplateReturn(deepNested);
    expect(getPayload).toHaveBeenCalledTimes(1);
  });

  it("supports concurrent calls", async () => {
    const results = await Promise.all(
      Array.from({ length: 25 }, () => Promise.resolve(renderReportTemplate()))
    );
    expect(results.every((value) => value === REPORT_TEMPLATE)).toBe(true);
  });

  it("supports rapid consecutive calls", () => {
    for (let i = 0; i < 500; i += 1) {
      expect(renderReportTemplate()).toBe(REPORT_TEMPLATE);
    }
  });
});

describe("default export", () => {
  it("exposes REPORT_TEMPLATE and renderReportTemplate", () => {
    expect(reportTemplateDefault).toEqual(
      expect.objectContaining({
        REPORT_TEMPLATE,
        renderReportTemplate,
      })
    );
    expect(reportTemplateDefault.renderReportTemplate()).toBe(REPORT_TEMPLATE);
  });
});

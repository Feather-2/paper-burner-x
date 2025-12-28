/**
 * Design Phases 单元测试
 *
 * 测试阶段处理函数的辅助逻辑（不涉及完整 loop 执行）
 */
import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert";

// 测试辅助函数（从 design-phases.js 提取的纯函数逻辑）
function hasImagePlanningConfig(constraints) {
  if (!constraints || typeof constraints !== "object") return false;
  return (
    Object.prototype.hasOwnProperty.call(constraints, "imagePolicy") ||
    Object.prototype.hasOwnProperty.call(constraints, "imageBudget")
  );
}

function estimateSlotCostUSD(slot) {
  const style = String(slot?.style || "").toLowerCase();
  if (style.includes("3d") || style.includes("photo") || style.includes("hd") || style.includes("cinematic")) {
    return 0.04;
  }
  return 0.003;
}

describe("design-phases helpers", () => {
  describe("hasImagePlanningConfig", () => {
    it("should return false for null/undefined", () => {
      assert.strictEqual(hasImagePlanningConfig(null), false);
      assert.strictEqual(hasImagePlanningConfig(undefined), false);
    });

    it("should return false for non-object", () => {
      assert.strictEqual(hasImagePlanningConfig("string"), false);
      assert.strictEqual(hasImagePlanningConfig(123), false);
    });

    it("should return false for empty object", () => {
      assert.strictEqual(hasImagePlanningConfig({}), false);
    });

    it("should return true when imagePolicy is present", () => {
      assert.strictEqual(hasImagePlanningConfig({ imagePolicy: "balanced" }), true);
      assert.strictEqual(hasImagePlanningConfig({ imagePolicy: null }), true); // key exists
    });

    it("should return true when imageBudget is present", () => {
      assert.strictEqual(hasImagePlanningConfig({ imageBudget: 10 }), true);
      assert.strictEqual(hasImagePlanningConfig({ imageBudget: 0 }), true);
    });

    it("should return true when both are present", () => {
      assert.strictEqual(hasImagePlanningConfig({ imagePolicy: "aggressive", imageBudget: 20 }), true);
    });

    it("should return false for unrelated keys", () => {
      assert.strictEqual(hasImagePlanningConfig({ maxSlides: 10, tone: "formal" }), false);
    });
  });

  describe("estimateSlotCostUSD", () => {
    it("should return 0.003 for basic slots", () => {
      assert.strictEqual(estimateSlotCostUSD({}), 0.003);
      assert.strictEqual(estimateSlotCostUSD({ style: "flat" }), 0.003);
      assert.strictEqual(estimateSlotCostUSD({ style: "minimal" }), 0.003);
      assert.strictEqual(estimateSlotCostUSD({ style: "illustration" }), 0.003);
    });

    it("should return 0.04 for 3D style", () => {
      assert.strictEqual(estimateSlotCostUSD({ style: "3d" }), 0.04);
      assert.strictEqual(estimateSlotCostUSD({ style: "3D render" }), 0.04);
      assert.strictEqual(estimateSlotCostUSD({ style: "isometric 3d" }), 0.04);
    });

    it("should return 0.04 for photo style", () => {
      assert.strictEqual(estimateSlotCostUSD({ style: "photo" }), 0.04);
      assert.strictEqual(estimateSlotCostUSD({ style: "photorealistic" }), 0.04);
      assert.strictEqual(estimateSlotCostUSD({ style: "stock photo" }), 0.04);
    });

    it("should return 0.04 for HD style", () => {
      assert.strictEqual(estimateSlotCostUSD({ style: "hd" }), 0.04);
      assert.strictEqual(estimateSlotCostUSD({ style: "HD quality" }), 0.04);
      assert.strictEqual(estimateSlotCostUSD({ style: "ultra hd" }), 0.04);
    });

    it("should return 0.04 for cinematic style", () => {
      assert.strictEqual(estimateSlotCostUSD({ style: "cinematic" }), 0.04);
      assert.strictEqual(estimateSlotCostUSD({ style: "cinematic lighting" }), 0.04);
    });

    it("should handle null/undefined slot", () => {
      assert.strictEqual(estimateSlotCostUSD(null), 0.003);
      assert.strictEqual(estimateSlotCostUSD(undefined), 0.003);
    });

    it("should be case insensitive", () => {
      assert.strictEqual(estimateSlotCostUSD({ style: "PHOTO" }), 0.04);
      assert.strictEqual(estimateSlotCostUSD({ style: "Cinematic" }), 0.04);
      assert.strictEqual(estimateSlotCostUSD({ style: "3D" }), 0.04);
    });
  });

  describe("cost estimation aggregation", () => {
    it("should calculate total cost for multiple slots", () => {
      const slots = [
        { slotId: "img1", style: "flat" },
        { slotId: "img2", style: "3d" },
        { slotId: "img3", style: "photo" },
        { slotId: "img4", style: "minimal" },
      ];
      const totalCost = slots.reduce((sum, s) => sum + estimateSlotCostUSD(s), 0);
      // 0.003 + 0.04 + 0.04 + 0.003 = 0.086
      assert.ok(Math.abs(totalCost - 0.086) < 0.0001, `Expected ~0.086, got ${totalCost}`);
    });

    it("should handle empty slots array", () => {
      const totalCost = [].reduce((sum, s) => sum + estimateSlotCostUSD(s), 0);
      assert.strictEqual(totalCost, 0);
    });
  });
});

describe("design-phases emitStage helper", () => {
  function emitStage(emit, name, status, payload) {
    emit?.(name, { actor: "design", status, payload });
  }

  it("should call emit with correct structure", () => {
    const emitFn = mock.fn();
    emitStage(emitFn, "design.tokens.ended", "ended", { theme: "dark" });

    assert.strictEqual(emitFn.mock.calls.length, 1);
    const [eventName, eventData] = emitFn.mock.calls[0].arguments;
    assert.strictEqual(eventName, "design.tokens.ended");
    assert.strictEqual(eventData.actor, "design");
    assert.strictEqual(eventData.status, "ended");
    assert.deepStrictEqual(eventData.payload, { theme: "dark" });
  });

  it("should handle null emit gracefully", () => {
    assert.doesNotThrow(() => {
      emitStage(null, "design.test", "test", {});
    });
  });

  it("should handle undefined emit gracefully", () => {
    assert.doesNotThrow(() => {
      emitStage(undefined, "design.test", "test", {});
    });
  });
});

describe("design-phases QA validation flow", () => {
  // 模拟 QA 验证逻辑
  function simulateQaFlow(slideHtml, validateFn, buildFallbackFn, slideIntent, designSystem) {
    let qa = validateFn(slideHtml);
    let degraded = false;
    let currentHtml = slideHtml;

    if (!qa.pass) {
      degraded = true;
      currentHtml = buildFallbackFn(slideIntent, designSystem, { safeMode: true });
      qa = validateFn(currentHtml);
    }

    if (!qa.pass) {
      currentHtml = buildFallbackFn({ ...slideIntent, keyPoints: [] }, designSystem, { safeMode: true });
      qa = validateFn(currentHtml);
    }

    return { html: currentHtml, qa, degraded };
  }

  it("should pass through valid HTML", () => {
    const validateFn = () => ({ pass: true });
    const buildFallbackFn = () => "<section>Fallback</section>";

    const result = simulateQaFlow(
      "<section>Valid</section>",
      validateFn,
      buildFallbackFn,
      { title: "Test" },
      {}
    );

    assert.strictEqual(result.html, "<section>Valid</section>");
    assert.strictEqual(result.qa.pass, true);
    assert.strictEqual(result.degraded, false);
  });

  it("should degrade on first QA failure", () => {
    let callCount = 0;
    const validateFn = () => {
      callCount++;
      return { pass: callCount > 1 }; // First call fails, second passes
    };
    const buildFallbackFn = () => "<section>SafeMode</section>";

    const result = simulateQaFlow(
      "<section>Invalid</section>",
      validateFn,
      buildFallbackFn,
      { title: "Test" },
      {}
    );

    assert.strictEqual(result.html, "<section>SafeMode</section>");
    assert.strictEqual(result.qa.pass, true);
    assert.strictEqual(result.degraded, true);
  });

  it("should double-degrade on persistent QA failure", () => {
    let callCount = 0;
    const validateFn = () => {
      callCount++;
      return { pass: callCount > 2 }; // First two calls fail
    };
    const buildFallbackFn = (intent, ds, opts) => {
      if (intent.keyPoints?.length === 0) {
        return "<section>MinimalFallback</section>";
      }
      return "<section>SafeMode</section>";
    };

    const result = simulateQaFlow(
      "<section>Invalid</section>",
      validateFn,
      buildFallbackFn,
      { title: "Test", keyPoints: ["a", "b"] },
      {}
    );

    assert.strictEqual(result.html, "<section>MinimalFallback</section>");
    assert.strictEqual(result.qa.pass, true);
    assert.strictEqual(result.degraded, true);
  });
});

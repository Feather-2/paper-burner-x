import { afterEach, describe, expect, it, vi } from "vitest";

import { alignClaimsToSlides, createStageEmitter } from "../../../../../js/agents/stages/textprep/textprep-helpers.js";

describe("createStageEmitter", () => {
  it("emits completed status by default", () => {
    const api = { emit: vi.fn() };
    const emit = createStageEmitter(api);

    emit("textprep.step.completed", { ok: true });
    expect(api.emit).toHaveBeenCalledWith("textprep:step:completed", {
      actor: "textprep",
      status: "completed",
      payload: { ok: true },
    });
  });

  it("supports explicit status overrides", () => {
    const api = { emit: vi.fn() };
    const emit = createStageEmitter(api);

    emit("textprep.step.progress", { pct: 50 }, "progress");
    expect(api.emit).toHaveBeenCalledWith("textprep:step:progress", {
      actor: "textprep",
      status: "progress",
      payload: { pct: 50 },
    });
  });
});

describe("alignClaimsToSlides", () => {
  const previousGlobal = globalThis.aiApiService;

  afterEach(() => {
    globalThis.aiApiService = previousGlobal;
  });

  it("does not use global aiApiService by default", async () => {
    globalThis.aiApiService = { chat: vi.fn(async () => ({ content: "[]" })) };

    const slides = [{ slideIntentId: "s1", pageType: "detail" }];
    const claims = [{ claimId: "c1", text: "t1" }];

    const aligned = await alignClaimsToSlides(slides, claims, {});

    expect(globalThis.aiApiService.chat).not.toHaveBeenCalled();
    expect(aligned).toEqual([{ slideIntentId: "s1", pageType: "detail", claimIds: ["c1"] }]);
  });

  it("can opt-in to global aiApiService fallback", async () => {
    globalThis.aiApiService = {
      chat: vi.fn(async () => ({
        content: JSON.stringify([{ slideIntentId: "s1", claimIds: ["c1"] }]),
      })),
    };

    const slides = [{ slideIntentId: "s1", pageType: "detail" }];
    const claims = [{ claimId: "c1", text: "t1" }];

    const aligned = await alignClaimsToSlides(slides, claims, { allowGlobalAiApiService: true });

    expect(globalThis.aiApiService.chat).toHaveBeenCalledTimes(1);
    expect(aligned).toEqual([{ slideIntentId: "s1", pageType: "detail", claimIds: ["c1"] }]);
  });
});

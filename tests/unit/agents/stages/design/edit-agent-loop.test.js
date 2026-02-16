import { describe, it, expect, vi, beforeEach } from "vitest";

const runtimeMocks = vi.hoisted(() => {
  class BaseAgentLoop {
    constructor(options = {}) {
      this.options = options;
      this.emit = vi.fn();
      this.userActionHandler = { waitForUserAction: vi.fn() };
    }
  }

  return {
    BaseAgentLoop,
    checkCancelled: vi.fn(),
    getEmitFn: vi.fn(),
    AgentStatus: { IDLE: "idle", RUNNING: "running" },
  };
});

const analyzerMocks = vi.hoisted(() => ({ createDeckAnalyzer: vi.fn() }));
const editorMocks = vi.hoisted(() => ({ createDeckEditor: vi.fn() }));
const stitcherMocks = vi.hoisted(() => ({ createScreenshotStitcher: vi.fn() }));

const blackboardMocks = vi.hoisted(() => {
  const instances = [];
  class DesignBlackboard {
    constructor(options = {}) {
      this.options = options;
      this.saveVersion = vi.fn();
      instances.push(this);
    }
  }
  return { DesignBlackboard, instances };
});

const refinerMocks = vi.hoisted(() => ({ parseSections: vi.fn() }));

const editModeMocks = vi.hoisted(() => {
  const instances = [];
  class EditModeAgentLoop {
    constructor(options = {}) {
      this.options = options;
      this._interpretIntent = vi.fn();
      instances.push(this);
    }
  }
  return { EditModeAgentLoop, instances };
});

vi.mock("../../../../../js/agents/runtime/index.js", () => runtimeMocks);
vi.mock("../../../../../js/agents/stages/design/internal/deck-analyzer.js", () => ({
  createDeckAnalyzer: analyzerMocks.createDeckAnalyzer,
}));
vi.mock("../../../../../js/agents/stages/design/internal/deck-editor.js", () => ({
  createDeckEditor: editorMocks.createDeckEditor,
}));
vi.mock("../../../../../js/agents/stages/design/internal/screenshot-stitcher.js", () => ({
  createScreenshotStitcher: stitcherMocks.createScreenshotStitcher,
}));
vi.mock("../../../../../js/agents/stages/design/internal/design-blackboard.js", () => ({
  DesignBlackboard: blackboardMocks.DesignBlackboard,
}));
vi.mock("../../../../../js/agents/stages/design/refiner/react-refiner-tools.js", () => ({
  parseSections: refinerMocks.parseSections,
}));
vi.mock("../../../../../js/agents/stages/design/edit-mode/edit-loop.js", () => ({
  EditModeAgentLoop: editModeMocks.EditModeAgentLoop,
}));

import {
  EditRequestType,
  EditState,
  EditAgentLoop,
  createEditAgentLoop,
} from "../../../../../js/agents/stages/design/edit-agent-loop.js";

const makeLargeString = (size = 20000) => "x".repeat(size);
const makeDeepObject = (depth = 6) => {
  const root = {};
  let cursor = root;
  for (let i = 0; i < depth; i += 1) {
    cursor.child = {};
    cursor = cursor.child;
  }
  cursor.value = "leaf";
  return root;
};

let analyzer;
let editor;
let stitcher;

beforeEach(() => {
  vi.clearAllMocks();

  analyzer = {
    collectAllDsl: vi.fn().mockReturnValue([]),
    analyzeStyleConsistency: vi.fn().mockReturnValue({}),
    locateElement: vi.fn().mockReturnValue(null),
  };
  analyzerMocks.createDeckAnalyzer.mockReturnValue(analyzer);

  editor = {
    setDeckPackage: vi.fn(),
    getDeckHtmlDsl: vi.fn().mockReturnValue(""),
    editElement: vi.fn().mockResolvedValue({ success: true }),
    undo: vi.fn().mockReturnValue({ success: true }),
    redo: vi.fn().mockReturnValue({ success: true }),
  };
  editorMocks.createDeckEditor.mockReturnValue(editor);

  stitcher = { stitch: vi.fn() };
  stitcherMocks.createScreenshotStitcher.mockReturnValue(stitcher);

  refinerMocks.parseSections.mockReturnValue([]);

  runtimeMocks.getEmitFn.mockReturnValue(undefined);
  runtimeMocks.checkCancelled.mockImplementation(() => {});
  blackboardMocks.instances.length = 0;
  editModeMocks.instances.length = 0;
});

describe("EditRequestType", () => {
  it("exposes expected request types", () => {
    expect(EditRequestType).toEqual({
      ELEMENT: "element",
      IMAGE: "image",
      REGION: "region",
      VERBAL: "verbal",
      GLOBAL: "global",
    });
  });

  it("provides unique string values", () => {
    const values = Object.values(EditRequestType);
    expect(values.every((value) => typeof value === "string")).toBe(true);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("EditState", () => {
  it("exposes expected edit states", () => {
    expect(EditState).toEqual({
      IDLE: "idle",
      WAITING: "waiting",
      PROCESSING: "processing",
      COMPLETED: "completed",
    });
  });

  it("provides unique string values", () => {
    const values = Object.values(EditState);
    expect(values.every((value) => typeof value === "string")).toBe(true);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("createEditAgentLoop", () => {
  it("creates an EditAgentLoop instance with provided dependencies", () => {
    const customAnalyzer = {
      collectAllDsl: vi.fn(),
      analyzeStyleConsistency: vi.fn(),
      locateElement: vi.fn(),
    };
    const customEditor = {
      setDeckPackage: vi.fn(),
      getDeckHtmlDsl: vi.fn(),
      editElement: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
    };
    const customStitcher = { stitch: vi.fn() };

    const loop = createEditAgentLoop({
      analyzer: customAnalyzer,
      editor: customEditor,
      stitcher: customStitcher,
    });

    expect(loop).toBeInstanceOf(EditAgentLoop);
    expect(loop._analyzer).toBe(customAnalyzer);
    expect(loop._editor).toBe(customEditor);
    expect(loop._stitcher).toBe(customStitcher);
    expect(analyzerMocks.createDeckAnalyzer).not.toHaveBeenCalled();
    expect(editorMocks.createDeckEditor).not.toHaveBeenCalled();
    expect(stitcherMocks.createScreenshotStitcher).not.toHaveBeenCalled();
  });
});

describe("EditAgentLoop", () => {
  it("initializes defaults and tool wiring", () => {
    const eventBus = { id: "bus" };
    const loop = new EditAgentLoop({
      eventBus,
      runId: "run-1",
      modelRouter: "router",
      editTools: { alpha: true },
    });

    expect(loop.options).toEqual({ actor: "edit", stageName: "edit", eventBus });
    expect(loop._deckPackage).toEqual({ deckHtmlDsl: "", slidesMeta: [] });
    expect(loop._designSystem).toEqual({});
    expect(loop._contentPackage).toEqual({});
    expect(loop._analyzer).toBe(analyzer);
    expect(loop._editor).toBe(editor);
    expect(loop._stitcher).toBe(stitcher);
    expect(loop._state).toBe(EditState.IDLE);
    expect(loop._editHistory).toEqual([]);
    expect(loop._maxHistory).toBe(50);
    expect(blackboardMocks.instances[0].options).toEqual({ runId: "run-1" });
    expect(editModeMocks.instances[0].options).toEqual({
      modelRouter: "router",
      tools: { alpha: true },
    });
    expect(editorMocks.createDeckEditor).toHaveBeenCalledWith({
      deckPackage: loop._deckPackage,
    });
  });

  it("uses provided dependencies instead of factories", () => {
    const customAnalyzer = {
      collectAllDsl: vi.fn(),
      analyzeStyleConsistency: vi.fn(),
      locateElement: vi.fn(),
    };
    const customEditor = {
      setDeckPackage: vi.fn(),
      getDeckHtmlDsl: vi.fn(),
      editElement: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
    };
    const customStitcher = { stitch: vi.fn() };
    const deckPackage = { deckHtmlDsl: "custom", slidesMeta: [1] };

    const loop = new EditAgentLoop({
      analyzer: customAnalyzer,
      editor: customEditor,
      stitcher: customStitcher,
      deckPackage,
    });

    expect(loop._analyzer).toBe(customAnalyzer);
    expect(loop._editor).toBe(customEditor);
    expect(loop._stitcher).toBe(customStitcher);
    expect(loop._deckPackage).toBe(deckPackage);
    expect(analyzerMocks.createDeckAnalyzer).not.toHaveBeenCalled();
    expect(editorMocks.createDeckEditor).not.toHaveBeenCalled();
    expect(stitcherMocks.createScreenshotStitcher).not.toHaveBeenCalled();
  });

  it("setDeckPackage updates deck and forwards to editor", () => {
    const loop = new EditAgentLoop();
    const nextPackage = { deckHtmlDsl: "next", slidesMeta: [1] };
    loop.setDeckPackage(nextPackage);
    expect(loop._deckPackage).toBe(nextPackage);
    expect(editor.setDeckPackage).toHaveBeenCalledWith(nextPackage);
  });

  it("setDeckPackage accepts null and forwards to editor", () => {
    const loop = new EditAgentLoop();
    loop.setDeckPackage(null);
    expect(loop._deckPackage).toBeNull();
    expect(editor.setDeckPackage).toHaveBeenCalledWith(null);
  });

  it("getDeckPackage returns latest html from editor", () => {
    const loop = new EditAgentLoop({
      deckPackage: { deckHtmlDsl: "old", slidesMeta: [1], meta: { a: 1 } },
    });
    editor.getDeckHtmlDsl.mockReturnValue("new");
    const result = loop.getDeckPackage();
    expect(result.deckHtmlDsl).toBe("new");
    expect(result.slidesMeta).toEqual([1]);
    expect(result.meta).toEqual({ a: 1 });
  });

  it("run processes requests and emits lifecycle events", async () => {
    const loop = new EditAgentLoop();
    const emit = vi.fn();
    const signal = { aborted: false };
    runtimeMocks.getEmitFn.mockReturnValue(emit);

    const request = {
      type: EditRequestType.VERBAL,
      action: "edit",
      command: "adjust",
      selection: {},
    };

    loop.userActionHandler.waitForUserAction
      .mockResolvedValueOnce(request)
      .mockResolvedValueOnce({ action: "done" });

    const processSpy = vi.spyOn(loop, "_processEditRequest").mockResolvedValue({
      success: true,
    });
    editor.getDeckHtmlDsl.mockReturnValue("<dsl>");

    const result = await loop.run({
      runId: "run-1",
      eventBus: { id: "bus" },
      timeout: undefined,
      signal,
    });

    expect(runtimeMocks.checkCancelled).toHaveBeenCalledWith(signal);
    expect(loop.userActionHandler.waitForUserAction).toHaveBeenCalledWith(
      "edit_command",
      expect.objectContaining({ eventBus: { id: "bus" }, timeout: 0, signal })
    );
    expect(processSpy).toHaveBeenCalledWith(
      request,
      expect.objectContaining({ emit, signal, runId: "run-1" })
    );

    const blackboard = blackboardMocks.instances[0];
    expect(blackboard.saveVersion).toHaveBeenCalledWith(
      expect.stringMatching(/^edit_/),
      expect.objectContaining({ deckHtmlDsl: "<dsl>", request, result: { success: true } })
    );

    const eventNames = emit.mock.calls.map((call) => call[0]);
    expect(eventNames).toEqual(
      expect.arrayContaining([
        "edit.started",
        "edit.waiting",
        "edit.processing",
        "edit.applied",
        "edit.ended",
      ])
    );
    expect(result.deckHtmlDsl).toBe("<dsl>");
    expect(loop.getState()).toBe(EditState.COMPLETED);
  });

  it("run stops when request is done or empty", async () => {
    const loop = new EditAgentLoop();
    const emit = vi.fn();
    runtimeMocks.getEmitFn.mockReturnValue(emit);
    const processSpy = vi.spyOn(loop, "_processEditRequest");

    loop.userActionHandler.waitForUserAction.mockResolvedValueOnce({ action: "done" });
    await loop.run({ runId: "run-2" });

    expect(loop.userActionHandler.waitForUserAction).toHaveBeenCalledTimes(1);
    expect(processSpy).not.toHaveBeenCalled();
    expect(loop.getState()).toBe(EditState.COMPLETED);
  });

  it("run uses this.emit when no emit fn provided", async () => {
    const loop = new EditAgentLoop();
    runtimeMocks.getEmitFn.mockReturnValue(undefined);

    loop.userActionHandler.waitForUserAction.mockResolvedValueOnce({ action: "done" });
    await loop.run({ runId: "run-3" });

    expect(loop.emit).toHaveBeenCalled();
  });

  it("run handles errors and resets state", async () => {
    const loop = new EditAgentLoop();
    const emit = vi.fn();
    runtimeMocks.getEmitFn.mockReturnValue(emit);

    loop.userActionHandler.waitForUserAction.mockResolvedValueOnce({
      type: EditRequestType.VERBAL,
      action: "edit",
      command: "boom",
      selection: {},
    });

    vi.spyOn(loop, "_processEditRequest").mockRejectedValue(new Error("boom"));

    await expect(loop.run({ runId: "run-4" })).rejects.toThrow("boom");
    expect(loop.getState()).toBe(EditState.IDLE);

    const errorCall = emit.mock.calls.find((call) => call[0] === "edit.error");
    expect(errorCall[1]).toEqual(
      expect.objectContaining({
        actor: "edit",
        status: "error",
        payload: expect.objectContaining({ error: "boom" }),
      })
    );
  });

  it("routes edit requests by type", async () => {
    const loop = new EditAgentLoop();
    loop._handleElementEdit = vi.fn().mockResolvedValue({ success: true, from: "element" });
    loop._handleImageEdit = vi.fn().mockResolvedValue({ success: true, from: "image" });
    loop._handleRegionEdit = vi.fn().mockResolvedValue({ success: true, from: "region" });
    loop._handleVerbalEdit = vi.fn().mockResolvedValue({ success: true, from: "verbal" });
    loop._handleGlobalEdit = vi.fn().mockResolvedValue({ success: true, from: "global" });

    await loop._processEditRequest(
      { type: EditRequestType.ELEMENT, selection: { elementId: "el" } },
      { emit: vi.fn(), signal: null }
    );
    await loop._processEditRequest(
      { type: EditRequestType.IMAGE, selection: { elementId: "img" } },
      { emit: vi.fn(), signal: null }
    );
    await loop._processEditRequest(
      { type: EditRequestType.REGION, selection: { slideIndex: 0 } },
      { emit: vi.fn(), signal: null }
    );
    await loop._processEditRequest(
      { type: EditRequestType.VERBAL, selection: { slideIndex: 1 } },
      { emit: vi.fn(), signal: null }
    );
    await loop._processEditRequest(
      { type: EditRequestType.GLOBAL, command: "all" },
      { emit: vi.fn(), signal: null }
    );

    expect(loop._handleElementEdit).toHaveBeenCalledTimes(1);
    expect(loop._handleImageEdit).toHaveBeenCalledTimes(1);
    expect(loop._handleRegionEdit).toHaveBeenCalledTimes(1);
    expect(loop._handleVerbalEdit).toHaveBeenCalledTimes(1);
    expect(loop._handleGlobalEdit).toHaveBeenCalledTimes(1);
  });

  it("trims history on rapid consecutive calls", async () => {
    const loop = new EditAgentLoop();
    loop._maxHistory = 2;
    loop._handleElementEdit = vi.fn().mockResolvedValue({ success: true });

    await loop._processEditRequest(
      { type: EditRequestType.ELEMENT, selection: { elementId: "a" } },
      { emit: vi.fn(), signal: null }
    );
    await loop._processEditRequest(
      { type: EditRequestType.ELEMENT, selection: { elementId: "b" } },
      { emit: vi.fn(), signal: null }
    );
    await loop._processEditRequest(
      { type: EditRequestType.ELEMENT, selection: { elementId: "c" } },
      { emit: vi.fn(), signal: null }
    );

    const history = loop.getEditHistory();
    expect(history).toHaveLength(2);
    expect(history[0].request.selection.elementId).toBe("b");
    expect(history[1].request.selection.elementId).toBe("c");
  });

  it("supports concurrent edit requests", async () => {
    const loop = new EditAgentLoop();
    loop._handleElementEdit = vi.fn().mockResolvedValue({ success: true });

    await Promise.all([
      loop._processEditRequest(
        { type: EditRequestType.ELEMENT, selection: { elementId: "a" } },
        { emit: vi.fn(), signal: null }
      ),
      loop._processEditRequest(
        { type: EditRequestType.ELEMENT, selection: { elementId: "b" } },
        { emit: vi.fn(), signal: null }
      ),
    ]);

    expect(loop.getEditHistory()).toHaveLength(2);
    expect(loop._handleElementEdit).toHaveBeenCalledTimes(2);
  });

  it("returns error for unknown edit types including null/undefined/empty", async () => {
    const loop = new EditAgentLoop();

    const nullResult = await loop._processEditRequest(
      { type: null },
      { emit: vi.fn(), signal: null }
    );
    const undefinedResult = await loop._processEditRequest(
      { type: undefined },
      { emit: vi.fn(), signal: null }
    );
    const emptyResult = await loop._processEditRequest(
      { type: "" },
      { emit: vi.fn(), signal: null }
    );

    expect(nullResult.success).toBe(false);
    expect(undefinedResult.success).toBe(false);
    expect(emptyResult.success).toBe(false);
    expect(nullResult.error).toContain("Unknown edit type");
    expect(undefinedResult.error).toContain("Unknown edit type");
    expect(emptyResult.error).toContain("Unknown edit type");
  });

  it("handles element edits for generators, changes, and commands", async () => {
    const loop = new EditAgentLoop();
    const resolveSpy = vi.spyOn(loop, "_resolveSelector").mockReturnValue("el1");
    vi.spyOn(loop, "_getElementInfo").mockReturnValue({ tag: "svg" });
    loop._svgGenerator = { generate: vi.fn() };
    const svgSpy = vi.spyOn(loop, "_regenerateSvg").mockResolvedValue({ success: true, from: "svg" });

    const svgResult = await loop._handleElementEdit(
      {
        selection: { slideIndex: 0, selector: 'data-el="el1"' },
        command: "update svg",
      },
      { emit: vi.fn(), signal: null }
    );

    expect(resolveSpy).toHaveBeenCalledWith(0, 'data-el="el1"');
    expect(svgSpy).toHaveBeenCalledWith(0, "el1", "update svg", expect.any(Object));
    expect(svgResult).toEqual({ success: true, from: "svg" });
  });

  it("handles image edits via image generator", async () => {
    const loop = new EditAgentLoop();
    vi.spyOn(loop, "_resolveSelector").mockReturnValue("img1");
    vi.spyOn(loop, "_getElementInfo").mockReturnValue({ tag: "img" });
    loop._imageGenerator = { generate: vi.fn() };
    const imgSpy = vi.spyOn(loop, "_regenerateImage").mockResolvedValue({
      success: true,
      from: "image",
    });

    const result = await loop._handleElementEdit(
      {
        selection: { slideIndex: 1, selector: ".hero" },
        command: "update image",
      },
      { emit: vi.fn(), signal: null }
    );

    expect(imgSpy).toHaveBeenCalledWith(1, "img1", "update image", expect.any(Object));
    expect(result).toEqual({ success: true, from: "image" });
  });

  it("applies direct element changes with deep objects and string slideIndex", async () => {
    const loop = new EditAgentLoop();
    vi.spyOn(loop, "_getElementInfo").mockReturnValue({ tag: "div" });
    const deepChanges = makeDeepObject(8);

    const result = await loop._handleElementEdit(
      {
        selection: { slideIndex: "0", elementId: "el1" },
        changes: deepChanges,
      },
      { emit: vi.fn(), signal: null }
    );

    expect(editor.editElement).toHaveBeenCalledWith("0", "el1", deepChanges);
    expect(result).toEqual({ success: true });
  });

  it("uses AI edit when command provided", async () => {
    const loop = new EditAgentLoop();
    vi.spyOn(loop, "_getElementInfo").mockReturnValue({ tag: "div" });
    const aiSpy = vi.spyOn(loop, "_aiEditElement").mockResolvedValue({
      success: true,
      from: "ai",
    });

    const result = await loop._handleElementEdit(
      {
        selection: { slideIndex: 0, elementId: "el1" },
        command: "refine",
      },
      { emit: vi.fn(), signal: null }
    );

    expect(aiSpy).toHaveBeenCalledWith(0, "el1", "refine", expect.any(Object));
    expect(result).toEqual({ success: true, from: "ai" });
  });

  it("returns errors for missing selectors and empty commands", async () => {
    const loop = new EditAgentLoop();

    const missingResult = await loop._handleElementEdit(
      { selection: {} },
      { emit: vi.fn(), signal: null }
    );
    expect(missingResult).toEqual({
      success: false,
      error: "elementId or selector required",
    });

    const unresolvedSpy = vi.spyOn(loop, "_resolveSelector").mockReturnValue(null);
    const unresolvedResult = await loop._handleElementEdit(
      { selection: { slideIndex: 0, selector: "missing" }, command: "go" },
      { emit: vi.fn(), signal: null }
    );
    expect(unresolvedSpy).toHaveBeenCalled();
    expect(unresolvedResult).toEqual({
      success: false,
      error: "Could not resolve element",
    });

    vi.spyOn(loop, "_getElementInfo").mockReturnValue({ tag: "div" });
    const emptyCommandResult = await loop._handleElementEdit(
      { selection: { slideIndex: 0, elementId: "el1" }, command: "" },
      { emit: vi.fn(), signal: null }
    );
    expect(emptyCommandResult).toEqual({
      success: false,
      error: "No changes or command provided",
    });
  });

  it("handles image edit failures and empty selections", async () => {
    const loop = new EditAgentLoop();
    loop._imageGenerator = null;
    const noGenerator = await loop._handleImageEdit(
      { selection: { slideIndex: 0, elementId: "img1" }, command: "x" },
      { emit: vi.fn(), signal: null }
    );
    expect(noGenerator).toEqual({
      success: false,
      error: "Image generator not available",
    });

    loop._imageGenerator = { generate: vi.fn().mockResolvedValue({}) };
    const failed = await loop._handleImageEdit(
      { selection: { slideIndex: 0, elementId: "img1" }, command: "x" },
      { emit: vi.fn(), signal: null }
    );
    expect(failed).toEqual({ success: false, error: "Image generation failed" });

    loop._imageGenerator = {
      generate: vi.fn().mockResolvedValue({ base64: "data:image/png;base64,aaa" }),
    };
    const emptySelection = await loop._handleImageEdit(
      { selection: {}, command: "x" },
      { emit: vi.fn(), signal: null }
    );
    expect(editor.editElement).toHaveBeenCalledWith(undefined, undefined, {
      attrs: { src: "data:image/png;base64,aaa" },
    });
    expect(emptySelection).toEqual({ success: true });
  });

  it("regenerates images with long commands and slot context", async () => {
    const longCommand = makeLargeString(12000);
    const loop = new EditAgentLoop({
      deckPackage: {
        deckHtmlDsl: "",
        slidesMeta: [],
        imageSlots: [{ slotId: "slot1", prompt: "orig", style: "style1" }],
      },
    });

    loop._imageGenerator = { generate: vi.fn().mockResolvedValue({ url: "http://img" }) };

    const result = await loop._handleImageEdit(
      { selection: { slideIndex: 0, slotId: "slot1" }, command: longCommand },
      { emit: vi.fn(), signal: null }
    );

    expect(loop._imageGenerator.generate).toHaveBeenCalledWith({
      prompt: longCommand,
      originalPrompt: "orig",
      style: "style1",
    });
    expect(editor.editElement).toHaveBeenCalledWith(0, "slot1", {
      attrs: { src: "http://img" },
    });
    expect(result).toEqual({ success: true });
  });

  it("builds region edit context with large inputs", async () => {
    const loop = new EditAgentLoop();
    const largeHtml = `<section>${makeLargeString(20000)}</section>`;
    const longCommand = makeLargeString(1000);
    const deepBbox = makeDeepObject(4);

    refinerMocks.parseSections.mockReturnValue([largeHtml]);
    const aiSpy = vi.spyOn(loop, "_aiAnalyzeAndEdit").mockResolvedValue({ success: true });

    await loop._handleRegionEdit(
      {
        selection: { slideIndex: 0, bbox: deepBbox },
        screenshot: [],
        command: longCommand,
      },
      { emit: vi.fn(), signal: null }
    );

    expect(aiSpy).toHaveBeenCalledWith(
      0,
      expect.objectContaining({
        slideHtml: largeHtml,
        bbox: deepBbox,
        screenshot: [],
        command: longCommand,
      }),
      expect.any(Object)
    );
  });

  it("handles out-of-range region selections", async () => {
    const loop = new EditAgentLoop();
    refinerMocks.parseSections.mockReturnValue(["slide0"]);
    const aiSpy = vi.spyOn(loop, "_aiAnalyzeAndEdit").mockResolvedValue({ success: true });

    await loop._handleRegionEdit(
      { selection: { slideIndex: Number.MAX_SAFE_INTEGER, bbox: {} }, command: "x" },
      { emit: vi.fn(), signal: null }
    );

    expect(aiSpy).toHaveBeenCalledWith(
      Number.MAX_SAFE_INTEGER,
      expect.objectContaining({ slideHtml: "" }),
      expect.any(Object)
    );
  });

  it("handles verbal edits for valid and invalid slide indices", async () => {
    const loop = new EditAgentLoop();
    refinerMocks.parseSections.mockReturnValue(["s0", "s1"]);
    const aiSpy = vi.spyOn(loop, "_aiAnalyzeAndEdit").mockResolvedValue({ success: true });

    await loop._handleVerbalEdit(
      { selection: { slideIndex: "1" }, command: "cmd" },
      { emit: vi.fn(), signal: null }
    );
    expect(aiSpy).toHaveBeenCalledWith("1", { slideHtml: "s1", command: "cmd" }, expect.any(Object));

    const globalSpy = vi.spyOn(loop, "_handleGlobalEdit").mockResolvedValue({ success: true });
    await loop._handleVerbalEdit(
      { selection: { slideIndex: -1 }, command: "cmd" },
      { emit: vi.fn(), signal: null }
    );
    await loop._handleVerbalEdit(
      { selection: { slideIndex: Number.MAX_SAFE_INTEGER }, command: "cmd" },
      { emit: vi.fn(), signal: null }
    );
    expect(globalSpy).toHaveBeenCalledTimes(2);
  });

  it("builds global edit context and delegates to AI", async () => {
    const loop = new EditAgentLoop({ designSystem: { theme: "x" } });
    analyzer.collectAllDsl.mockReturnValue([{ html: "<a>" }, { html: "<b>" }]);
    analyzer.analyzeStyleConsistency.mockReturnValue({ ok: true });
    const globalSpy = vi.spyOn(loop, "_aiGlobalEdit").mockResolvedValue({ success: true });

    await loop._handleGlobalEdit(
      { command: "   " },
      { emit: vi.fn(), signal: null }
    );

    expect(analyzer.collectAllDsl).toHaveBeenCalledWith(loop._deckPackage);
    expect(analyzer.analyzeStyleConsistency).toHaveBeenCalledWith(
      loop._deckPackage,
      loop._designSystem
    );
    expect(globalSpy).toHaveBeenCalledWith(
      expect.objectContaining({ command: "   ", slideCount: 2 }),
      expect.any(Object)
    );
  });

  it("handles empty global edit inputs", async () => {
    const loop = new EditAgentLoop();
    analyzer.collectAllDsl.mockReturnValue([]);
    const globalSpy = vi.spyOn(loop, "_aiGlobalEdit").mockResolvedValue({
      success: false,
      slidesModified: 0,
    });

    await loop._handleGlobalEdit(
      { command: "" },
      { emit: vi.fn(), signal: null }
    );

    expect(globalSpy).toHaveBeenCalledWith(
      expect.objectContaining({ slideCount: 0, allDsl: [] }),
      expect.any(Object)
    );
  });

  it("resolves selectors from null, data attributes, and whitespace", () => {
    const loop = new EditAgentLoop();
    expect(loop._resolveSelector(0, null)).toBeNull();
    expect(loop._resolveSelector(0, undefined)).toBeNull();
    expect(loop._resolveSelector(0, "")).toBeNull();

    refinerMocks.parseSections.mockReturnValue(['<div data-el="el-1"></div>']);
    const dataEl = loop._resolveSelector(0, '<span data-el="el-1"></span>');
    expect(dataEl).toBe("el-1");

    refinerMocks.parseSections.mockReturnValue(["slide"]);
    analyzer.locateElement.mockReturnValue({ element: { elementId: "located" } });
    const whitespace = loop._resolveSelector(0, "   ");
    expect(analyzer.locateElement).toHaveBeenCalledWith("slide", "   ");
    expect(whitespace).toBe("located");

    analyzer.locateElement.mockReturnValue(null);
    const missing = loop._resolveSelector(0, "missing");
    expect(missing).toBeNull();
  });

  it("gets element info from analyzed DSL", () => {
    const loop = new EditAgentLoop();
    refinerMocks.parseSections.mockReturnValue(["slide"]);
    analyzer.collectAllDsl.mockReturnValue([
      { elements: [{ elementId: "el1", tag: "svg" }] },
    ]);

    const found = loop._getElementInfo(0, "el1");
    const missing = loop._getElementInfo(0, "missing");

    expect(found).toEqual({ elementId: "el1", tag: "svg" });
    expect(missing).toBeNull();
  });

  it("regenerates SVG and image assets", async () => {
    const loop = new EditAgentLoop();

    loop._svgGenerator = null;
    const noSvg = await loop._regenerateSvg(0, "el", "cmd", { emit: vi.fn(), signal: null });
    expect(noSvg).toEqual({ success: false, error: "SVG generator not available" });

    loop._svgGenerator = { generate: vi.fn().mockResolvedValue({}) };
    const badSvg = await loop._regenerateSvg(0, "el", "cmd", { emit: vi.fn(), signal: null });
    expect(badSvg).toEqual({ success: false, error: "SVG generation failed" });

    loop._svgGenerator = { generate: vi.fn().mockResolvedValue({ svg: "<svg/>" }) };
    const goodSvg = await loop._regenerateSvg(0, "el", "cmd", { emit: vi.fn(), signal: null });
    expect(editor.editElement).toHaveBeenCalledWith(0, "el", { html: "<svg/>" });
    expect(goodSvg).toEqual({ success: true });

    loop._imageGenerator = null;
    const noImage = await loop._regenerateImage(0, "el", "cmd", { emit: vi.fn(), signal: null });
    expect(noImage).toEqual({ success: false, error: "Image generator not available" });

    loop._imageGenerator = { generate: vi.fn().mockResolvedValue({}) };
    const badImage = await loop._regenerateImage(0, "el", "cmd", { emit: vi.fn(), signal: null });
    expect(badImage).toEqual({ success: false, error: "Image generation failed" });

    loop._imageGenerator = {
      generate: vi.fn().mockResolvedValue({ base64: "data:image/png;base64,zzz" }),
    };
    const goodImage = await loop._regenerateImage(0, "el", "cmd", { emit: vi.fn(), signal: null });
    expect(editor.editElement).toHaveBeenCalledWith(0, "el", {
      attrs: { src: "data:image/png;base64,zzz" },
    });
    expect(goodImage).toEqual({ success: true });
  });

  it("interprets AI element edits and handles invalid operations", async () => {
    const loop = new EditAgentLoop();

    loop._intentInterpreter._interpretIntent.mockResolvedValue({
      operations: [],
      response: "no-intent",
    });
    const noOps = await loop._aiEditElement(0, "el1", "cmd", {
      emit: vi.fn(),
      signal: null,
    });
    expect(noOps).toEqual({ success: false, error: "no-intent" });

    loop._intentInterpreter._interpretIntent.mockResolvedValue({
      operations: { tool: "edit_element" },
      response: "invalid",
    });
    const invalidOps = await loop._aiEditElement(0, "el1", "cmd", {
      emit: vi.fn(),
      signal: null,
    });
    expect(invalidOps).toEqual({ success: false, error: "invalid" });

    loop._intentInterpreter._interpretIntent.mockResolvedValue({
      operations: [
        { tool: "edit_element", params: { changes: { text: "hi" } } },
      ],
    });
    editor.editElement.mockResolvedValue({ success: true, changed: true });
    const edited = await loop._aiEditElement(1, "el1", "cmd", {
      emit: vi.fn(),
      signal: null,
    });
    expect(editor.editElement).toHaveBeenCalledWith(1, "el1", { text: "hi" });
    expect(edited).toEqual({ success: true, changed: true });

    loop._intentInterpreter._interpretIntent.mockResolvedValue({
      operations: [{ tool: "delete_element", params: {} }],
    });
    const unsupported = await loop._aiEditElement(1, "el1", "cmd", {
      emit: vi.fn(),
      signal: null,
    });
    expect(unsupported.success).toBe(false);
    expect(unsupported.error).toContain("delete_element");
  });

  it("analyzes and applies multi-step AI edits", async () => {
    const loop = new EditAgentLoop();

    loop._intentInterpreter._interpretIntent.mockResolvedValue({
      operations: [],
      response: "no-ops",
    });
    const emptyOps = await loop._aiAnalyzeAndEdit(
      0,
      { slideHtml: "", command: "cmd" },
      { emit: vi.fn(), signal: null }
    );
    expect(emptyOps).toEqual({ success: false, error: "no-ops" });

    loop._intentInterpreter._interpretIntent.mockResolvedValue({
      operations: [
        { tool: "edit_element", params: { elementId: "a", changes: { text: "a" } } },
        { tool: "edit_element", params: { elementId: "b", changes: { text: "b" } } },
      ],
    });
    editor.editElement.mockResolvedValue({ success: true });
    const multi = await loop._aiAnalyzeAndEdit(
      0,
      { slideHtml: "", command: "cmd" },
      { emit: vi.fn(), signal: null }
    );
    expect(editor.editElement).toHaveBeenCalledTimes(2);
    expect(multi.success).toBe(true);
    expect(multi.operations).toHaveLength(2);

    loop._intentInterpreter._interpretIntent.mockResolvedValue({
      operations: [{ tool: "edit_element", params: { changes: { text: "x" } } }],
    });
    const missingIds = await loop._aiAnalyzeAndEdit(
      0,
      { slideHtml: "", command: "cmd" },
      { emit: vi.fn(), signal: null }
    );
    expect(missingIds.success).toBe(true);
    expect(missingIds.operations).toEqual([]);

    loop._intentInterpreter._interpretIntent.mockResolvedValue({
      operations: [
        { tool: "edit_element", params: { elementId: "a", changes: {} } },
        { tool: "edit_element", params: { elementId: "b", changes: {} } },
      ],
    });
    editor.editElement.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({
      success: false,
    });
    const partial = await loop._aiAnalyzeAndEdit(
      0,
      { slideHtml: "", command: "cmd" },
      { emit: vi.fn(), signal: null }
    );
    expect(partial.success).toBe(false);
  });

  it("applies global edits across slides and handles empty contexts", async () => {
    const loop = new EditAgentLoop();
    const analyzeSpy = vi.spyOn(loop, "_aiAnalyzeAndEdit");
    analyzeSpy
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false });

    const result = await loop._aiGlobalEdit(
      { allDsl: [{ html: "a" }, { html: "b" }], command: "cmd" },
      { emit: vi.fn(), signal: null }
    );
    expect(analyzeSpy).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ success: true, slidesModified: 1 });

    const emptyResult = await loop._aiGlobalEdit(
      { allDsl: [], command: "cmd" },
      { emit: vi.fn(), signal: null }
    );
    expect(emptyResult).toEqual({ success: false, slidesModified: 0 });

    const objectResult = await loop._aiGlobalEdit(
      { allDsl: {}, command: "cmd" },
      { emit: vi.fn(), signal: null }
    );
    expect(objectResult).toEqual({ success: false, slidesModified: 0 });
  });

  it("delegates undo/redo and returns history snapshots", async () => {
    const loop = new EditAgentLoop();
    editor.undo.mockReturnValue({ ok: true });
    editor.redo.mockReturnValue({ ok: true });

    expect(loop.undo()).toEqual({ ok: true });
    expect(loop.redo()).toEqual({ ok: true });

    loop._handleElementEdit = vi.fn().mockResolvedValue({ success: true });
    await loop._processEditRequest(
      { type: EditRequestType.ELEMENT, selection: { elementId: "el1" } },
      { emit: vi.fn(), signal: null }
    );

    const history = loop.getEditHistory();
    expect(history).toHaveLength(1);
    history.push({ timestamp: 1, request: { type: "fake" } });
    expect(loop.getEditHistory()).toHaveLength(1);
  });

  it("returns current state", () => {
    const loop = new EditAgentLoop();
    loop._state = EditState.PROCESSING;
    expect(loop.getState()).toBe(EditState.PROCESSING);
  });
});

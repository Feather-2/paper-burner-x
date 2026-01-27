import { describe, it, expect, vi, beforeEach } from "vitest";

let SkillScopeMock;
let loadSkillsMock;
let loadSkillFromPathMock;
let loadSkillsFromNexusMock;
let loadAllSkillsMock;

let SkillsManagerMock;
let SkillsManagerCtorSpy;

let renderSkillsSectionMock;
let renderSkillsListMock;

let enhanceWithSandboxMock;
let createSandboxedSkillsManagerMock;
let analyzeSkillRiskMock;

let throwOnImport;

vi.mock("../../../../js/agents/skills/model.js", () => {
  if (throwOnImport?.model) throw throwOnImport.model;
  return { SkillScope: SkillScopeMock };
});

vi.mock("../../../../js/agents/skills/loader.js", () => {
  if (throwOnImport?.loader) throw throwOnImport.loader;
  return {
    loadSkills: loadSkillsMock,
    loadSkillFromPath: loadSkillFromPathMock,
    loadSkillsFromNexus: loadSkillsFromNexusMock,
    loadAllSkills: loadAllSkillsMock,
  };
});

vi.mock("../../../../js/agents/skills/manager.js", () => {
  if (throwOnImport?.manager) throw throwOnImport.manager;
  return { SkillsManager: SkillsManagerMock };
});

vi.mock("../../../../js/agents/skills/render.js", () => {
  if (throwOnImport?.render) throw throwOnImport.render;
  return {
    renderSkillsSection: renderSkillsSectionMock,
    renderSkillsList: renderSkillsListMock,
  };
});

vi.mock("../../../../js/agents/skills/sandbox-adapter.js", () => {
  if (throwOnImport?.sandbox) throw throwOnImport.sandbox;
  return {
    enhanceWithSandbox: enhanceWithSandboxMock,
    createSandboxedSkillsManager: createSandboxedSkillsManagerMock,
    analyzeSkillRisk: analyzeSkillRiskMock,
  };
});

const importIndex = () => import("../../../../js/agents/skills/index.js");

const WHITESPACE = " \n\t ";
const OBJECT_AS_ARRAY = Object.freeze({ 0: "a", 1: "b", length: 2 });

function createDeepObject(depth = 64) {
  const root = { level: 0 };
  let cur = root;
  for (let i = 1; i <= depth; i++) {
    cur.next = { level: i };
    cur = cur.next;
  }
  return root;
}

function boundaryArgCases() {
  return [
    { label: "null", args: [null] },
    { label: "undefined", args: [undefined] },
    { label: "empty string", args: [""] },
    { label: "whitespace string", args: [WHITESPACE] },
    { label: "empty array", args: [[]] },
    { label: "empty object", args: [{}] },
    { label: "0", args: [0] },
    { label: "-1", args: [-1] },
    { label: "MAX_SAFE_INTEGER", args: [Number.MAX_SAFE_INTEGER] },
    { label: "string number", args: ["42"] },
    { label: "object-as-array", args: [OBJECT_AS_ARRAY] },
    { label: "huge string", argsFactory: () => ["x".repeat(256_000)] },
    { label: "deep object", argsFactory: () => [createDeepObject(128)] },
    {
      label: "large array",
      argsFactory: () => [Array.from({ length: 10_000 }, (_, i) => i)],
    },
  ];
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  throwOnImport = {
    model: null,
    loader: null,
    manager: null,
    render: null,
    sandbox: null,
  };

  SkillScopeMock = Object.freeze({ REPO: "repo", USER: "user", SYSTEM: "system" });

  loadSkillsMock = vi.fn(async (...args) => ({ ok: true, args }));
  loadSkillFromPathMock = vi.fn(async (...args) => ({ ok: true, args }));
  loadSkillsFromNexusMock = vi.fn(async (...args) => ({ ok: true, args }));
  loadAllSkillsMock = vi.fn(async (...args) => ({ ok: true, args }));

  SkillsManagerCtorSpy = vi.fn();
  SkillsManagerMock = class SkillsManagerMock {
    constructor(...args) {
      SkillsManagerCtorSpy(...args);
      this.args = args;
    }
  };

  renderSkillsSectionMock = vi.fn((...args) => ({ ok: true, args }));
  renderSkillsListMock = vi.fn((...args) => ({ ok: true, args }));

  enhanceWithSandboxMock = vi.fn((...args) => ({ ok: true, args }));
  createSandboxedSkillsManagerMock = vi.fn((...args) => ({ ok: true, args }));
  analyzeSkillRiskMock = vi.fn((...args) => ({ ok: true, args }));
});

describe("SkillScope", () => {
  it("re-exports SkillScope from model.js", async () => {
    const mod = await importIndex();
    expect(mod.SkillScope).toBe(SkillScopeMock);
  });

  it.each([
    { label: "null", value: null },
    { label: "undefined", value: undefined },
    { label: "empty string", value: "" },
    { label: "whitespace string", value: WHITESPACE },
    { label: "empty array", value: [] },
    { label: "empty object", value: {} },
    { label: "0", value: 0 },
    { label: "-1", value: -1 },
    { label: "MAX_SAFE_INTEGER", value: Number.MAX_SAFE_INTEGER },
  ])("re-exports boundary value: $label", async ({ value }) => {
    SkillScopeMock = value;
    const mod = await importIndex();
    expect(mod.SkillScope).toBe(value);
  });

  it("throws when model.js fails to load", async () => {
    throwOnImport.model = new Error("model import failed");
    await expect(importIndex()).rejects.toThrow("model import failed");
  });
});

describe("loadSkills", () => {
  it("re-exports loadSkills from loader.js", async () => {
    const mod = await importIndex();
    expect(mod.loadSkills).toBe(loadSkillsMock);
  });

  it.each(boundaryArgCases())("passes through boundary args: $label", async (tc) => {
    const args = tc.argsFactory ? tc.argsFactory() : tc.args;
    const mod = await importIndex();
    await mod.loadSkills(...args);
    expect(loadSkillsMock).toHaveBeenCalledTimes(1);
    expect(loadSkillsMock).toHaveBeenCalledWith(...args);
  });

  it("throws when loader.js fails to load", async () => {
    throwOnImport.loader = new Error("loader import failed");
    await expect(importIndex()).rejects.toThrow("loader import failed");
  });

  it("handles concurrent calls (simultaneous + rapid)", async () => {
    loadSkillsMock.mockImplementation(async (v) => {
      await Promise.resolve();
      return v;
    });

    const mod = await importIndex();
    const deep = createDeepObject(32);
    const argsList = [null, "", 0, -1, Number.MAX_SAFE_INTEGER, OBJECT_AS_ARRAY, deep, "x".repeat(10_000)];
    await Promise.all(argsList.map((a) => mod.loadSkills(a)));

    expect(loadSkillsMock).toHaveBeenCalledTimes(argsList.length);
    argsList.forEach((v, i) => {
      expect(loadSkillsMock.mock.calls[i][0]).toBe(v);
    });
  });
});

describe("loadSkillFromPath", () => {
  it("re-exports loadSkillFromPath from loader.js", async () => {
    const mod = await importIndex();
    expect(mod.loadSkillFromPath).toBe(loadSkillFromPathMock);
  });

  it.each([
    { label: "empty string path", args: [""] },
    { label: "whitespace path", args: [WHITESPACE] },
    { label: "null", args: [null] },
    { label: "undefined", args: [undefined] },
    { label: "string number", args: ["0"] },
    { label: "object as array", args: [OBJECT_AS_ARRAY] },
    { label: "huge string", argsFactory: () => ["x".repeat(512_000)] },
    { label: "deep options object", argsFactory: () => ["./SKILL.md", createDeepObject(96)] },
  ])("passes through boundary args: $label", async (tc) => {
    const args = tc.argsFactory ? tc.argsFactory() : tc.args;
    const mod = await importIndex();
    await mod.loadSkillFromPath(...args);
    expect(loadSkillFromPathMock).toHaveBeenCalledTimes(1);
    expect(loadSkillFromPathMock).toHaveBeenCalledWith(...args);
  });

  it("propagates rejection errors from underlying implementation", async () => {
    loadSkillFromPathMock.mockRejectedValueOnce(new Error("bad path"));
    const mod = await importIndex();
    await expect(mod.loadSkillFromPath("not-a-real-path")).rejects.toThrow("bad path");
  });

  it("handles rapid consecutive calls", async () => {
    const mod = await importIndex();
    const calls = ["", WHITESPACE, "SKILL.md", "x".repeat(1024)];
    for (const c of calls) {
      await mod.loadSkillFromPath(c);
    }
    expect(loadSkillFromPathMock).toHaveBeenCalledTimes(calls.length);
    calls.forEach((v, i) => {
      expect(loadSkillFromPathMock.mock.calls[i][0]).toBe(v);
    });
  });
});

describe("loadSkillsFromNexus", () => {
  it("re-exports loadSkillsFromNexus from loader.js", async () => {
    const mod = await importIndex();
    expect(mod.loadSkillsFromNexus).toBe(loadSkillsFromNexusMock);
  });

  it.each(boundaryArgCases())("passes through boundary args: $label", async (tc) => {
    const args = tc.argsFactory ? tc.argsFactory() : tc.args;
    const mod = await importIndex();
    await mod.loadSkillsFromNexus(...args);
    expect(loadSkillsFromNexusMock).toHaveBeenCalledTimes(1);
    expect(loadSkillsFromNexusMock).toHaveBeenCalledWith(...args);
  });

  it("propagates synchronous throw errors from underlying implementation", async () => {
    loadSkillsFromNexusMock.mockImplementationOnce(() => {
      throw new TypeError("nexus unavailable");
    });

    const mod = await importIndex();
    await expect(Promise.resolve().then(() => mod.loadSkillsFromNexus("nexus://skills"))).rejects.toThrow(
      "nexus unavailable",
    );
  });

  it("supports concurrent calls", async () => {
    loadSkillsFromNexusMock.mockImplementation(async (v) => {
      await Promise.resolve();
      return v;
    });

    const mod = await importIndex();
    const deep = createDeepObject(24);
    const argsList = ["nexus://a", "nexus://b", "", WHITESPACE, "x".repeat(20_000), deep];
    await Promise.all(argsList.map((a) => mod.loadSkillsFromNexus(a)));

    expect(loadSkillsFromNexusMock).toHaveBeenCalledTimes(argsList.length);
  });
});

describe("loadAllSkills", () => {
  it("re-exports loadAllSkills from loader.js", async () => {
    const mod = await importIndex();
    expect(mod.loadAllSkills).toBe(loadAllSkillsMock);
  });

  it.each([
    { label: "null", args: [null] },
    { label: "undefined", args: [undefined] },
    { label: "empty array", args: [[]] },
    { label: "empty object", args: [{}] },
    { label: "object as array", args: [OBJECT_AS_ARRAY] },
    { label: "MAX_SAFE_INTEGER", args: [Number.MAX_SAFE_INTEGER] },
    { label: "deep object", argsFactory: () => [createDeepObject(80)] },
  ])("passes through boundary args: $label", async (tc) => {
    const args = tc.argsFactory ? tc.argsFactory() : tc.args;
    const mod = await importIndex();
    await mod.loadAllSkills(...args);
    expect(loadAllSkillsMock).toHaveBeenCalledTimes(1);
    expect(loadAllSkillsMock).toHaveBeenCalledWith(...args);
  });

  it("propagates rejection errors from underlying implementation", async () => {
    loadAllSkillsMock.mockRejectedValueOnce(new Error("loadAllSkills failed"));
    const mod = await importIndex();
    await expect(mod.loadAllSkills({})).rejects.toThrow("loadAllSkills failed");
  });

  it("supports concurrent calls", async () => {
    loadAllSkillsMock.mockImplementation(async (v) => {
      await Promise.resolve();
      return v;
    });

    const mod = await importIndex();
    const argsList = [{}, [], null, "x".repeat(1000), createDeepObject(16)];
    await Promise.all(argsList.map((a) => mod.loadAllSkills(a)));

    expect(loadAllSkillsMock).toHaveBeenCalledTimes(argsList.length);
  });
});

describe("SkillsManager", () => {
  it("re-exports SkillsManager from manager.js", async () => {
    const mod = await importIndex();
    expect(mod.SkillsManager).toBe(SkillsManagerMock);
  });

  it("constructs instances and forwards constructor args", async () => {
    const mod = await importIndex();
    const instance = new mod.SkillsManager("a", 1, { ok: true });
    expect(instance).toBeInstanceOf(SkillsManagerMock);
    expect(SkillsManagerCtorSpy).toHaveBeenCalledTimes(1);
    expect(SkillsManagerCtorSpy).toHaveBeenCalledWith("a", 1, { ok: true });
  });

  it.each([
    { label: "null", args: [null] },
    { label: "undefined", args: [undefined] },
    { label: "empty string", args: [""] },
    { label: "whitespace string", args: [WHITESPACE] },
    { label: "empty array", args: [[]] },
    { label: "empty object", args: [{}] },
    { label: "0", args: [0] },
    { label: "-1", args: [-1] },
    { label: "MAX_SAFE_INTEGER", args: [Number.MAX_SAFE_INTEGER] },
    { label: "string number", args: ["123"] },
    { label: "object as array", args: [OBJECT_AS_ARRAY] },
    { label: "huge string", argsFactory: () => ["x".repeat(256_000)] },
    { label: "deep object", argsFactory: () => [createDeepObject(96)] },
  ])("accepts boundary constructor args: $label", async (tc) => {
    const args = tc.argsFactory ? tc.argsFactory() : tc.args;
    const mod = await importIndex();
    // eslint-disable-next-line no-new
    new mod.SkillsManager(...args);
    expect(SkillsManagerCtorSpy).toHaveBeenCalledTimes(1);
    expect(SkillsManagerCtorSpy).toHaveBeenCalledWith(...args);
  });

  it("throws when manager.js fails to load", async () => {
    throwOnImport.manager = new Error("manager import failed");
    await expect(importIndex()).rejects.toThrow("manager import failed");
  });

  it("handles rapid consecutive instantiation", async () => {
    const mod = await importIndex();
    const inputs = [null, "", 0, -1, Number.MAX_SAFE_INTEGER];
    const instances = inputs.map((v) => new mod.SkillsManager(v));
    expect(instances).toHaveLength(inputs.length);
    expect(SkillsManagerCtorSpy).toHaveBeenCalledTimes(inputs.length);
  });
});

describe("renderSkillsSection", () => {
  it("re-exports renderSkillsSection from render.js", async () => {
    const mod = await importIndex();
    expect(mod.renderSkillsSection).toBe(renderSkillsSectionMock);
  });

  it.each([
    { label: "null", args: [null] },
    { label: "undefined", args: [undefined] },
    { label: "empty string", args: [""] },
    { label: "whitespace string", args: [WHITESPACE] },
    { label: "empty array", args: [[]] },
    { label: "empty object", args: [{}] },
    { label: "0", args: [0] },
    { label: "-1", args: [-1] },
    { label: "MAX_SAFE_INTEGER", args: [Number.MAX_SAFE_INTEGER] },
    { label: "huge string", argsFactory: () => ["x".repeat(256_000)] },
    { label: "deep object", argsFactory: () => [createDeepObject(72)] },
  ])("passes through boundary args: $label", async (tc) => {
    const args = tc.argsFactory ? tc.argsFactory() : tc.args;
    const mod = await importIndex();
    const out = mod.renderSkillsSection(...args);
    expect(renderSkillsSectionMock).toHaveBeenCalledTimes(1);
    expect(renderSkillsSectionMock).toHaveBeenCalledWith(...args);
    expect(out).toEqual({ ok: true, args });
  });

  it("propagates synchronous errors from underlying implementation", async () => {
    renderSkillsSectionMock.mockImplementationOnce(() => {
      throw new Error("render section failed");
    });

    const mod = await importIndex();
    expect(() => mod.renderSkillsSection({})).toThrow("render section failed");
  });

  it("handles rapid consecutive calls", async () => {
    const mod = await importIndex();
    const calls = ["", WHITESPACE, "x".repeat(4096), createDeepObject(8)];
    for (const c of calls) mod.renderSkillsSection(c);
    expect(renderSkillsSectionMock).toHaveBeenCalledTimes(calls.length);
  });
});

describe("renderSkillsList", () => {
  it("re-exports renderSkillsList from render.js", async () => {
    const mod = await importIndex();
    expect(mod.renderSkillsList).toBe(renderSkillsListMock);
  });

  it.each([
    { label: "empty array", args: [[]] },
    { label: "empty object", args: [{}] },
    { label: "object as array", args: [OBJECT_AS_ARRAY] },
    { label: "null", args: [null] },
    { label: "undefined", args: [undefined] },
    { label: "0", args: [0] },
    { label: "-1", args: [-1] },
    { label: "MAX_SAFE_INTEGER", args: [Number.MAX_SAFE_INTEGER] },
    { label: "huge string", argsFactory: () => ["x".repeat(256_000)] },
    { label: "deep object", argsFactory: () => [createDeepObject(72)] },
  ])("passes through boundary args: $label", async (tc) => {
    const args = tc.argsFactory ? tc.argsFactory() : tc.args;
    const mod = await importIndex();
    const out = mod.renderSkillsList(...args);
    expect(renderSkillsListMock).toHaveBeenCalledTimes(1);
    expect(renderSkillsListMock).toHaveBeenCalledWith(...args);
    expect(out).toEqual({ ok: true, args });
  });

  it("propagates synchronous errors from underlying implementation", async () => {
    renderSkillsListMock.mockImplementationOnce(() => {
      throw new Error("render list failed");
    });

    const mod = await importIndex();
    expect(() => mod.renderSkillsList([])).toThrow("render list failed");
  });

  it("throws when render.js fails to load", async () => {
    throwOnImport.render = new Error("render import failed");
    await expect(importIndex()).rejects.toThrow("render import failed");
  });
});

describe("enhanceWithSandbox", () => {
  it("re-exports enhanceWithSandbox from sandbox-adapter.js", async () => {
    const mod = await importIndex();
    expect(mod.enhanceWithSandbox).toBe(enhanceWithSandboxMock);
  });

  it.each(boundaryArgCases())("passes through boundary args: $label", async (tc) => {
    const args = tc.argsFactory ? tc.argsFactory() : tc.args;
    const mod = await importIndex();
    await mod.enhanceWithSandbox(...args);
    expect(enhanceWithSandboxMock).toHaveBeenCalledTimes(1);
    expect(enhanceWithSandboxMock).toHaveBeenCalledWith(...args);
  });

  it("propagates rejection errors from underlying implementation", async () => {
    enhanceWithSandboxMock.mockRejectedValueOnce(new Error("sandbox enhance failed"));
    const mod = await importIndex();
    await expect(mod.enhanceWithSandbox({})).rejects.toThrow("sandbox enhance failed");
  });

  it("supports concurrent calls", async () => {
    enhanceWithSandboxMock.mockImplementation(async (v) => {
      await Promise.resolve();
      return v;
    });

    const mod = await importIndex();
    const argsList = [null, "", 0, OBJECT_AS_ARRAY, createDeepObject(12)];
    await Promise.all(argsList.map((a) => mod.enhanceWithSandbox(a)));

    expect(enhanceWithSandboxMock).toHaveBeenCalledTimes(argsList.length);
  });
});

describe("createSandboxedSkillsManager", () => {
  it("re-exports createSandboxedSkillsManager from sandbox-adapter.js", async () => {
    const mod = await importIndex();
    expect(mod.createSandboxedSkillsManager).toBe(createSandboxedSkillsManagerMock);
  });

  it.each([
    { label: "null", args: [null] },
    { label: "undefined", args: [undefined] },
    { label: "empty object", args: [{}] },
    { label: "empty array", args: [[]] },
    { label: "0", args: [0] },
    { label: "-1", args: [-1] },
    { label: "MAX_SAFE_INTEGER", args: [Number.MAX_SAFE_INTEGER] },
    { label: "string number", args: ["7"] },
    { label: "deep object", argsFactory: () => [createDeepObject(64)] },
    { label: "huge string", argsFactory: () => ["x".repeat(256_000)] },
  ])("passes through boundary args: $label", async (tc) => {
    const args = tc.argsFactory ? tc.argsFactory() : tc.args;
    const mod = await importIndex();
    await mod.createSandboxedSkillsManager(...args);
    expect(createSandboxedSkillsManagerMock).toHaveBeenCalledTimes(1);
    expect(createSandboxedSkillsManagerMock).toHaveBeenCalledWith(...args);
  });

  it("throws when sandbox-adapter.js fails to load", async () => {
    throwOnImport.sandbox = new Error("sandbox import failed");
    await expect(importIndex()).rejects.toThrow("sandbox import failed");
  });

  it("handles rapid consecutive calls", async () => {
    const mod = await importIndex();
    const calls = [null, "", WHITESPACE, 0, -1];
    for (const c of calls) await mod.createSandboxedSkillsManager(c);
    expect(createSandboxedSkillsManagerMock).toHaveBeenCalledTimes(calls.length);
  });
});

describe("analyzeSkillRisk", () => {
  it("re-exports analyzeSkillRisk from sandbox-adapter.js", async () => {
    const mod = await importIndex();
    expect(mod.analyzeSkillRisk).toBe(analyzeSkillRiskMock);
  });

  it.each(boundaryArgCases())("passes through boundary args: $label", async (tc) => {
    const args = tc.argsFactory ? tc.argsFactory() : tc.args;
    const mod = await importIndex();
    await mod.analyzeSkillRisk(...args);
    expect(analyzeSkillRiskMock).toHaveBeenCalledTimes(1);
    expect(analyzeSkillRiskMock).toHaveBeenCalledWith(...args);
  });

  it("propagates synchronous errors from underlying implementation", async () => {
    analyzeSkillRiskMock.mockImplementationOnce(() => {
      throw new Error("risk analysis failed");
    });

    const mod = await importIndex();
    expect(() => mod.analyzeSkillRisk("SKILL.md")).toThrow("risk analysis failed");
  });

  it("supports concurrent calls", async () => {
    analyzeSkillRiskMock.mockImplementation(async (v) => {
      await Promise.resolve();
      return v;
    });

    const mod = await importIndex();
    const deep = createDeepObject(20);
    const argsList = [null, "", WHITESPACE, 0, Number.MAX_SAFE_INTEGER, deep, "x".repeat(50_000)];
    await Promise.all(argsList.map((a) => mod.analyzeSkillRisk(a)));

    expect(analyzeSkillRiskMock).toHaveBeenCalledTimes(argsList.length);
  });
});

describe("default", () => {
  it("exports SkillsManager as default and matches named export", async () => {
    const mod = await importIndex();
    expect(mod.default).toBe(mod.SkillsManager);
    expect(mod.default).toBe(SkillsManagerMock);

    const instance = new mod.default("x");
    expect(instance).toBeInstanceOf(SkillsManagerMock);
    expect(SkillsManagerCtorSpy).toHaveBeenCalledWith("x");
  });

  it.each([
    { label: "null", value: null },
    { label: "undefined", value: undefined },
    { label: "empty string", value: "" },
    { label: "whitespace string", value: WHITESPACE },
    { label: "0", value: 0 },
    { label: "-1", value: -1 },
    { label: "MAX_SAFE_INTEGER", value: Number.MAX_SAFE_INTEGER },
    { label: "empty object", value: {} },
    { label: "empty array", value: [] },
  ])("re-exports boundary value as default: $label", async ({ value }) => {
    SkillsManagerMock = value;
    const mod = await importIndex();
    expect(mod.SkillsManager).toBe(value);
    expect(mod.default).toBe(value);
  });

  it("throws when manager.js fails to load", async () => {
    throwOnImport.manager = new Error("manager import failed");
    await expect(importIndex()).rejects.toThrow("manager import failed");
  });
});
import { describe, it, expect, vi, beforeEach } from "vitest";

const readFileSyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs", () => ({
  readFileSync: readFileSyncMock,
}));

import {
  MANIFEST_VERSION,
  ManifestValidationError,
  PermissionType,
  PluginType,
  createToolManifest,
  createSkillManifest,
} from "../../../../../../js/agents/runtime/core/manifest/manifest.js";

beforeEach(() => {
  readFileSyncMock.mockReset();
  vi.clearAllMocks();
});

function getValidationError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("Expected ManifestValidationError");
}

describe("MANIFEST_VERSION", () => {
  it("exposes a semver string", () => {
    expect(MANIFEST_VERSION).toBe("1.0.0");
    expect(MANIFEST_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("ManifestValidationError", () => {
  it("captures message, field, and name", () => {
    const error = new ManifestValidationError("boom", "name");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ManifestValidationError");
    expect(error.message).toBe("boom");
    expect(error.field).toBe("name");
  });

  it("defaults field to undefined", () => {
    const error = new ManifestValidationError("boom");
    expect(error.field).toBeUndefined();
  });
});

describe("PermissionType", () => {
  it("is frozen and exposes expected values", () => {
    expect(Object.isFrozen(PermissionType)).toBe(true);
    expect(PermissionType).toMatchObject({
      READ_FILE: "read_file",
      WRITE_FILE: "write_file",
      EXECUTE: "execute",
      NETWORK: "network",
      MCP: "mcp",
      LLM: "llm",
      USER_INPUT: "user_input",
      MEMORY: "memory",
    });
  });

  it("prevents mutation", () => {
    const original = PermissionType.READ_FILE;
    try {
      PermissionType.READ_FILE = "override";
    } catch {}
    expect(PermissionType.READ_FILE).toBe(original);
  });
});

describe("PluginType", () => {
  it("is frozen and exposes expected values", () => {
    expect(Object.isFrozen(PluginType)).toBe(true);
    expect(PluginType).toMatchObject({
      TOOL: "tool",
      SKILL: "skill",
      STAGE: "stage",
      MIDDLEWARE: "middleware",
    });
  });

  it("prevents mutation", () => {
    const original = PluginType.TOOL;
    try {
      PluginType.TOOL = "override";
    } catch {}
    expect(PluginType.TOOL).toBe(original);
  });
});

describe("createToolManifest", () => {
  it("creates a normalized manifest with required detection and metadata", () => {
    const manifest = createToolManifest({
      name: "read-doc",
      description: "Reads documents",
      parameters: {
        sourceId: "required source id",
        maxLength: "optional max",
        mode: { type: "string", required: true },
      },
      output: { type: "string" },
      permissions: [PermissionType.READ_FILE],
      keywords: ["doc"],
      priority: 0,
      layer: -1,
      activation: { when: "manual" },
    });

    expect(manifest.manifestVersion).toBe(MANIFEST_VERSION);
    expect(manifest.type).toBe(PluginType.TOOL);
    expect(manifest.version).toBe("1.0.0");
    expect(manifest.keywords).toEqual(["doc"]);
    expect(manifest.permissions).toEqual([PermissionType.READ_FILE]);
    expect(manifest.parameters.type).toBe("object");
    expect(manifest.parameters.properties.sourceId).toEqual({
      type: "string",
      description: "required source id",
    });
    expect(manifest.parameters.properties.mode).toEqual({ type: "string", required: true });
    expect(manifest.parameters.required).toEqual(expect.arrayContaining(["sourceId", "mode"]));
    expect(manifest.parameters.required).not.toContain("maxLength");
    expect(manifest.output).toEqual({ type: "string" });
    expect(manifest.metadata).toEqual({
      priority: 0,
      layer: -1,
      activation: { when: "manual" },
    });
  });

  it("returns null parameters/output when absent and preserves empty arrays", () => {
    const manifest = createToolManifest({
      name: "empty",
      description: "Empty optional fields",
      parameters: undefined,
      output: undefined,
      permissions: [],
      keywords: [],
    });

    expect(manifest.parameters).toBeNull();
    expect(manifest.output).toBeNull();
    expect(manifest.permissions).toEqual([]);
    expect(manifest.keywords).toEqual([]);
    expect(manifest.metadata).toEqual({
      priority: 1,
      layer: 0,
      activation: null,
    });
  });

  it("removes dangerous keys from JSON Schema parameters", () => {
    const properties = Object.create(null);
    properties.safe = { type: "string" };
    properties.__proto__ = { type: "string" };
    properties.constructor = { type: "string" };

    const manifest = createToolManifest({
      name: "schema-tool",
      description: "Schema path",
      parameters: { type: "object", properties },
    });

    const props = manifest.parameters.properties;
    expect(props.safe).toEqual({ type: "string" });
    expect(Object.prototype.hasOwnProperty.call(props, "__proto__")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(props, "constructor")).toBe(false);
  });

  it("skips dangerous keys in simplified parameters and preserves deep nesting", () => {
    const deepValue = {
      type: "object",
      properties: {
        level1: {
          type: "object",
          properties: {
            level2: { type: "string" },
          },
        },
      },
    };
    const simplified = Object.create(null);
    simplified.safe = deepValue;
    simplified.__proto__ = "skip";
    simplified.prototype = "skip";

    const manifest = createToolManifest({
      name: "deep-tool",
      description: "Deep params",
      parameters: simplified,
    });

    const props = manifest.parameters.properties;
    expect(props.safe).toEqual(deepValue);
    expect(Object.prototype.hasOwnProperty.call(props, "__proto__")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(props, "prototype")).toBe(false);
    expect(manifest.parameters.required).toBeUndefined();
  });

  it("accepts whitespace names and large file descriptions", async () => {
    const largeText = "x".repeat(200000);
    readFileSyncMock.mockReturnValue(largeText);

    const { readFileSync } = await import("node:fs");
    const description = readFileSync("huge.txt", "utf8");

    const manifest = createToolManifest({
      name: " ",
      description,
      parameters: {},
    });

    expect(readFileSync).toHaveBeenCalledWith("huge.txt", "utf8");
    expect(manifest.name).toBe(" ");
    expect(manifest.description.length).toBe(largeText.length);
    expect(manifest.parameters.properties).toEqual({});
    expect(manifest.parameters.required).toBeUndefined();
  });

  it("throws ManifestValidationError for missing name values", () => {
    const cases = [undefined, null, ""];
    for (const value of cases) {
      const error = getValidationError(() =>
        createToolManifest({ name: value, description: "desc" })
      );
      expect(error).toBeInstanceOf(ManifestValidationError);
      expect(error.field).toBe("name");
      expect(error.message).toMatch(/requires name/i);
    }
  });

  it("throws ManifestValidationError for missing description values", () => {
    const cases = [undefined, null, ""];
    for (const value of cases) {
      const error = getValidationError(() =>
        createToolManifest({ name: "tool", description: value })
      );
      expect(error).toBeInstanceOf(ManifestValidationError);
      expect(error.field).toBe("description");
      expect(error.message).toMatch(/requires description/i);
    }
  });

  it("handles concurrent creation with distinct outputs", async () => {
    const inputs = [
      { name: "t1", description: "d1" },
      { name: "t2", description: "d2", permissions: [PermissionType.NETWORK] },
      { name: "t3", description: "d3", keywords: ["k3"] },
    ];

    const results = await Promise.all(
      inputs.map((options) => Promise.resolve().then(() => createToolManifest(options)))
    );

    expect(results.map((m) => m.name)).toEqual(["t1", "t2", "t3"]);
    expect(results[1].permissions).toEqual([PermissionType.NETWORK]);

    results[0].keywords.push("mutated");
    expect(results[1].keywords).toEqual([]);
  });
});

describe("createSkillManifest", () => {
  it("creates a manifest with metadata and defaults", () => {
    const manifest = createSkillManifest({
      name: "code-review",
      description: "Review code",
      keywords: ["review", "code"],
      keywordsAll: ["review"],
      allowedTools: "read-doc,write-report",
      permissions: [PermissionType.READ_FILE],
      priority: 50,
      scope: "system",
      tags: ["quality"],
      traits: { strict: true },
    });

    expect(manifest.manifestVersion).toBe(MANIFEST_VERSION);
    expect(manifest.type).toBe(PluginType.SKILL);
    expect(manifest.version).toBe("1.0.0");
    expect(manifest.keywords).toEqual(["review", "code"]);
    expect(manifest.permissions).toEqual([PermissionType.READ_FILE]);
    expect(manifest.metadata).toEqual({
      keywordsAll: ["review"],
      allowedTools: "read-doc,write-report",
      priority: 50,
      scope: "system",
      tags: ["quality"],
      traits: { strict: true },
    });
  });

  it("preserves numeric boundary priorities", () => {
    const priorities = [0, -1, Number.MAX_SAFE_INTEGER];
    const manifests = priorities.map((priority, index) =>
      createSkillManifest({
        name: `prio-${index}`,
        description: "Priority boundary",
        priority,
      })
    );

    expect(manifests.map((m) => m.metadata.priority)).toEqual(priorities);
  });

  it("accepts type boundary values and empty containers", () => {
    const keywords = { not: "array" };
    const traits = {};
    const manifest = createSkillManifest({
      name: "odd",
      description: "Type boundaries",
      keywords,
      keywordsAll: [],
      allowedTools: "",
      permissions: [],
      priority: "7",
      tags: [],
      traits,
    });

    expect(manifest.keywords).toBe(keywords);
    expect(manifest.permissions).toEqual([]);
    expect(manifest.metadata.keywordsAll).toEqual([]);
    expect(manifest.metadata.allowedTools).toBeNull();
    expect(manifest.metadata.priority).toBe("7");
    expect(manifest.metadata.tags).toEqual([]);
    expect(manifest.metadata.traits).toBe(traits);
  });

  it("handles long allowedTools and deep nested traits", () => {
    const longTools = "tool,".repeat(10000);
    const traits = {
      level1: {
        level2: {
          level3: {
            enabled: true,
          },
        },
      },
    };

    const manifest = createSkillManifest({
      name: "heavy",
      description: "Resource boundaries",
      allowedTools: longTools,
      traits,
    });

    expect(manifest.metadata.allowedTools).toBe(longTools);
    expect(manifest.metadata.traits).toEqual(traits);
  });

  it("throws ManifestValidationError for missing name values", () => {
    const cases = [undefined, null, ""];
    for (const value of cases) {
      const error = getValidationError(() =>
        createSkillManifest({ name: value, description: "desc" })
      );
      expect(error).toBeInstanceOf(ManifestValidationError);
      expect(error.field).toBe("name");
      expect(error.message).toMatch(/requires name/i);
    }
  });

  it("throws ManifestValidationError for missing description values", () => {
    const cases = [undefined, null, ""];
    for (const value of cases) {
      const error = getValidationError(() =>
        createSkillManifest({ name: "skill", description: value })
      );
      expect(error).toBeInstanceOf(ManifestValidationError);
      expect(error.field).toBe("description");
      expect(error.message).toMatch(/requires description/i);
    }
  });

  it("handles rapid consecutive creation without shared arrays", () => {
    const manifests = [];
    for (let i = 0; i < 25; i += 1) {
      manifests.push(
        createSkillManifest({
          name: `skill-${i}`,
          description: "Rapid create",
        })
      );
    }

    expect(manifests).toHaveLength(25);
    expect(new Set(manifests.map((m) => m.name)).size).toBe(25);

    manifests[0].keywords.push("mutated");
    expect(manifests[1].keywords).toEqual([]);
    expect(manifests[0].metadata.priority).toBe(100);
    expect(manifests[0].metadata.scope).toBe("repo");
  });
});

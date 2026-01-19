/**
 * Manifest 单元测试
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  MANIFEST_VERSION,
  ManifestValidationError,
  PermissionType,
  PluginType,
  createToolManifest,
  createSkillManifest,
  createStageManifest,
  createMiddlewareManifest,
  validateManifest,
  extractManifestFromTool,
  extractManifestFromSkill,
  ManifestRegistry,
} from '../../../../../js/agents/runtime/manifest/manifest.js';

describe("manifest", () => {
  describe("createToolManifest", () => {
    it("should create valid tool manifest", () => {
      const manifest = createToolManifest({
        name: "read-doc",
        description: "读取文档内容",
        parameters: {
          sourceId: "文档 ID（必需）",
          maxLength: "最大长度",
        },
        permissions: [PermissionType.READ_FILE],
      });

      expect(manifest.name).toBe("read-doc");
      expect(manifest.type).toBe(PluginType.TOOL);
      expect(manifest.manifestVersion).toBe(MANIFEST_VERSION);
      expect(manifest.parameters.properties.sourceId).toEqual({
        type: "string",
        description: "文档 ID（必需）",
      });
      expect(manifest.parameters.required).toEqual(["sourceId"]);
    });

    it("should throw on missing name", () => {
      expect(() => createToolManifest({ description: "test" })).toThrow(/requires name/);
    });

    it("should throw on missing description", () => {
      expect(() => createToolManifest({ name: "test" })).toThrow(/requires description/);
    });
  });

  describe("createSkillManifest", () => {
    it("should create valid skill manifest", () => {
      const manifest = createSkillManifest({
        name: "code-review",
        description: "代码审查技能",
        keywords: ["review", "code"],
        allowedTools: "read-doc,write-report",
        priority: 50,
      });

      expect(manifest.name).toBe("code-review");
      expect(manifest.type).toBe(PluginType.SKILL);
      expect(manifest.keywords).toEqual(["review", "code"]);
      expect(manifest.metadata.allowedTools).toBe("read-doc,write-report");
      expect(manifest.metadata.priority).toBe(50);
    });
  });

  describe("createStageManifest", () => {
    it("should create valid stage manifest", () => {
      const manifest = createStageManifest({
        name: "deepsearch",
        description: "深度搜索阶段",
        permissions: [PermissionType.NETWORK, PermissionType.LLM],
        dependencies: { "mcp-client": "^1.0.0" },
      });

      expect(manifest.name).toBe("deepsearch");
      expect(manifest.type).toBe(PluginType.STAGE);
      expect(manifest.permissions).toEqual([PermissionType.NETWORK, PermissionType.LLM]);
      expect(manifest.dependencies).toEqual({ "mcp-client": "^1.0.0" });
    });
  });

  describe("createMiddlewareManifest", () => {
    it("should create valid middleware manifest", () => {
      const manifest = createMiddlewareManifest({
        name: "logging",
        description: "日志中间件",
        order: 10,
        phases: ["before"],
      });

      expect(manifest.name).toBe("logging");
      expect(manifest.type).toBe(PluginType.MIDDLEWARE);
      expect(manifest.metadata.order).toBe(10);
      expect(manifest.metadata.phases).toEqual(["before"]);
    });
  });

  describe("validateManifest", () => {
    it("should pass valid manifest", () => {
      const manifest = createToolManifest({
        name: "test",
        description: "test tool",
      });

      const { valid, errors } = validateManifest(manifest);
      expect(valid).toBe(true);
      expect(errors.length).toBe(0);
    });

    it("should fail on missing name", () => {
      const { valid, errors } = validateManifest({
        type: PluginType.TOOL,
        description: "test",
      });

      expect(valid).toBe(false);
      expect(errors).toContain("Missing required field: name");
    });

    it("should fail on invalid type", () => {
      const { valid, errors } = validateManifest({
        name: "test",
        type: "invalid",
        description: "test",
      });

      expect(valid).toBe(false);
      expect(errors).toContain("Invalid type: invalid");
    });

    it("should fail on unknown permission", () => {
      const { valid, errors } = validateManifest({
        name: "test",
        type: PluginType.TOOL,
        description: "test",
        permissions: ["unknown_permission"],
      });

      expect(valid).toBe(false);
      expect(errors).toContain("Unknown permission: unknown_permission");
    });

    it("should fail on invalid version format", () => {
      const { valid, errors } = validateManifest({
        name: "test",
        type: PluginType.TOOL,
        description: "test",
        version: "invalid",
      });

      expect(valid).toBe(false);
      expect(errors).toContain("Invalid version format: invalid");
    });

    it("should handle null manifest", () => {
      const { valid, errors } = validateManifest(null);
      expect(valid).toBe(false);
      expect(errors).toContain("Manifest is null or undefined");
    });
  });

  describe("extractManifestFromTool", () => {
    it("should extract manifest from tool definition", () => {
      const definition = {
        name: "read-doc",
        description: "读取文档内容",
        parameters: {
          sourceId: "文档 ID（必需）",
        },
        priority: "critical",
        layer: 0,
      };

      const manifest = extractManifestFromTool(definition);

      expect(manifest.name).toBe("read-doc");
      expect(manifest.type).toBe(PluginType.TOOL);
      expect(manifest.permissions).toContain(PermissionType.READ_FILE);
    });

    it("should return null for null definition", () => {
      const manifest = extractManifestFromTool(null);
      expect(manifest).toBe(null);
    });
  });

  describe("extractManifestFromSkill", () => {
    it("should extract manifest from skill metadata", () => {
      const metadata = {
        name: "code-review",
        description: "代码审查",
        keywords: ["review"],
        allowedTools: "read-doc,search-docs",
        scope: "repo",
      };

      const manifest = extractManifestFromSkill(metadata);

      expect(manifest.name).toBe("code-review");
      expect(manifest.type).toBe(PluginType.SKILL);
      expect(manifest.permissions).toContain(PermissionType.READ_FILE);
    });

    it("should return null for null metadata", () => {
      const manifest = extractManifestFromSkill(null);
      expect(manifest).toBe(null);
    });
  });

  describe("ManifestRegistry", () => {
    let registry;

    beforeEach(() => {
      registry = new ManifestRegistry();
    });

    it("should register and retrieve manifest", () => {
      const manifest = createToolManifest({
        name: "test-tool",
        description: "Test tool",
      });

      registry.register(manifest);

      const retrieved = registry.get("test-tool");
      expect(retrieved.name).toBe("test-tool");
    });

    it("should throw on invalid manifest", () => {
      expect(() => registry.register({ name: "test" })).toThrow(/Invalid manifest/);
    });

    it("should get by type", () => {
      registry.register(createToolManifest({ name: "tool1", description: "t1" }));
      registry.register(createToolManifest({ name: "tool2", description: "t2" }));
      registry.register(createSkillManifest({ name: "skill1", description: "s1" }));

      const tools = registry.getByType(PluginType.TOOL);
      expect(tools.length).toBe(2);

      const skills = registry.getByType(PluginType.SKILL);
      expect(skills.length).toBe(1);
    });

    it("should filter by permission", () => {
      registry.register(createToolManifest({
        name: "reader",
        description: "Reader",
        permissions: [PermissionType.READ_FILE],
      }));
      registry.register(createToolManifest({
        name: "writer",
        description: "Writer",
        permissions: [PermissionType.WRITE_FILE],
      }));

      const readers = registry.filterByPermission(PermissionType.READ_FILE);
      expect(readers.length).toBe(1);
      expect(readers[0].name).toBe("reader");
    });

    it("should export and import JSON", () => {
      registry.register(createToolManifest({ name: "tool1", description: "t1" }));
      registry.register(createSkillManifest({ name: "skill1", description: "s1" }));

      const json = registry.toJSON();
      expect(json.manifests.length).toBe(2);

      const imported = ManifestRegistry.fromJSON(json);
      expect(imported.size).toBe(2);
      expect(imported.get("tool1")).toMatchObject({
        name: "tool1",
        type: PluginType.TOOL,
      });
      expect(imported.get("skill1")).toMatchObject({
        name: "skill1",
        type: PluginType.SKILL,
      });
    });

    it("should clear registry", () => {
      registry.register(createToolManifest({ name: "tool1", description: "t1" }));
      expect(registry.size).toBe(1);

      registry.clear();
      expect(registry.size).toBe(0);
    });

    it("should register all", () => {
      registry.registerAll([
        createToolManifest({ name: "tool1", description: "t1" }),
        createToolManifest({ name: "tool2", description: "t2" }),
      ]);

      expect(registry.size).toBe(2);
    });
  });
});

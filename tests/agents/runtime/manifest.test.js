/**
 * Manifest 单元测试
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import {
  MANIFEST_VERSION,
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
} from "../../../js/agents/runtime/manifest/manifest.js";

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

      assert.strictEqual(manifest.name, "read-doc");
      assert.strictEqual(manifest.type, PluginType.TOOL);
      assert.strictEqual(manifest.manifestVersion, MANIFEST_VERSION);
      assert.ok(manifest.parameters.properties.sourceId);
      assert.ok(manifest.parameters.required.includes("sourceId"));
    });

    it("should throw on missing name", () => {
      assert.throws(() => {
        createToolManifest({ description: "test" });
      }, /requires name/);
    });

    it("should throw on missing description", () => {
      assert.throws(() => {
        createToolManifest({ name: "test" });
      }, /requires description/);
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

      assert.strictEqual(manifest.name, "code-review");
      assert.strictEqual(manifest.type, PluginType.SKILL);
      assert.deepStrictEqual(manifest.keywords, ["review", "code"]);
      assert.strictEqual(manifest.metadata.allowedTools, "read-doc,write-report");
      assert.strictEqual(manifest.metadata.priority, 50);
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

      assert.strictEqual(manifest.name, "deepsearch");
      assert.strictEqual(manifest.type, PluginType.STAGE);
      assert.deepStrictEqual(manifest.permissions, [PermissionType.NETWORK, PermissionType.LLM]);
      assert.deepStrictEqual(manifest.dependencies, { "mcp-client": "^1.0.0" });
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

      assert.strictEqual(manifest.name, "logging");
      assert.strictEqual(manifest.type, PluginType.MIDDLEWARE);
      assert.strictEqual(manifest.metadata.order, 10);
      assert.deepStrictEqual(manifest.metadata.phases, ["before"]);
    });
  });

  describe("validateManifest", () => {
    it("should pass valid manifest", () => {
      const manifest = createToolManifest({
        name: "test",
        description: "test tool",
      });

      const { valid, errors } = validateManifest(manifest);
      assert.strictEqual(valid, true);
      assert.strictEqual(errors.length, 0);
    });

    it("should fail on missing name", () => {
      const { valid, errors } = validateManifest({
        type: PluginType.TOOL,
        description: "test",
      });

      assert.strictEqual(valid, false);
      assert.ok(errors.some(e => e.includes("name")));
    });

    it("should fail on invalid type", () => {
      const { valid, errors } = validateManifest({
        name: "test",
        type: "invalid",
        description: "test",
      });

      assert.strictEqual(valid, false);
      assert.ok(errors.some(e => e.includes("Invalid type")));
    });

    it("should fail on unknown permission", () => {
      const { valid, errors } = validateManifest({
        name: "test",
        type: PluginType.TOOL,
        description: "test",
        permissions: ["unknown_permission"],
      });

      assert.strictEqual(valid, false);
      assert.ok(errors.some(e => e.includes("Unknown permission")));
    });

    it("should fail on invalid version format", () => {
      const { valid, errors } = validateManifest({
        name: "test",
        type: PluginType.TOOL,
        description: "test",
        version: "invalid",
      });

      assert.strictEqual(valid, false);
      assert.ok(errors.some(e => e.includes("Invalid version")));
    });

    it("should handle null manifest", () => {
      const { valid, errors } = validateManifest(null);
      assert.strictEqual(valid, false);
      assert.ok(errors.some(e => e.includes("null")));
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

      assert.strictEqual(manifest.name, "read-doc");
      assert.strictEqual(manifest.type, PluginType.TOOL);
      assert.ok(manifest.permissions.includes(PermissionType.READ_FILE));
    });

    it("should return null for null definition", () => {
      const manifest = extractManifestFromTool(null);
      assert.strictEqual(manifest, null);
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

      assert.strictEqual(manifest.name, "code-review");
      assert.strictEqual(manifest.type, PluginType.SKILL);
      assert.ok(manifest.permissions.includes(PermissionType.READ_FILE));
    });

    it("should return null for null metadata", () => {
      const manifest = extractManifestFromSkill(null);
      assert.strictEqual(manifest, null);
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
      assert.strictEqual(retrieved.name, "test-tool");
    });

    it("should throw on invalid manifest", () => {
      assert.throws(() => {
        registry.register({ name: "test" }); // Missing type and description
      }, /Invalid manifest/);
    });

    it("should get by type", () => {
      registry.register(createToolManifest({ name: "tool1", description: "t1" }));
      registry.register(createToolManifest({ name: "tool2", description: "t2" }));
      registry.register(createSkillManifest({ name: "skill1", description: "s1" }));

      const tools = registry.getByType(PluginType.TOOL);
      assert.strictEqual(tools.length, 2);

      const skills = registry.getByType(PluginType.SKILL);
      assert.strictEqual(skills.length, 1);
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
      assert.strictEqual(readers.length, 1);
      assert.strictEqual(readers[0].name, "reader");
    });

    it("should export and import JSON", () => {
      registry.register(createToolManifest({ name: "tool1", description: "t1" }));
      registry.register(createSkillManifest({ name: "skill1", description: "s1" }));

      const json = registry.toJSON();
      assert.strictEqual(json.manifests.length, 2);

      const imported = ManifestRegistry.fromJSON(json);
      assert.strictEqual(imported.size, 2);
      assert.ok(imported.get("tool1"));
      assert.ok(imported.get("skill1"));
    });

    it("should clear registry", () => {
      registry.register(createToolManifest({ name: "tool1", description: "t1" }));
      assert.strictEqual(registry.size, 1);

      registry.clear();
      assert.strictEqual(registry.size, 0);
    });

    it("should register all", () => {
      registry.registerAll([
        createToolManifest({ name: "tool1", description: "t1" }),
        createToolManifest({ name: "tool2", description: "t2" }),
      ]);

      assert.strictEqual(registry.size, 2);
    });
  });
});

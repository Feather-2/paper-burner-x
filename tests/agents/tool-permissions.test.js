import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ToolPermissions,
  PermissionLevel,
  getPresetRestrictions,
  mergeRestrictions,
} from "../../js/agents/runtime/safety/tool-permissions.js";

describe("runtime/safety/tool-permissions", () => {
  describe("PermissionLevel enum", () => {
    it("exports all expected levels", () => {
      assert.equal(PermissionLevel.READONLY, "readonly");
      assert.equal(PermissionLevel.STANDARD, "standard");
      assert.equal(PermissionLevel.ELEVATED, "elevated");
      assert.equal(PermissionLevel.CUSTOM, "custom");
    });
  });

  describe("getPresetRestrictions", () => {
    it("returns restrictions for readonly level", () => {
      const restrictions = getPresetRestrictions("readonly");

      assert.ok(Array.isArray(restrictions.blockedTools));
      assert.ok(restrictions.blockedTools.includes("write"));
      assert.ok(restrictions.blockedTools.includes("edit"));
      assert.ok(Array.isArray(restrictions.bash.allowedCommands));
    });

    it("returns restrictions for standard level", () => {
      const restrictions = getPresetRestrictions("standard");

      assert.ok(Array.isArray(restrictions.bash.blockedCommands));
      assert.ok(restrictions.bash.blockedCommands.some((cmd) => cmd.includes("rm -rf")));
    });

    it("returns restrictions for elevated level", () => {
      const restrictions = getPresetRestrictions("elevated");

      assert.ok(Array.isArray(restrictions.bash.blockedCommands));
      // Elevated has fewer restrictions
      assert.ok(restrictions.bash.blockedCommands.length <= 5);
    });

    it("returns null for custom level", () => {
      const restrictions = getPresetRestrictions("custom");
      assert.equal(restrictions, null);
    });
  });

  describe("mergeRestrictions", () => {
    it("merges two restriction sets", () => {
      const base = { blockedTools: ["tool1"] };
      const override = { blockedTools: ["tool2"] };

      const merged = mergeRestrictions(base, override);

      assert.ok(merged.blockedTools.includes("tool1"));
      assert.ok(merged.blockedTools.includes("tool2"));
    });

    it("override allowedCommands replaces base", () => {
      const base = { bash: { allowedCommands: ["ls", "cat"] } };
      const override = { bash: { allowedCommands: ["pwd"] } };

      const merged = mergeRestrictions(base, override);

      assert.deepEqual(merged.bash.allowedCommands, ["pwd"]);
    });
  });

  describe("ToolPermissions class", () => {
    describe("static factory methods", () => {
      it("readonly() creates readonly permissions", () => {
        const perm = ToolPermissions.readonly();
        assert.equal(perm.getLevel(), "readonly");
      });

      it("standard() creates standard permissions", () => {
        const perm = ToolPermissions.standard();
        assert.equal(perm.getLevel(), "standard");
      });

      it("elevated() creates elevated permissions", () => {
        const perm = ToolPermissions.elevated();
        assert.equal(perm.getLevel(), "elevated");
      });

      it("custom() creates custom permissions", () => {
        const perm = ToolPermissions.custom({ blockedTools: ["foo"] });
        assert.equal(perm.getLevel(), "custom");
      });
    });

    describe("check method", () => {
      it("readonly blocks write tools", () => {
        const perm = ToolPermissions.readonly();
        const result = perm.check("write", null);

        assert.equal(result.allowed, false);
        assert.ok(result.reason?.includes("blocked"));
      });

      it("readonly allows read tools", () => {
        const perm = ToolPermissions.readonly();
        const result = perm.check("read", null);

        assert.equal(result.allowed, true);
      });

      it("readonly allows safe bash commands", () => {
        const perm = ToolPermissions.readonly();
        const result = perm.check("bash", "ls -la");

        assert.equal(result.allowed, true);
      });

      it("readonly blocks write bash commands", () => {
        const perm = ToolPermissions.readonly();
        const result = perm.check("bash", "rm -rf /tmp/test");

        assert.equal(result.allowed, false);
      });

      it("standard allows most tools", () => {
        const perm = ToolPermissions.standard();
        const result = perm.check("write", null);

        assert.equal(result.allowed, true);
      });

      it("standard blocks dangerous bash", () => {
        const perm = ToolPermissions.standard();
        const result = perm.check("bash", "rm -rf /");

        assert.equal(result.allowed, false);
      });
    });

    describe("chain methods", () => {
      it("block() adds tools to blocklist", () => {
        const perm = ToolPermissions.standard().block(["custom_tool"]);
        const result = perm.check("custom_tool", null);

        assert.equal(result.allowed, false);
      });

      it("allow() adds tools to allowlist", () => {
        const perm = ToolPermissions.custom({ allowedTools: [] }).allow(["my_tool"]);
        const restrictions = perm.getRestrictions();

        assert.ok(restrictions.allowedTools.includes("my_tool"));
      });

      it("blockBash() adds commands to blocklist", () => {
        const perm = ToolPermissions.standard().blockBash(["npm publish"]);
        const result = perm.check("bash", "npm publish");

        assert.equal(result.allowed, false);
      });

      it("allowBash() adds commands to allowlist", () => {
        const perm = ToolPermissions.readonly().allowBash(["npm test"]);
        const restrictions = perm.getRestrictions();

        assert.ok(restrictions.bash.allowedCommands.includes("npm test"));
      });

      it("methods are chainable", () => {
        const perm = ToolPermissions.standard()
          .block(["tool1", "tool2"])
          .blockBash(["cmd1"]);

        assert.ok(perm.check("tool1", null).allowed === false);
        assert.ok(perm.check("tool2", null).allowed === false);
      });
    });

    describe("strict mode", () => {
      it("rejects unlisted tools", () => {
        const perm = new ToolPermissions({
          level: "custom",
          restrictions: { allowedTools: ["read", "glob"] },
          strict: true,
        });

        const result = perm.check("write", null);
        assert.equal(result.allowed, false);
        // Reason can be 'tool_not_in_allowlist' (strict mode) or 'tool_not_allowed' (blocklist)
        assert.ok(["tool_not_in_allowlist", "tool_not_allowed"].includes(result.reason));
      });

      it("allows listed tools", () => {
        const perm = new ToolPermissions({
          level: "custom",
          restrictions: { allowedTools: ["read", "glob"] },
          strict: true,
        });

        const result = perm.check("read", null);
        assert.equal(result.allowed, true);
      });
    });

    describe("createHook", () => {
      it("returns a hook function", () => {
        const perm = ToolPermissions.readonly();
        const hook = perm.createHook();

        assert.equal(typeof hook, "function");
      });

      it("hook blocks disallowed tools", () => {
        const perm = ToolPermissions.readonly();
        const hook = perm.createHook();

        const result = hook({ tool: "write", params: {} });

        assert.equal(result.skip, true);
        assert.equal(result.value.ok, false);
      });

      it("hook allows permitted tools", () => {
        const perm = ToolPermissions.readonly();
        const hook = perm.createHook();

        const result = hook({ tool: "read", params: {} });

        assert.equal(result, null);
      });

      it("hook extracts command from params", () => {
        const perm = ToolPermissions.readonly();
        const hook = perm.createHook();

        const result = hook({ tool: "bash", params: { command: "rm -rf /" } });

        assert.equal(result.skip, true);
      });
    });

    describe("serialization", () => {
      it("toJSON exports config", () => {
        const perm = ToolPermissions.standard();
        const json = perm.toJSON();

        assert.equal(json.level, "standard");
        assert.equal(typeof json.restrictions, "object");
        assert.equal(json.strict, false);
      });

      it("fromJSON restores permissions", () => {
        const original = ToolPermissions.readonly().block(["extra"]);
        const json = original.toJSON();
        const restored = ToolPermissions.fromJSON(json);

        assert.equal(restored.getLevel(), "readonly");
        assert.equal(restored.check("extra", null).allowed, false);
      });

      it("fromJSON handles invalid input", () => {
        const perm = ToolPermissions.fromJSON(null);
        assert.equal(perm.getLevel(), "standard");
      });
    });
  });
});

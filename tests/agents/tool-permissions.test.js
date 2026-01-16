
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  ToolPermissions,
  PermissionLevel,
  getPresetRestrictions,
  mergeRestrictions,
} from "../../js/agents/runtime/safety/tool-permissions.js";

describe("runtime/safety/tool-permissions", () => {
  describe("PermissionLevel enum", () => {
    it("exports all expected levels", () => {
      expect(PermissionLevel.READONLY).toBe("readonly");
      expect(PermissionLevel.STANDARD).toBe("standard");
      expect(PermissionLevel.ELEVATED).toBe("elevated");
      expect(PermissionLevel.CUSTOM).toBe("custom");
    });
  });

  describe("getPresetRestrictions", () => {
    it("returns restrictions for readonly level", () => {
      const restrictions = getPresetRestrictions("readonly");

      expect(Array.isArray(restrictions.blockedTools)).toBeTruthy();
      expect(restrictions.blockedTools.includes("write")).toBeTruthy();
      expect(restrictions.blockedTools.includes("edit")).toBeTruthy();
      expect(Array.isArray(restrictions.bash.allowedCommands)).toBeTruthy();
    });

    it("returns restrictions for standard level", () => {
      const restrictions = getPresetRestrictions("standard");

      expect(Array.isArray(restrictions.bash.blockedCommands)).toBeTruthy();
      expect(restrictions.bash.blockedCommands.some(cmd => cmd.includes("rm -rf")));
    });

    it("returns restrictions for elevated level", () => {
      const restrictions = getPresetRestrictions("elevated");

      expect(Array.isArray(restrictions.bash.blockedCommands)).toBeTruthy();
      // Elevated has fewer restrictions
      expect(restrictions.bash.blockedCommands.length <= 5).toBeTruthy();
    });

    it("returns null for custom level", () => {
      const restrictions = getPresetRestrictions("custom");
      expect(restrictions).toBe(null);
    });
  });

  describe("mergeRestrictions", () => {
    it("merges two restriction sets", () => {
      const base = { blockedTools: ["tool1"] };
      const override = { blockedTools: ["tool2"] };

      const merged = mergeRestrictions(base, override);

      expect(merged.blockedTools.includes("tool1")).toBeTruthy();
      expect(merged.blockedTools.includes("tool2")).toBeTruthy();
    });

    it("override allowedCommands replaces base", () => {
      const base = { bash: { allowedCommands: ["ls", "cat"] } };
      const override = { bash: { allowedCommands: ["pwd"] } };

      const merged = mergeRestrictions(base, override);

      expect(merged.bash.allowedCommands).toEqual(["pwd"]);
    });
  });

  describe("ToolPermissions class", () => {
    describe("static factory methods", () => {
      it("readonly() creates readonly permissions", () => {
        const perm = ToolPermissions.readonly();
        expect(perm.getLevel()).toBe("readonly");
      });

      it("standard() creates standard permissions", () => {
        const perm = ToolPermissions.standard();
        expect(perm.getLevel()).toBe("standard");
      });

      it("elevated() creates elevated permissions", () => {
        const perm = ToolPermissions.elevated();
        expect(perm.getLevel()).toBe("elevated");
      });

      it("custom() creates custom permissions", () => {
        const perm = ToolPermissions.custom({ blockedTools: ["foo"] });
        expect(perm.getLevel()).toBe("custom");
      });
    });

    describe("check method", () => {
      it("readonly blocks write tools", () => {
        const perm = ToolPermissions.readonly();
        const result = perm.check("write", null);

        expect(result.allowed).toBe(false);
        expect(result.reason?.includes("blocked")).toBeTruthy();
      });

      it("readonly allows read tools", () => {
        const perm = ToolPermissions.readonly();
        const result = perm.check("read", null);

        expect(result.allowed).toBe(true);
      });

      it("readonly allows safe bash commands", () => {
        const perm = ToolPermissions.readonly();
        const result = perm.check("bash", "ls -la");

        expect(result.allowed).toBe(true);
      });

      it("readonly blocks write bash commands", () => {
        const perm = ToolPermissions.readonly();
        const result = perm.check("bash", "rm -rf /tmp/test");

        expect(result.allowed).toBe(false);
      });

      it("standard allows most tools", () => {
        const perm = ToolPermissions.standard();
        const result = perm.check("write", null);

        expect(result.allowed).toBe(true);
      });

      it("standard blocks dangerous bash", () => {
        const perm = ToolPermissions.standard();
        const result = perm.check("bash", "rm -rf /");

        expect(result.allowed).toBe(false);
      });
    });

    describe("chain methods", () => {
      it("block() adds tools to blocklist", () => {
        const perm = ToolPermissions.standard().block(["custom_tool"]);
        const result = perm.check("custom_tool", null);

        expect(result.allowed).toBe(false);
      });

      it("allow() adds tools to allowlist", () => {
        const perm = ToolPermissions.custom({ allowedTools: [] }).allow(["my_tool"]);
        const restrictions = perm.getRestrictions();

        expect(restrictions.allowedTools.includes("my_tool")).toBeTruthy();
      });

      it("blockBash() adds commands to blocklist", () => {
        const perm = ToolPermissions.standard().blockBash(["npm publish"]);
        const result = perm.check("bash", "npm publish");

        expect(result.allowed).toBe(false);
      });

      it("allowBash() adds commands to allowlist", () => {
        const perm = ToolPermissions.readonly().allowBash(["npm test"]);
        const restrictions = perm.getRestrictions();

        expect(restrictions.bash.allowedCommands.includes("npm test")).toBeTruthy();
      });

      it("methods are chainable", () => {
        const perm = ToolPermissions.standard()
          .block(["tool1", "tool2"])
          .blockBash(["cmd1"]);

        expect(perm.check("tool1", null).allowed).toBe(false);
        expect(perm.check("tool2", null).allowed).toBe(false);
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
        expect(result.allowed).toBe(false);
        // Reason can be 'tool_not_in_allowlist' (strict mode) or 'tool_not_allowed' (blocklist)
        expect(["tool_not_in_allowlist", "tool_not_allowed"].includes(result.reason)).toBeTruthy();
      });

      it("allows listed tools", () => {
        const perm = new ToolPermissions({
          level: "custom",
          restrictions: { allowedTools: ["read", "glob"] },
          strict: true,
        });

        const result = perm.check("read", null);
        expect(result.allowed).toBe(true);
      });
    });

    describe("createHook", () => {
      it("returns a hook function", () => {
        const perm = ToolPermissions.readonly();
        const hook = perm.createHook();

        expect(typeof hook).toBe("function");
      });

      it("hook blocks disallowed tools", () => {
        const perm = ToolPermissions.readonly();
        const hook = perm.createHook();

        const result = hook({ tool: "write", params: {} });

        expect(result.skip).toBe(true);
        expect(result.value.ok).toBe(false);
      });

      it("hook allows permitted tools", () => {
        const perm = ToolPermissions.readonly();
        const hook = perm.createHook();

        const result = hook({ tool: "read", params: {} });

        expect(result).toBe(null);
      });

      it("hook extracts command from params", () => {
        const perm = ToolPermissions.readonly();
        const hook = perm.createHook();

        const result = hook({ tool: "bash", params: { command: "rm -rf /" } });

        expect(result.skip).toBe(true);
      });
    });

    describe("serialization", () => {
      it("toJSON exports config", () => {
        const perm = ToolPermissions.standard();
        const json = perm.toJSON();

        expect(json.level).toBe("standard");
        expect(typeof json.restrictions).toBe("object");
        expect(json.strict).toBe(false);
      });

      it("fromJSON restores permissions", () => {
        const original = ToolPermissions.readonly().block(["extra"]);
        const json = original.toJSON();
        const restored = ToolPermissions.fromJSON(json);

        expect(restored.getLevel()).toBe("readonly");
        expect(restored.check("extra").allowed).toBe(false);
      });

      it("fromJSON handles invalid input", () => {
        const perm = ToolPermissions.fromJSON(null);
        expect(perm.getLevel()).toBe("standard");
      });
    });
  });
});

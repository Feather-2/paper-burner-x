
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  SkillScope,
  SkillRuntime,
} from "../../js/agents/skills/model.js";

describe("skills/model", () => {
  describe("SkillScope", () => {
    it("exports frozen object", () => {
      expect(Object.isFrozen(SkillScope)).toBeTruthy();
    });

    it("has SYSTEM scope", () => {
      expect(SkillScope.SYSTEM).toBe("system");
    });

    it("has USER scope", () => {
      expect(SkillScope.USER).toBe("user");
    });

    it("has REPO scope", () => {
      expect(SkillScope.REPO).toBe("repo");
    });

    it("has REMOTE scope", () => {
      expect(SkillScope.REMOTE).toBe("remote");
    });
  });

  describe("SkillRuntime", () => {
    it("exports frozen object", () => {
      expect(Object.isFrozen(SkillRuntime)).toBeTruthy();
    });

    it("has JS runtime", () => {
      expect(SkillRuntime.JS).toBe("js");
    });

    it("has PYTHON runtime", () => {
      expect(SkillRuntime.PYTHON).toBe("python");
    });
  });
});

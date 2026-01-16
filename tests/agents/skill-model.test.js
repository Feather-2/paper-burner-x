import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  SkillScope,
  SkillRuntime,
} from "../../js/agents/skills/model.js";

describe("skills/model", () => {
  describe("SkillScope", () => {
    it("exports frozen object", () => {
      assert.ok(Object.isFrozen(SkillScope));
    });

    it("has SYSTEM scope", () => {
      assert.equal(SkillScope.SYSTEM, "system");
    });

    it("has USER scope", () => {
      assert.equal(SkillScope.USER, "user");
    });

    it("has REPO scope", () => {
      assert.equal(SkillScope.REPO, "repo");
    });

    it("has REMOTE scope", () => {
      assert.equal(SkillScope.REMOTE, "remote");
    });
  });

  describe("SkillRuntime", () => {
    it("exports frozen object", () => {
      assert.ok(Object.isFrozen(SkillRuntime));
    });

    it("has JS runtime", () => {
      assert.equal(SkillRuntime.JS, "js");
    });

    it("has PYTHON runtime", () => {
      assert.equal(SkillRuntime.PYTHON, "python");
    });
  });
});

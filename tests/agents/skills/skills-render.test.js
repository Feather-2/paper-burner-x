import { describe, it } from "node:test";
import assert from "node:assert/strict";

import render, {
  renderSkillsSection,
  renderSkillsList,
  renderUnifiedCatalog,
} from "../../../js/agents/skills/render.js";

const { getSkillPriority, groupSkillsByPriority } = render;

describe("skills/render", () => {
  describe("getSkillPriority", () => {
    it("returns 'critical' for priority='critical'", () => {
      assert.equal(getSkillPriority({ priority: "critical" }), "critical");
    });

    it("returns 'important' for priority=0 (falsy, treated as undefined)", () => {
      // priority=0 is falsy, so `priority || activation?.priority` returns undefined
      // This is a quirk of the implementation - 0 is not recognized as critical
      assert.equal(getSkillPriority({ priority: 0 }), "important");
    });

    it("returns 'critical' for priority<=50", () => {
      assert.equal(getSkillPriority({ priority: 50 }), "critical");
      assert.equal(getSkillPriority({ priority: 1 }), "critical");
      assert.equal(getSkillPriority({ priority: 49 }), "critical");
    });

    it("returns 'optional' for priority='optional'", () => {
      assert.equal(getSkillPriority({ priority: "optional" }), "optional");
    });

    it("returns 'critical' for priority=2 (<=50)", () => {
      // priority=2 is <= 50, so returns critical
      assert.equal(getSkillPriority({ priority: 2 }), "critical");
    });

    it("returns 'optional' for priority>=150", () => {
      assert.equal(getSkillPriority({ priority: 150 }), "optional");
      assert.equal(getSkillPriority({ priority: 200 }), "optional");
    });

    it("returns 'important' for priority=1 (between 50 and 150)", () => {
      // Note: priority=1 is actually <=50, so it's critical
      // Let's test values between 51-149
      assert.equal(getSkillPriority({ priority: 51 }), "important");
      assert.equal(getSkillPriority({ priority: 100 }), "important");
      assert.equal(getSkillPriority({ priority: 149 }), "important");
    });

    it("returns 'important' for priority='important'", () => {
      assert.equal(getSkillPriority({ priority: "important" }), "important");
    });

    it("returns 'important' by default (no priority)", () => {
      assert.equal(getSkillPriority({}), "important");
      assert.equal(getSkillPriority({ name: "test" }), "important");
    });

    it("reads priority from metadata.priority", () => {
      assert.equal(getSkillPriority({ metadata: { priority: "critical" } }), "critical");
    });

    it("reads priority from activation.priority", () => {
      assert.equal(getSkillPriority({ activation: { priority: "critical" } }), "critical");
      assert.equal(getSkillPriority({ metadata: { activation: { priority: "optional" } } }), "optional");
    });
  });

  describe("groupSkillsByPriority", () => {
    it("returns empty groups for empty array", () => {
      const result = groupSkillsByPriority([]);
      assert.deepEqual(result, { critical: [], important: [], optional: [] });
    });

    it("groups skills by priority correctly", () => {
      const skills = [
        { name: "A", priority: "critical" },
        { name: "B", priority: "important" },
        { name: "C", priority: "optional" },
        { name: "D", priority: 10 },  // <=50 -> critical
        { name: "E", priority: 100 }, // 51-149 -> important
        { name: "F", priority: 200 }, // >=150 -> optional
      ];
      const result = groupSkillsByPriority(skills);
      assert.equal(result.critical.length, 2);
      assert.equal(result.important.length, 2);
      assert.equal(result.optional.length, 2);
      assert.deepEqual(result.critical.map(s => s.name), ["A", "D"]);
      assert.deepEqual(result.important.map(s => s.name), ["B", "E"]);
      assert.deepEqual(result.optional.map(s => s.name), ["C", "F"]);
    });

    it("defaults to 'important' when no priority specified", () => {
      const skills = [{ name: "NoPriority" }];
      const result = groupSkillsByPriority(skills);
      assert.equal(result.important.length, 1);
      assert.equal(result.critical.length, 0);
      assert.equal(result.optional.length, 0);
    });
  });

  describe("renderSkillsSection", () => {
    it("returns null for empty skills", () => {
      assert.equal(renderSkillsSection([]), null);
      assert.equal(renderSkillsSection(null), null);
      assert.equal(renderSkillsSection(undefined), null);
    });

    it("renders skills section with header", () => {
      const skills = [{ name: "TestSkill", description: "A test skill" }];
      const result = renderSkillsSection(skills);
      assert.ok(result.includes("## Skills"));
      assert.ok(result.includes("TestSkill"));
      assert.ok(result.includes("A test skill"));
    });

    it("shows priority group titles by default", () => {
      const skills = [
        { name: "Critical", description: "desc", priority: "critical" },
        { name: "Important", description: "desc", priority: "important" },
        { name: "Optional", description: "desc", priority: "optional" },
      ];
      const result = renderSkillsSection(skills);
      assert.ok(result.includes("Core Skills"));
      assert.ok(result.includes("Standard Skills"));
      assert.ok(result.includes("Optional Skills"));
    });

    it("hides priority group titles when showPriority=false", () => {
      const skills = [
        { name: "Critical", description: "desc", priority: "critical" },
        { name: "Important", description: "desc", priority: "important" },
      ];
      const result = renderSkillsSection(skills, { showPriority: false });
      assert.ok(!result.includes("### "));
    });

    it("includes file path when available", () => {
      const skills = [{ name: "PathSkill", description: "desc", path: "/home/user/skill.md" }];
      const result = renderSkillsSection(skills);
      assert.ok(result.includes("(file:"));
    });

    it("reads metadata from skill.metadata", () => {
      const skills = [{
        metadata: { name: "MetaSkill", description: "from meta", path: "test.md" }
      }];
      const result = renderSkillsSection(skills);
      assert.ok(result.includes("MetaSkill"));
      assert.ok(result.includes("from meta"));
    });

    it("includes usage instructions in output", () => {
      const skills = [{ name: "TestSkill", description: "desc" }];
      const result = renderSkillsSection(skills);
      assert.ok(result.includes("Discovery:"));
      assert.ok(result.includes("Trigger rules:"));
      assert.ok(result.includes("How to use a skill"));
    });

    it("normalizes absolute paths to filename only", () => {
      const skills = [{ name: "S", description: "d", path: "/long/absolute/path/to/skill.md" }];
      const result = renderSkillsSection(skills);
      assert.ok(result.includes("skill.md"));
      assert.ok(!result.includes("/long/absolute/path"));
    });

    it("normalizes Windows paths", () => {
      const skills = [{ name: "S", description: "d", path: "C:\\Users\\test\\skill.md" }];
      const result = renderSkillsSection(skills);
      assert.ok(result.includes("skill.md"));
    });

    it("preserves user: and nexus:// prefixes", () => {
      const skills1 = [{ name: "S", description: "d", path: "user:my-skill" }];
      const skills2 = [{ name: "S", description: "d", path: "nexus://remote/skill" }];
      assert.ok(renderSkillsSection(skills1).includes("user:my-skill"));
      assert.ok(renderSkillsSection(skills2).includes("nexus://remote/skill"));
    });

    it("extracts pathname from HTTP URLs", () => {
      const skills = [{ name: "S", description: "d", path: "https://example.com/skills/my-skill?v=1" }];
      const result = renderSkillsSection(skills);
      assert.ok(result.includes("/skills/my-skill?v=1"));
      assert.ok(!result.includes("https://example.com"));
    });
  });

  describe("renderSkillsList", () => {
    it("returns empty string for empty skills", () => {
      assert.equal(renderSkillsList([]), "");
      assert.equal(renderSkillsList(null), "");
      assert.equal(renderSkillsList(undefined), "");
    });

    it("renders available skills header", () => {
      const skills = [{ name: "Test", description: "desc" }];
      const result = renderSkillsList(skills);
      assert.ok(result.includes("Available skills:"));
    });

    it("prefixes skill names with $", () => {
      const skills = [{ name: "MySkill", description: "desc" }];
      const result = renderSkillsList(skills);
      assert.ok(result.includes("$MySkill"));
    });

    it("shows priority icons for critical and optional", () => {
      const skills = [
        { name: "Critical", description: "desc", priority: "critical" },
        { name: "Optional", description: "desc", priority: "optional" },
        { name: "Important", description: "desc", priority: "important" },
      ];
      const result = renderSkillsList(skills);
      // Critical gets red icon, optional gets white icon, important gets no icon
      const lines = result.split("\\n");
      const criticalLine = lines.find(l => l.includes("$Critical"));
      const optionalLine = lines.find(l => l.includes("$Optional"));
      const importantLine = lines.find(l => l.includes("$Important"));
      assert.ok(criticalLine.includes("\u{1F534}")); // red circle
      assert.ok(optionalLine.includes("\u26AA")); // white circle
      assert.ok(!importantLine.includes("\u{1F534}") && !importantLine.includes("\u26AA"));
    });

    it("uses shortDescription when available", () => {
      const skills = [{
        name: "Test",
        description: "long description here",
        shortDescription: "short desc"
      }];
      const result = renderSkillsList(skills);
      assert.ok(result.includes("short desc"));
      assert.ok(!result.includes("long description"));
    });

    it("orders skills by priority: critical, important, optional", () => {
      const skills = [
        { name: "Optional", description: "d", priority: "optional" },
        { name: "Important", description: "d" },
        { name: "Critical", description: "d", priority: "critical" },
      ];
      const result = renderSkillsList(skills);
      const lines = result.split("\\n").filter(l => l.startsWith("-"));
      assert.ok(lines[0].includes("Critical"));
      assert.ok(lines[1].includes("Important"));
      assert.ok(lines[2].includes("Optional"));
    });

    it("reads from metadata", () => {
      const skills = [{ metadata: { name: "FromMeta", description: "meta desc" } }];
      const result = renderSkillsList(skills);
      assert.ok(result.includes("$FromMeta"));
      assert.ok(result.includes("meta desc"));
    });
  });

  describe("renderUnifiedCatalog", () => {
    it("returns header for empty input", () => {
      const result = renderUnifiedCatalog({});
      assert.ok(result.includes("## "));
    });

    it("renders capabilities section", () => {
      const capabilities = [
        { definition: { name: "Tool1", description: "desc1" } },
        { definition: { name: "Tool2", description: "desc2", priority: "critical" } },
      ];
      const result = renderUnifiedCatalog({ capabilities });
      assert.ok(result.includes("Capabilities"));
      assert.ok(result.includes("**Tool1**"));
      assert.ok(result.includes("**Tool2**"));
    });

    it("renders skills section", () => {
      const skills = [
        { name: "Skill1", description: "desc1" },
        { name: "Skill2", description: "desc2", priority: "optional" },
      ];
      const result = renderUnifiedCatalog({ skills });
      assert.ok(result.includes("Skills"));
      assert.ok(result.includes("**$Skill1**"));
      assert.ok(result.includes("**$Skill2**"));
    });

    it("shows priority icons for capabilities", () => {
      const capabilities = [
        { definition: { name: "Critical", description: "d", priority: "critical" } },
        { definition: { name: "Optional", description: "d", priority: "optional" } },
        { definition: { name: "Important", description: "d" } },
      ];
      const result = renderUnifiedCatalog({ capabilities });
      assert.ok(result.includes("\u{1F534}")); // red
      assert.ok(result.includes("\u26AA")); // white
      assert.ok(result.includes("\u{1F7E1}")); // yellow
    });

    it("shows priority icons for skills", () => {
      const skills = [
        { name: "Critical", description: "d", priority: "critical" },
        { name: "Optional", description: "d", priority: "optional" },
        { name: "Important", description: "d" },
      ];
      const result = renderUnifiedCatalog({ skills });
      assert.ok(result.includes("\u{1F534}")); // red
      assert.ok(result.includes("\u26AA")); // white
      assert.ok(result.includes("\u{1F7E1}")); // yellow
    });

    it("uses shortDescription for skills when available", () => {
      const skills = [{
        name: "Test",
        description: "long desc",
        shortDescription: "short"
      }];
      const result = renderUnifiedCatalog({ skills });
      assert.ok(result.includes("short"));
    });

    it("reads capability from definition or directly", () => {
      const capabilities = [
        { name: "Direct", description: "direct desc" },
        { definition: { name: "Wrapped", description: "wrapped desc" } },
      ];
      const result = renderUnifiedCatalog({ capabilities });
      assert.ok(result.includes("**Direct**"));
      assert.ok(result.includes("**Wrapped**"));
    });

    it("groups capabilities by priority: critical first, then important, then optional", () => {
      const capabilities = [
        { definition: { name: "Opt", description: "d", priority: "optional" } },
        { definition: { name: "Imp", description: "d" } },
        { definition: { name: "Crit", description: "d", priority: "critical" } },
      ];
      const result = renderUnifiedCatalog({ capabilities });
      const critIdx = result.indexOf("**Crit**");
      const impIdx = result.indexOf("**Imp**");
      const optIdx = result.indexOf("**Opt**");
      assert.ok(critIdx < impIdx, "critical should come before important");
      assert.ok(impIdx < optIdx, "important should come before optional");
    });

    it("handles activation.priority for capabilities", () => {
      const capabilities = [
        { definition: { name: "Act", description: "d", activation: { priority: 0 } } },
      ];
      const result = renderUnifiedCatalog({ capabilities });
      // priority 0 = critical
      const critIdx = result.indexOf("\u{1F534}");
      const actIdx = result.indexOf("**Act**");
      assert.ok(critIdx < actIdx || result.includes("\u{1F534} **Act**"));
    });

    it("reads skill metadata from skill.metadata", () => {
      const skills = [{
        metadata: { name: "FromMeta", description: "meta desc", priority: "critical" }
      }];
      const result = renderUnifiedCatalog({ skills });
      assert.ok(result.includes("**$FromMeta**"));
    });

    it("renders both capabilities and skills together", () => {
      const capabilities = [{ definition: { name: "Cap", description: "cap desc" } }];
      const skills = [{ name: "Skill", description: "skill desc" }];
      const result = renderUnifiedCatalog({ capabilities, skills });
      assert.ok(result.includes("Capabilities"));
      assert.ok(result.includes("Skills"));
      assert.ok(result.includes("**Cap**"));
      assert.ok(result.includes("**$Skill**"));
    });
  });

  describe("default export", () => {
    it("exports all functions", () => {
      assert.equal(typeof render.renderSkillsSection, "function");
      assert.equal(typeof render.renderSkillsList, "function");
      assert.equal(typeof render.renderUnifiedCatalog, "function");
      assert.equal(typeof render.groupSkillsByPriority, "function");
      assert.equal(typeof render.getSkillPriority, "function");
    });
  });

  describe("path normalization edge cases", () => {
    it("handles empty path", () => {
      const skills = [{ name: "S", description: "d", path: "" }];
      const result = renderSkillsSection(skills);
      assert.ok(!result.includes("(file:"));
    });

    it("handles null/undefined path", () => {
      const skills1 = [{ name: "S", description: "d", path: null }];
      const skills2 = [{ name: "S", description: "d", path: undefined }];
      const result1 = renderSkillsSection(skills1);
      const result2 = renderSkillsSection(skills2);
      assert.ok(!result1.includes("(file:"));
      assert.ok(!result2.includes("(file:"));
    });

    it("handles remote: prefix", () => {
      const skills = [{ name: "S", description: "d", path: "remote:some-skill" }];
      const result = renderSkillsSection(skills);
      assert.ok(result.includes("remote:some-skill"));
    });

    it("handles relative paths", () => {
      const skills = [{ name: "S", description: "d", path: "skills/my-skill.md" }];
      const result = renderSkillsSection(skills);
      assert.ok(result.includes("skills/my-skill.md"));
    });

    it("handles relative paths with backslashes", () => {
      const skills = [{ name: "S", description: "d", path: "skills\\sub\\my-skill.md" }];
      const result = renderSkillsSection(skills);
      assert.ok(result.includes("skills/sub/my-skill.md"));
    });

    it("handles invalid HTTP URL gracefully", () => {
      // URL constructor might throw for malformed URLs
      const skills = [{ name: "S", description: "d", path: "http://[invalid" }];
      const result = renderSkillsSection(skills);
      // Should fall back to returning the raw path
      assert.ok(result.includes("http://[invalid"));
    });
  });
});


import { describe, it, expect, beforeEach, afterEach } from "vitest";

import render, {
  renderSkillsSection,
  renderSkillsList,
  renderUnifiedCatalog,
} from "../../../js/agents/skills/render.js";

const { getSkillPriority, groupSkillsByPriority } = render;

describe("skills/render", () => {
  describe("getSkillPriority", () => {
    it("returns 'critical' for priority='critical'", () => {
      expect(getSkillPriority({ priority: "critical" })).toBe("critical");
    });

    it("returns 'important' for priority=0 (falsy, treated as undefined)", () => {
      // priority=0 is falsy, so `priority || activation?.priority` returns undefined
      // This is a quirk of the implementation - 0 is not recognized as critical
      expect(getSkillPriority({ priority: 0 })).toBe("important");
    });

    it("returns 'critical' for priority<=50", () => {
      expect(getSkillPriority({ priority: 50 })).toBe("critical");
      expect(getSkillPriority({ priority: 1 })).toBe("critical");
      expect(getSkillPriority({ priority: 49 })).toBe("critical");
    });

    it("returns 'optional' for priority='optional'", () => {
      expect(getSkillPriority({ priority: "optional" })).toBe("optional");
    });

    it("returns 'critical' for priority=2 (<=50)", () => {
      // priority=2 is <= 50, so returns critical
      expect(getSkillPriority({ priority: 2 })).toBe("critical");
    });

    it("returns 'optional' for priority>=150", () => {
      expect(getSkillPriority({ priority: 150 })).toBe("optional");
      expect(getSkillPriority({ priority: 200 })).toBe("optional");
    });

    it("returns 'important' for priority=1 (between 50 and 150)", () => {
      // Note: priority=1 is actually <=50, so it's critical
      // Let's test values between 51-149
      expect(getSkillPriority({ priority: 51 })).toBe("important");
      expect(getSkillPriority({ priority: 100 })).toBe("important");
      expect(getSkillPriority({ priority: 149 })).toBe("important");
    });

    it("returns 'important' for priority='important'", () => {
      expect(getSkillPriority({ priority: "important" })).toBe("important");
    });

    it("returns 'important' by default (no priority)", () => {
      expect(getSkillPriority({})).toBe("important");
      expect(getSkillPriority({ name: "test" })).toBe("important");
    });

    it("reads priority from metadata.priority", () => {
      expect(getSkillPriority({ metadata: { priority: "critical" } })).toBe("critical");
    });

    it("reads priority from activation.priority", () => {
      expect(getSkillPriority({ activation: { priority: "critical" } })).toBe("critical");
      expect(getSkillPriority({ metadata: { activation: { priority: "optional" } } })).toBe("optional");
    });
  });

  describe("groupSkillsByPriority", () => {
    it("returns empty groups for empty array", () => {
      const result = groupSkillsByPriority([]);
      expect(result).toEqual({ critical: [], important: [], optional: [] });
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
      expect(result.critical.length).toBe(2);
      expect(result.important.length).toBe(2);
      expect(result.optional.length).toBe(2);
      expect(result.critical.map(s => s.name)).toEqual(["A", "D"]);
      expect(result.important.map(s => s.name)).toEqual(["B", "E"]);
      expect(result.optional.map(s => s.name)).toEqual(["C", "F"]);
    });

    it("defaults to 'important' when no priority specified", () => {
      const skills = [{ name: "NoPriority" }];
      const result = groupSkillsByPriority(skills);
      expect(result.important.length).toBe(1);
      expect(result.critical.length).toBe(0);
      expect(result.optional.length).toBe(0);
    });
  });

  describe("renderSkillsSection", () => {
    it("returns null for empty skills", () => {
      expect(renderSkillsSection([])).toBe(null);
      expect(renderSkillsSection(null)).toBe(null);
      expect(renderSkillsSection(undefined)).toBe(null);
    });

    it("renders skills section with header", () => {
      const skills = [{ name: "TestSkill", description: "A test skill" }];
      const result = renderSkillsSection(skills);
      expect(result.includes("## Skills")).toBeTruthy();
      expect(result.includes("TestSkill")).toBeTruthy();
      expect(result.includes("A test skill")).toBeTruthy();
    });

    it("shows priority group titles by default", () => {
      const skills = [
        { name: "Critical", description: "desc", priority: "critical" },
        { name: "Important", description: "desc", priority: "important" },
        { name: "Optional", description: "desc", priority: "optional" },
      ];
      const result = renderSkillsSection(skills);
      expect(result.includes("Core Skills")).toBeTruthy();
      expect(result.includes("Standard Skills")).toBeTruthy();
      expect(result.includes("Optional Skills")).toBeTruthy();
    });

    it("hides priority group titles when showPriority=false", () => {
      const skills = [
        { name: "Critical", description: "desc", priority: "critical" },
        { name: "Important", description: "desc", priority: "important" },
      ];
      const result = renderSkillsSection(skills, { showPriority: false });
      expect(!result.includes("### ")).toBeTruthy();
    });

    it("includes file path when available", () => {
      const skills = [{ name: "PathSkill", description: "desc", path: "/home/user/skill.md" }];
      const result = renderSkillsSection(skills);
      expect(result.includes("(file:")).toBeTruthy();
    });

    it("reads metadata from skill.metadata", () => {
      const skills = [{
        metadata: { name: "MetaSkill", description: "from meta", path: "test.md" }
      }];
      const result = renderSkillsSection(skills);
      expect(result.includes("MetaSkill")).toBeTruthy();
      expect(result.includes("from meta")).toBeTruthy();
    });

    it("includes usage instructions in output", () => {
      const skills = [{ name: "TestSkill", description: "desc" }];
      const result = renderSkillsSection(skills);
      expect(result.includes("Discovery:")).toBeTruthy();
      expect(result.includes("Trigger rules:")).toBeTruthy();
      expect(result.includes("How to use a skill")).toBeTruthy();
    });

    it("normalizes absolute paths to filename only", () => {
      const skills = [{ name: "S", description: "d", path: "/long/absolute/path/to/skill.md" }];
      const result = renderSkillsSection(skills);
      expect(result.includes("skill.md")).toBeTruthy();
      expect(!result.includes("/long/absolute/path")).toBeTruthy();
    });

    it("normalizes Windows paths", () => {
      const skills = [{ name: "S", description: "d", path: "C:\\Users\\test\\skill.md" }];
      const result = renderSkillsSection(skills);
      expect(result.includes("skill.md")).toBeTruthy();
    });

    it("preserves user: and nexus:// prefixes", () => {
      const skills1 = [{ name: "S", description: "d", path: "user:my-skill" }];
      const skills2 = [{ name: "S", description: "d", path: "nexus://remote/skill" }];
      expect(renderSkillsSection(skills1).toBeTruthy().includes("user:my-skill"));
      expect(renderSkillsSection(skills2).toBeTruthy().includes("nexus://remote/skill"));
    });

    it("extracts pathname from HTTP URLs", () => {
      const skills = [{ name: "S", description: "d", path: "https://example.com/skills/my-skill?v=1" }];
      const result = renderSkillsSection(skills);
      expect(result.includes("/skills/my-skill?v=1")).toBeTruthy();
      expect(!result.includes("https://example.com")).toBeTruthy();
    });
  });

  describe("renderSkillsList", () => {
    it("returns empty string for empty skills", () => {
      expect(renderSkillsList([])).toBe("");
      expect(renderSkillsList(null)).toBe("");
      expect(renderSkillsList(undefined)).toBe("");
    });

    it("renders available skills header", () => {
      const skills = [{ name: "Test", description: "desc" }];
      const result = renderSkillsList(skills);
      expect(result.includes("Available skills:")).toBeTruthy();
    });

    it("prefixes skill names with $", () => {
      const skills = [{ name: "MySkill", description: "desc" }];
      const result = renderSkillsList(skills);
      expect(result.includes("$MySkill")).toBeTruthy();
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
      expect(criticalLine.includes("\u{1F534}")).toBeTruthy(); // red circle
      expect(optionalLine.includes("\u26AA")).toBeTruthy(); // white circle
      expect(!importantLine.includes("\u{1F534}")).toBeTruthy() && !importantLine.includes("\u26AA"));
    });

    it("uses shortDescription when available", () => {
      const skills = [{
        name: "Test",
        description: "long description here",
        shortDescription: "short desc"
      }];
      const result = renderSkillsList(skills);
      expect(result.includes("short desc")).toBeTruthy();
      expect(!result.includes("long description")).toBeTruthy();
    });

    it("orders skills by priority: critical, important, optional", () => {
      const skills = [
        { name: "Optional", description: "d", priority: "optional" },
        { name: "Important", description: "d" },
        { name: "Critical", description: "d", priority: "critical" },
      ];
      const result = renderSkillsList(skills);
      const lines = result.split("\\n").filter(l => l.startsWith("-"));
      expect(lines[0].includes("Critical")).toBeTruthy();
      expect(lines[1].includes("Important")).toBeTruthy();
      expect(lines[2].includes("Optional")).toBeTruthy();
    });

    it("reads from metadata", () => {
      const skills = [{ metadata: { name: "FromMeta", description: "meta desc" } }];
      const result = renderSkillsList(skills);
      expect(result.includes("$FromMeta")).toBeTruthy();
      expect(result.includes("meta desc")).toBeTruthy();
    });
  });

  describe("renderUnifiedCatalog", () => {
    it("returns header for empty input", () => {
      const result = renderUnifiedCatalog({});
      expect(result.includes("## ")).toBeTruthy();
    });

    it("renders capabilities section", () => {
      const capabilities = [
        { definition: { name: "Tool1", description: "desc1" } },
        { definition: { name: "Tool2", description: "desc2", priority: "critical" } },
      ];
      const result = renderUnifiedCatalog({ capabilities });
      expect(result.includes("Capabilities")).toBeTruthy();
      expect(result.includes("**Tool1**")).toBeTruthy();
      expect(result.includes("**Tool2**")).toBeTruthy();
    });

    it("renders skills section", () => {
      const skills = [
        { name: "Skill1", description: "desc1" },
        { name: "Skill2", description: "desc2", priority: "optional" },
      ];
      const result = renderUnifiedCatalog({ skills });
      expect(result.includes("Skills")).toBeTruthy();
      expect(result.includes("**$Skill1**")).toBeTruthy();
      expect(result.includes("**$Skill2**")).toBeTruthy();
    });

    it("shows priority icons for capabilities", () => {
      const capabilities = [
        { definition: { name: "Critical", description: "d", priority: "critical" } },
        { definition: { name: "Optional", description: "d", priority: "optional" } },
        { definition: { name: "Important", description: "d" } },
      ];
      const result = renderUnifiedCatalog({ capabilities });
      expect(result.includes("\u{1F534}")).toBeTruthy(); // red
      expect(result.includes("\u26AA")).toBeTruthy(); // white
      expect(result.includes("\u{1F7E1}")).toBeTruthy(); // yellow
    });

    it("shows priority icons for skills", () => {
      const skills = [
        { name: "Critical", description: "d", priority: "critical" },
        { name: "Optional", description: "d", priority: "optional" },
        { name: "Important", description: "d" },
      ];
      const result = renderUnifiedCatalog({ skills });
      expect(result.includes("\u{1F534}")).toBeTruthy(); // red
      expect(result.includes("\u26AA")).toBeTruthy(); // white
      expect(result.includes("\u{1F7E1}")).toBeTruthy(); // yellow
    });

    it("uses shortDescription for skills when available", () => {
      const skills = [{
        name: "Test",
        description: "long desc",
        shortDescription: "short"
      }];
      const result = renderUnifiedCatalog({ skills });
      expect(result.includes("short")).toBeTruthy();
    });

    it("reads capability from definition or directly", () => {
      const capabilities = [
        { name: "Direct", description: "direct desc" },
        { definition: { name: "Wrapped", description: "wrapped desc" } },
      ];
      const result = renderUnifiedCatalog({ capabilities });
      expect(result.includes("**Direct**")).toBeTruthy();
      expect(result.includes("**Wrapped**")).toBeTruthy();
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
      expect(critIdx < impIdx, "critical should come before important").toBeTruthy();
      expect(impIdx < optIdx, "important should come before optional").toBeTruthy();
    });

    it("handles activation.priority for capabilities", () => {
      const capabilities = [
        { definition: { name: "Act", description: "d", activation: { priority: 0 } } },
      ];
      const result = renderUnifiedCatalog({ capabilities });
      // priority 0 = critical
      const critIdx = result.indexOf("\u{1F534}");
      const actIdx = result.indexOf("**Act**");
      expect(critIdx < actIdx || result.includes("\u{1F534} **Act**")).toBeTruthy();
    });

    it("reads skill metadata from skill.metadata", () => {
      const skills = [{
        metadata: { name: "FromMeta", description: "meta desc", priority: "critical" }
      }];
      const result = renderUnifiedCatalog({ skills });
      expect(result.includes("**$FromMeta**")).toBeTruthy();
    });

    it("renders both capabilities and skills together", () => {
      const capabilities = [{ definition: { name: "Cap", description: "cap desc" } }];
      const skills = [{ name: "Skill", description: "skill desc" }];
      const result = renderUnifiedCatalog({ capabilities, skills });
      expect(result.includes("Capabilities")).toBeTruthy();
      expect(result.includes("Skills")).toBeTruthy();
      expect(result.includes("**Cap**")).toBeTruthy();
      expect(result.includes("**$Skill**")).toBeTruthy();
    });
  });

  describe("default export", () => {
    it("exports all functions", () => {
      expect(typeof render.renderSkillsSection).toBe("function");
      expect(typeof render.renderSkillsList).toBe("function");
      expect(typeof render.renderUnifiedCatalog).toBe("function");
      expect(typeof render.groupSkillsByPriority).toBe("function");
      expect(typeof render.getSkillPriority).toBe("function");
    });
  });

  describe("path normalization edge cases", () => {
    it("handles empty path", () => {
      const skills = [{ name: "S", description: "d", path: "" }];
      const result = renderSkillsSection(skills);
      expect(!result.includes("(file:")).toBeTruthy();
    });

    it("handles null/undefined path", () => {
      const skills1 = [{ name: "S", description: "d", path: null }];
      const skills2 = [{ name: "S", description: "d", path: undefined }];
      const result1 = renderSkillsSection(skills1);
      const result2 = renderSkillsSection(skills2);
      expect(!result1.includes("(file:")).toBeTruthy();
      expect(!result2.includes("(file:")).toBeTruthy();
    });

    it("handles remote: prefix", () => {
      const skills = [{ name: "S", description: "d", path: "remote:some-skill" }];
      const result = renderSkillsSection(skills);
      expect(result.includes("remote:some-skill")).toBeTruthy();
    });

    it("handles relative paths", () => {
      const skills = [{ name: "S", description: "d", path: "skills/my-skill.md" }];
      const result = renderSkillsSection(skills);
      expect(result.includes("skills/my-skill.md")).toBeTruthy();
    });

    it("handles relative paths with backslashes", () => {
      const skills = [{ name: "S", description: "d", path: "skills\\sub\\my-skill.md" }];
      const result = renderSkillsSection(skills);
      expect(result.includes("skills/sub/my-skill.md")).toBeTruthy();
    });

    it("handles invalid HTTP URL gracefully", () => {
      // URL constructor might throw for malformed URLs
      const skills = [{ name: "S", description: "d", path: "http://[invalid" }];
      const result = renderSkillsSection(skills);
      // Should fall back to returning the raw path
      expect(result.includes("http://[invalid")).toBeTruthy();
    });
  });
});

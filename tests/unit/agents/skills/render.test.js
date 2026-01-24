import { describe, it, expect, vi, beforeEach } from "vitest";

const toNonEmptyStringMock = vi.fn((value) => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed ? trimmed : "";
});

vi.mock("../../../../js/agents/shared/index.js", () => ({
  toNonEmptyString: toNonEmptyStringMock,
}));

const renderModule = await import("../../../../js/agents/skills/render.js");
const render = renderModule.default;
const { renderSkillsSection, renderSkillsList, renderUnifiedCatalog } = renderModule;
const { getSkillPriority, groupSkillsByPriority } = render;

describe("skills/render", () => {
  beforeEach(() => {
    toNonEmptyStringMock.mockClear();
    toNonEmptyStringMock.mockImplementation((value) => {
      if (typeof value !== "string") return "";
      const trimmed = value.trim();
      return trimmed ? trimmed : "";
    });
  });

  describe("getSkillPriority", () => {
    it("should_return_critical_when_priority_is_string_critical", () => {
      // Arrange
      const skill = { priority: "critical" };
      // Act
      const result = getSkillPriority(skill);
      // Assert
      expect(result).toBe("critical");
    });

    it("should_return_important_when_priority_is_zero_and_activation_is_missing", () => {
      const result = getSkillPriority({ priority: 0 });
      expect(result).toBe("important");
    });

    it("should_return_critical_when_activation_priority_is_zero", () => {
      const result = getSkillPriority({ activation: { priority: 0 } });
      expect(result).toBe("critical");
    });

    it("should_return_critical_when_priority_is_less_than_or_equal_to_50", () => {
      const result = getSkillPriority({ priority: 50 });
      expect(result).toBe("critical");
    });

    it("should_return_critical_when_priority_is_negative_number", () => {
      const result = getSkillPriority({ priority: -1 });
      expect(result).toBe("critical");
    });

    it("should_return_critical_when_priority_is_2_due_to_numeric_threshold", () => {
      const result = getSkillPriority({ priority: 2 });
      expect(result).toBe("critical");
    });

    it("should_return_optional_when_priority_is_string_optional", () => {
      const result = getSkillPriority({ priority: "optional" });
      expect(result).toBe("optional");
    });

    it("should_return_optional_when_priority_is_greater_than_or_equal_to_150", () => {
      const result = getSkillPriority({ priority: 150 });
      expect(result).toBe("optional");
    });

    it("should_return_optional_when_priority_is_max_safe_integer", () => {
      const result = getSkillPriority({ priority: Number.MAX_SAFE_INTEGER });
      expect(result).toBe("optional");
    });

    it("should_return_important_when_priority_is_between_51_and_149", () => {
      const result = getSkillPriority({ priority: 100 });
      expect(result).toBe("important");
    });

    it("should_return_important_when_priority_is_string_important", () => {
      const result = getSkillPriority({ priority: "important" });
      expect(result).toBe("important");
    });

    it("should_return_important_when_priority_is_missing", () => {
      const result = getSkillPriority({});
      expect(result).toBe("important");
    });

    it("should_read_priority_from_metadata_priority", () => {
      const result = getSkillPriority({ metadata: { priority: "critical" } });
      expect(result).toBe("critical");
    });

    it("should_read_priority_from_metadata_activation_priority", () => {
      const result = getSkillPriority({
        metadata: { activation: { priority: "optional" } },
      });
      expect(result).toBe("optional");
    });
  });

  describe("groupSkillsByPriority", () => {
    it("should_return_empty_groups_when_skills_is_empty_array", () => {
      const result = groupSkillsByPriority([]);
      expect(result).toEqual({ critical: [], important: [], optional: [] });
    });

    it("should_group_critical_skills_when_priorities_mixed", () => {
      const skills = [
        { name: "A", priority: "critical" },
        { name: "B", priority: "important" },
        { name: "C", priority: "optional" },
        { name: "D", priority: 10 },
        { name: "E", priority: 100 },
        { name: "F", priority: 200 },
      ];
      const result = groupSkillsByPriority(skills);
      expect(result.critical.map((skill) => skill.name)).toEqual(["A", "D"]);
    });

    it("should_group_important_skills_when_priorities_mixed", () => {
      const skills = [
        { name: "A", priority: "critical" },
        { name: "B", priority: "important" },
        { name: "C", priority: "optional" },
        { name: "D", priority: 10 },
        { name: "E", priority: 100 },
        { name: "F", priority: 200 },
      ];
      const result = groupSkillsByPriority(skills);
      expect(result.important.map((skill) => skill.name)).toEqual(["B", "E"]);
    });

    it("should_group_optional_skills_when_priorities_mixed", () => {
      const skills = [
        { name: "A", priority: "critical" },
        { name: "B", priority: "important" },
        { name: "C", priority: "optional" },
        { name: "D", priority: 10 },
        { name: "E", priority: 100 },
        { name: "F", priority: 200 },
      ];
      const result = groupSkillsByPriority(skills);
      expect(result.optional.map((skill) => skill.name)).toEqual(["C", "F"]);
    });

    it("should_default_to_important_when_priority_is_missing", () => {
      const result = groupSkillsByPriority([{ name: "NoPriority" }]);
      expect(result.important.length).toBe(1);
    });

    it("should_group_optional_when_activation_priority_is_optional", () => {
      const result = groupSkillsByPriority([
        { name: "ActOptional", activation: { priority: "optional" } },
      ]);
      expect(result.optional.length).toBe(1);
    });
  });

  describe("renderSkillsSection", () => {
    it("should_return_null_when_skills_is_undefined", () => {
      const result = renderSkillsSection(undefined);
      expect(result).toBe(null);
    });

    it("should_return_null_when_skills_is_null", () => {
      const result = renderSkillsSection(null);
      expect(result).toBe(null);
    });

    it("should_return_null_when_skills_is_empty_array", () => {
      const result = renderSkillsSection([]);
      expect(result).toBe(null);
    });

    it("should_include_section_header_when_skills_present", () => {
      const result = renderSkillsSection([{ name: "TestSkill", description: "A test skill" }]);
      expect(result.startsWith("## Skills")).toBe(true);
    });

    it("should_render_skill_entry_when_skill_has_name_and_description", () => {
      const result = renderSkillsSection([{ name: "TestSkill", description: "A test skill" }]);
      expect(result.includes("- TestSkill: A test skill")).toBe(true);
    });

    it("should_include_core_group_title_when_core_skills_exist", () => {
      const result = renderSkillsSection([
        { name: "Critical", description: "d", priority: "critical" },
      ]);
      expect(result.includes("### 🔴 Core Skills")).toBe(true);
    });

    it("should_include_standard_group_title_when_standard_skills_exist", () => {
      const result = renderSkillsSection([{ name: "Important", description: "d" }]);
      expect(result.includes("### 🟡 Standard Skills")).toBe(true);
    });

    it("should_include_optional_group_title_when_optional_skills_exist", () => {
      const result = renderSkillsSection([
        { name: "Optional", description: "d", priority: "optional" },
      ]);
      expect(result.includes("### ⚪ Optional Skills")).toBe(true);
    });

    it("should_hide_priority_group_titles_when_showPriority_is_false", () => {
      const result = renderSkillsSection([{ name: "Important", description: "d" }], {
        showPriority: false,
      });
      expect(result.includes("###")).toBe(false);
    });

    it("should_read_skill_metadata_from_skill_metadata_object", () => {
      const result = renderSkillsSection([
        { metadata: { name: "MetaSkill", description: "from meta", path: "test.md" } },
      ]);
      expect(result.includes("- MetaSkill: from meta")).toBe(true);
    });

    it("should_include_trigger_rules_in_output", () => {
      const result = renderSkillsSection([{ name: "S", description: "d" }]);
      expect(result.includes("Trigger rules:")).toBe(true);
    });

    it("should_include_file_fragment_when_relative_path_provided", () => {
      const result = renderSkillsSection([
        { name: "PathSkill", description: "d", path: "skills/my-skill.md" },
      ]);
      expect(result.includes("(file: skills/my-skill.md)")).toBe(true);
    });

    it("should_not_include_file_fragment_when_path_is_empty_string", () => {
      const result = renderSkillsSection([{ name: "S", description: "d", path: "" }]);
      expect(result.includes("(file:")).toBe(false);
    });

    it("should_not_include_file_fragment_when_path_is_whitespace_string", () => {
      const result = renderSkillsSection([{ name: "S", description: "d", path: "   " }]);
      expect(result.includes("(file:")).toBe(false);
    });

    it("should_not_include_file_fragment_when_path_is_null", () => {
      const result = renderSkillsSection([{ name: "S", description: "d", path: null }]);
      expect(result.includes("(file:")).toBe(false);
    });

    it("should_normalize_absolute_posix_path_to_basename_only", () => {
      const result = renderSkillsSection([
        { name: "S", description: "d", path: "/long/absolute/path/to/skill.md" },
      ]);
      expect(result.includes("(file: skill.md)")).toBe(true);
    });

    it("should_not_leak_absolute_posix_path_segments_in_output", () => {
      const result = renderSkillsSection([
        { name: "S", description: "d", path: "/long/absolute/path/to/skill.md" },
      ]);
      expect(result.includes("/long/absolute/path/to")).toBe(false);
    });

    it("should_normalize_absolute_windows_path_to_basename_only", () => {
      const result = renderSkillsSection([
        { name: "S", description: "d", path: "C:\\Users\\test\\skill.md" },
      ]);
      expect(result.includes("(file: skill.md)")).toBe(true);
    });

    it("should_preserve_user_prefix_in_path", () => {
      const result = renderSkillsSection([{ name: "S", description: "d", path: "user:my-skill" }]);
      expect(result.includes("(file: user:my-skill)")).toBe(true);
    });

    it("should_preserve_nexus_prefix_in_path", () => {
      const result = renderSkillsSection([
        { name: "S", description: "d", path: "nexus://remote/skill" },
      ]);
      expect(result.includes("(file: nexus://remote/skill)")).toBe(true);
    });

    it("should_preserve_remote_prefix_in_path", () => {
      const result = renderSkillsSection([
        { name: "S", description: "d", path: "remote:some-skill" },
      ]);
      expect(result.includes("(file: remote:some-skill)")).toBe(true);
    });

    it("should_extract_pathname_and_search_from_http_url", () => {
      const result = renderSkillsSection([
        { name: "S", description: "d", path: "https://example.com/skills/my-skill?v=1" },
      ]);
      expect(result.includes("(file: /skills/my-skill?v=1)")).toBe(true);
    });

    it("should_not_leak_http_origin_in_output", () => {
      const result = renderSkillsSection([
        { name: "S", description: "d", path: "https://example.com/skills/my-skill?v=1" },
      ]);
      expect(result.includes("https://example.com")).toBe(false);
    });

    it("should_fall_back_to_raw_value_when_http_url_is_invalid", () => {
      const result = renderSkillsSection([{ name: "S", description: "d", path: "http://[invalid" }]);
      expect(result.includes("(file: http://[invalid)")).toBe(true);
    });

    it("should_normalize_relative_paths_with_backslashes", () => {
      const result = renderSkillsSection([
        { name: "S", description: "d", path: "skills\\sub\\my-skill.md" },
      ]);
      expect(result.includes("(file: skills/sub/my-skill.md)")).toBe(true);
    });

    it("should_throw_when_skills_is_non_iterable_but_has_length", () => {
      const act = () => renderSkillsSection({ length: 1 });
      expect(act).toThrow();
    });

    it("should_throw_when_toNonEmptyString_throws", () => {
      toNonEmptyStringMock.mockImplementation(() => {
        throw new Error("boom");
      });
      const act = () => renderSkillsSection([{ name: "S", description: "d", path: "x" }]);
      expect(act).toThrow("boom");
    });
  });

  describe("renderSkillsList", () => {
    it("should_return_empty_string_when_skills_is_undefined", () => {
      const result = renderSkillsList(undefined);
      expect(result).toBe("");
    });

    it("should_return_empty_string_when_skills_is_null", () => {
      const result = renderSkillsList(null);
      expect(result).toBe("");
    });

    it("should_return_empty_string_when_skills_is_empty_array", () => {
      const result = renderSkillsList([]);
      expect(result).toBe("");
    });

    it("should_include_available_skills_header_when_skills_present", () => {
      const result = renderSkillsList([{ name: "Test", description: "desc" }]);
      expect(result.includes("Available skills:")).toBe(true);
    });

    it("should_prefix_skill_name_with_dollar_sign", () => {
      const result = renderSkillsList([{ name: "MySkill", description: "desc" }]);
      expect(result.includes("$MySkill")).toBe(true);
    });

    it("should_include_red_icon_when_skill_is_critical", () => {
      const result = renderSkillsList([{ name: "Critical", description: "desc", priority: "critical" }]);
      expect(result.includes("🔴 $Critical")).toBe(true);
    });

    it("should_include_white_icon_when_skill_is_optional", () => {
      const result = renderSkillsList([{ name: "Optional", description: "desc", priority: "optional" }]);
      expect(result.includes("⚪ $Optional")).toBe(true);
    });

    it("should_not_include_priority_icons_when_skill_is_important", () => {
      const result = renderSkillsList([{ name: "Important", description: "desc" }]);
      expect(result.includes("🔴") || result.includes("⚪")).toBe(false);
    });

    it("should_use_shortDescription_when_available", () => {
      const result = renderSkillsList([
        { name: "Test", description: "long description", shortDescription: "short desc" },
      ]);
      expect(result.includes("short desc")).toBe(true);
    });

    it("should_not_include_long_description_when_shortDescription_available", () => {
      const result = renderSkillsList([
        { name: "Test", description: "long description", shortDescription: "short desc" },
      ]);
      expect(result.includes("long description")).toBe(false);
    });

    it("should_order_skills_by_priority_critical_then_important_then_optional", () => {
      const result = renderSkillsList([
        { name: "Optional", description: "d", priority: "optional" },
        { name: "Important", description: "d" },
        { name: "Critical", description: "d", priority: "critical" },
      ]);
      const criticalIdx = result.indexOf("$Critical");
      const importantIdx = result.indexOf("$Important");
      const optionalIdx = result.indexOf("$Optional");
      expect(criticalIdx < importantIdx && importantIdx < optionalIdx).toBe(true);
    });

    it("should_read_skill_metadata_when_skill_metadata_provided", () => {
      const result = renderSkillsList([{ metadata: { name: "FromMeta", description: "meta desc" } }]);
      expect(result.includes("$FromMeta")).toBe(true);
    });

    it("should_throw_when_skills_is_non_iterable_but_has_length", () => {
      const act = () => renderSkillsList({ length: 1 });
      expect(act).toThrow();
    });
  });

  describe("renderUnifiedCatalog", () => {
    it("should_render_header_when_called_with_no_args", () => {
      const result = renderUnifiedCatalog();
      expect(result.startsWith("## 可用能力和技能")).toBe(true);
    });

    it("should_include_capabilities_section_when_capabilities_present", () => {
      const result = renderUnifiedCatalog({
        capabilities: [{ definition: { name: "Tool1", description: "desc1" } }],
      });
      expect(result.includes("(Capabilities)")).toBe(true);
    });

    it("should_render_capability_entry_when_capability_provided", () => {
      const result = renderUnifiedCatalog({
        capabilities: [{ definition: { name: "Tool1", description: "desc1" } }],
      });
      expect(result.includes("**Tool1**")).toBe(true);
    });

    it("should_include_skills_section_when_skills_present", () => {
      const result = renderUnifiedCatalog({ skills: [{ name: "Skill1", description: "desc1" }] });
      expect(result.includes("(Skills)")).toBe(true);
    });

    it("should_render_skill_entry_when_skill_provided", () => {
      const result = renderUnifiedCatalog({ skills: [{ name: "Skill1", description: "desc1" }] });
      expect(result.includes("**$Skill1**")).toBe(true);
    });

    it("should_include_red_white_and_yellow_icons_for_capabilities", () => {
      const result = renderUnifiedCatalog({
        capabilities: [
          { definition: { name: "Critical", description: "d", priority: "critical" } },
          { definition: { name: "Optional", description: "d", priority: "optional" } },
          { definition: { name: "Important", description: "d" } },
        ],
      });
      expect(result.includes("🔴") && result.includes("⚪") && result.includes("🟡")).toBe(true);
    });

    it("should_include_red_white_and_yellow_icons_for_skills", () => {
      const result = renderUnifiedCatalog({
        skills: [
          { name: "Critical", description: "d", priority: "critical" },
          { name: "Optional", description: "d", priority: "optional" },
          { name: "Important", description: "d" },
        ],
      });
      expect(result.includes("🔴") && result.includes("⚪") && result.includes("🟡")).toBe(true);
    });

    it("should_use_shortDescription_for_skills_when_available", () => {
      const result = renderUnifiedCatalog({
        skills: [{ name: "Test", description: "long desc", shortDescription: "short" }],
      });
      expect(result.includes("short")).toBe(true);
    });

    it("should_read_capability_from_definition_or_direct_object", () => {
      const result = renderUnifiedCatalog({
        capabilities: [
          { name: "Direct", description: "direct desc" },
          { definition: { name: "Wrapped", description: "wrapped desc" } },
        ],
      });
      expect(result.includes("**Direct**") && result.includes("**Wrapped**")).toBe(true);
    });

    it("should_order_capabilities_by_priority_critical_then_important_then_optional", () => {
      const result = renderUnifiedCatalog({
        capabilities: [
          { definition: { name: "Opt", description: "d", priority: "optional" } },
          { definition: { name: "Imp", description: "d" } },
          { definition: { name: "Crit", description: "d", priority: "critical" } },
        ],
      });
      const critIdx = result.indexOf("**Crit**");
      const impIdx = result.indexOf("**Imp**");
      const optIdx = result.indexOf("**Opt**");
      expect(critIdx < impIdx && impIdx < optIdx).toBe(true);
    });

    it("should_treat_activation_priority_zero_as_important_for_capabilities_due_to_falsy_or", () => {
      const result = renderUnifiedCatalog({
        capabilities: [{ definition: { name: "Act", description: "d", activation: { priority: 0 } } }],
      });
      expect(result.includes("🟡 **Act**")).toBe(true);
    });

    it("should_read_skill_metadata_from_skill_metadata_object", () => {
      const result = renderUnifiedCatalog({
        skills: [{ metadata: { name: "FromMeta", description: "meta desc", priority: "critical" } }],
      });
      expect(result.includes("**$FromMeta**")).toBe(true);
    });

    it("should_render_capabilities_and_skills_together_when_both_provided", () => {
      const result = renderUnifiedCatalog({
        capabilities: [{ definition: { name: "Cap", description: "cap desc" } }],
        skills: [{ name: "Skill", description: "skill desc" }],
      });
      expect(result.includes("(Capabilities)") && result.includes("(Skills)")).toBe(true);
    });

    it("should_throw_when_called_with_null_argument", () => {
      const act = () => renderUnifiedCatalog(null);
      expect(act).toThrow();
    });
  });

  describe("exports", () => {
    it("should_export_renderSkillsSection_as_named_export", () => {
      expect(typeof renderModule.renderSkillsSection).toBe("function");
    });

    it("should_export_renderSkillsList_as_named_export", () => {
      expect(typeof renderModule.renderSkillsList).toBe("function");
    });

    it("should_export_renderUnifiedCatalog_as_named_export", () => {
      expect(typeof renderModule.renderUnifiedCatalog).toBe("function");
    });

    it("should_export_default_object_with_renderSkillsSection", () => {
      expect(typeof render.renderSkillsSection).toBe("function");
    });

    it("should_export_default_object_with_renderSkillsList", () => {
      expect(typeof render.renderSkillsList).toBe("function");
    });

    it("should_export_default_object_with_renderUnifiedCatalog", () => {
      expect(typeof render.renderUnifiedCatalog).toBe("function");
    });

    it("should_export_default_object_with_groupSkillsByPriority", () => {
      expect(typeof render.groupSkillsByPriority).toBe("function");
    });

    it("should_export_default_object_with_getSkillPriority", () => {
      expect(typeof render.getSkillPriority).toBe("function");
    });
  });
});
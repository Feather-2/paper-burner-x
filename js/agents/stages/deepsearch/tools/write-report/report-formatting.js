/**
 * Formatting helpers for write-report.
 */

/**
 * @typedef {object} ReportConfig
 * @property {Object<string, number>=} sectionWordLimits
 *
 * @typedef {object} WriteReportState
 * @property {ReportConfig=} reportConfig
 */

/**
 * Count non-whitespace characters in content.
 * @param {string} content
 * @returns {number}
 */
export function countContentChars(content) {
  const text = typeof content === "string" ? content : "";
  return text.replace(/\s+/g, "").length;
}

/**
 * Render sections into Markdown.
 * @param {Array<{title?:string,content?:string}>} sections
 * @param {{emptyPlaceholder?:string}} [options]
 * @returns {string}
 */
export function renderSectionsMarkdown(sections, options = {}) {
  const list = Array.isArray(sections) ? sections : [];
  const emptyPlaceholder = typeof options.emptyPlaceholder === "string" ? options.emptyPlaceholder : "";
  const usePlaceholder = emptyPlaceholder.length > 0;

  return list
    .map((section) => {
      const title = section?.title || "";
      const rawContent = section?.content;
      const body = usePlaceholder ? (rawContent || emptyPlaceholder) : rawContent;
      return `## ${title}\n\n${body}`;
    })
    .join("\n\n");
}

/**
 * Build report outline details from sections.
 * @param {Array<{sectionId?:string,title?:string,content?:string}>} sections
 * @param {WriteReportState} state
 * @returns {{outline:Array<object>,totalSections:number,filledSections:number,emptySections:number}}
 */
export function buildReportOutline(sections, state) {
  const list = Array.isArray(sections) ? sections : [];
  const outline = list.map((section, index) => {
    const content = typeof section?.content === "string" ? section.content : "";
    const wordCount = countContentChars(content);

    return {
      index,
      sectionId: section?.sectionId,
      title: section?.title,
      wordCount,
      status: content ? "filled" : "empty",
      minWords: state?.reportConfig?.sectionWordLimits?.[section?.title] || null,
    };
  });

  return {
    outline,
    totalSections: outline.length,
    filledSections: outline.filter((s) => s.status === "filled").length,
    emptySections: outline.filter((s) => s.status === "empty").length,
  };
}

export default {
  countContentChars,
  renderSectionsMarkdown,
  buildReportOutline,
};

import { buildSlideHtml as buildSlideHtmlImpl } from "./dsl/dsl-builder.js";

/**
 * Build one slide HTML DSL.
 *
 * @param {object} slideIntent ContentPackage.slideIntents[i]
 * @param {object} designSystem DesignSystem (or raw tokens)
 * @param {object[]|object} arg3 claims[] or ContentPackage
 * @param {object[]|object} [arg4] evidences[] or options
 * @param {object} [arg5] options
 * @returns {string}
 */
export const buildSlideHtml = buildSlideHtmlImpl;

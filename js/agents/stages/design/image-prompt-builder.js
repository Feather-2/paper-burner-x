import { buildPrompt as buildPromptImpl } from "./image/image-prompt-builder.js";

/**
 * Build an image generation prompt for a given image slot.
 * @param {object} [imageSlot]
 * @param {object} [designSystem]
 * @param {object} [contentPackage]
 * @returns {string}
 */
export const buildPrompt = buildPromptImpl;

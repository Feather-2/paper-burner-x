import { generateDesignTokens as generateDesignTokensImpl, validateDesignSystem as validateDesignSystemImpl } from "./generators/design-tokens.js";

/**
 * Generate base design tokens (legacy DesignSystem shape).
 * @param {object} [constraints]
 * @returns {{theme:string,visualPreference?:object,designTokens:object}}
 */
export const generateDesignTokens = generateDesignTokensImpl;

/**
 * Validates the dynamic DesignSystem schema + DSL constraints.
 * @param {object} system
 * @returns {{ok:boolean, errors:string[]}}
 */
export const validateDesignSystem = validateDesignSystemImpl;

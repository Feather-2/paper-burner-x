import { generateDesignSystem as generateDesignSystemImpl } from "./generators/design-system-generator.js";

/**
 * Generate DesignSystem via AI with strict validation; fallback to template on failure.
 * @param {{contentSummary?:string,tone?:string,extractedPalette?:object,userPreferences?:object}} [input]
 * @param {{aiApiService?:object,modelRouter?:object,signal?:AbortSignal,constraints?:object}} [options]
 * @returns {Promise<object>} DesignSystem
 */
export const generateDesignSystem = generateDesignSystemImpl;

import { generateBatch as generateBatchImpl, generateSingleSlide as generateSingleSlideImpl } from "./generators/batch-generator.js";

/**
 * Generate slides in batches (max 4 per batch).
 *
 * Supported call forms:
 * - generateBatch(slideIntents, contentPackage, designSystem, options)
 * - generateBatch(slideIntents, contentPackage, options) where options.designSystem is provided
 *
 * @param {Array<object>} slideIntents
 * @param {object} contentPackage
 * @param {object} [designSystemOrOptions]
 * @param {object} [maybeOptions]
 * @returns {Promise<Array<{slideIntentId:string,slideHtml:string,source:"llm"|"fallback"}>>}
 */
export const generateBatch = generateBatchImpl;

/**
 * Generate a single slide HTML DSL.
 *
 * @param {object} slideIntent
 * @param {object} designSystem
 * @param {string} dslRules
 * @param {{aiApiService?:object,modelRouter?:object,modelCaller?:Function,emit?:Function,signal?:AbortSignal,contentPackage?:object,slideNo?:number,slideIndex?:number,imageSlotsForSlide?:Array<object>,selectedIdeas?:Array<object>,slotHintsBySlotId?:Map<string, any>,dslExamples?:any[]}=} [options]
 * @returns {Promise<{slideIntentId:string,slideHtml:string,source:"llm"|"fallback"}>}
 */
export const generateSingleSlide = generateSingleSlideImpl;

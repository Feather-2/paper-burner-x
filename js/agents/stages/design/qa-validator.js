import { validateSlide as validateSlideImpl } from "./refiner/qa-validator.js";

/**
 * QA validator for a single slide HTML DSL.
 * Checks: min font size, simple overflow (x/y/w/h percent bounds), basic contrast ratio for text.
 *
 * @param {string} slideHtml
 * @returns {{valid:boolean, violations:Array<{type:string,message:string,severity:"warn"|"error",elementId?:string}>, pass:boolean, issues:Array<{code:string,message:string,severity:"warn"|"error",elementId?:string}>}}
 */
export const validateSlide = validateSlideImpl;

/**
 * Lightweight schema validator for fail-fast validation
 *
 * Browser-compatible, zero dependencies.
 * Returns structured validation results instead of throwing.
 */

import { isPlainObject, toNonEmptyString } from "./value-utils.js";

/**
 * Validation result
 * @typedef {Object} ValidationResult
 * @property {boolean} ok - Whether validation passed
 * @property {string[]} errors - List of error messages
 * @property {any} value - Validated/coerced value (if ok)
 */

/**
 * Create a validation result
 * @param {boolean} ok
 * @param {any} value
 * @param {string[]} errors
 * @returns {ValidationResult}
 */
function result(ok, value, errors = []) {
  return { ok, value, errors };
}

/**
 * Validate a chunk object has required fields
 * @param {any} chunk
 * @param {number} [index] - Optional index for error messages
 * @returns {ValidationResult}
 */
export function validateChunk(chunk, index) {
  const prefix = typeof index === "number" ? `chunk[${index}]` : "chunk";
  const errors = [];

  if (!isPlainObject(chunk)) {
    return result(false, null, [`${prefix}: expected object, got ${typeof chunk}`]);
  }

  const chunkId = toNonEmptyString(chunk.chunkId);
  if (!chunkId) {
    errors.push(`${prefix}.chunkId: required non-empty string`);
  }

  const text = chunk.text;
  if (typeof text !== "string") {
    errors.push(`${prefix}.text: required string, got ${typeof text}`);
  }

  if (errors.length > 0) {
    return result(false, null, errors);
  }

  return result(true, { ...chunk, chunkId, text });
}

/**
 * Validate an array of chunks
 * @param {any} chunks
 * @param {Object} [options]
 * @param {number} [options.maxErrors=10] - Maximum errors to collect
 * @param {boolean} [options.allowEmpty=false] - Allow empty array
 * @returns {ValidationResult}
 */
export function validateChunks(chunks, { maxErrors = 10, allowEmpty = false } = {}) {
  if (!Array.isArray(chunks)) {
    return result(false, null, [`chunks: expected array, got ${typeof chunks}`]);
  }

  if (chunks.length === 0 && !allowEmpty) {
    return result(false, [], ["chunks: array is empty"]);
  }

  const errors = [];
  const validated = [];
  let invalidCount = 0;

  for (let i = 0; i < chunks.length; i++) {
    const r = validateChunk(chunks[i], i);
    if (r.ok) {
      validated.push(r.value);
    } else {
      invalidCount++;
      if (errors.length < maxErrors) {
        errors.push(...r.errors);
      }
    }
  }

  if (invalidCount > 0 && errors.length >= maxErrors) {
    errors.push(`... and ${invalidCount - maxErrors} more invalid chunks`);
  }

  if (invalidCount > 0) {
    return result(false, validated, errors);
  }

  return result(true, validated, []);
}

/**
 * Validate glob result structure
 * @param {any} globResult
 * @returns {ValidationResult}
 */
export function validateGlobResult(globResult) {
  if (!isPlainObject(globResult)) {
    return result(false, null, ["globResult: expected object"]);
  }

  const errors = [];

  if (!Array.isArray(globResult.files)) {
    errors.push("globResult.files: expected array");
  }

  if (typeof globResult.fromCache !== "boolean") {
    // Optional, default to false
  }

  if (globResult.error !== undefined && typeof globResult.error !== "string") {
    errors.push("globResult.error: expected string or undefined");
  }

  if (errors.length > 0) {
    return result(false, null, errors);
  }

  return result(true, {
    files: globResult.files.filter(f => typeof f === "string"),
    fromCache: Boolean(globResult.fromCache),
    error: globResult.error,
  }, []);
}

/**
 * Validate grep match structure
 * @param {any} match
 * @param {number} [index]
 * @returns {ValidationResult}
 */
export function validateGrepMatch(match, index) {
  const prefix = typeof index === "number" ? `match[${index}]` : "match";
  const errors = [];

  if (!isPlainObject(match)) {
    return result(false, null, [`${prefix}: expected object`]);
  }

  const chunkId = toNonEmptyString(match.chunkId);
  if (!chunkId) {
    errors.push(`${prefix}.chunkId: required non-empty string`);
  }

  if (typeof match.matchCount !== "number" || !Number.isFinite(match.matchCount)) {
    // Tolerate missing matchCount, default to 1
  }

  if (errors.length > 0) {
    return result(false, null, errors);
  }

  return result(true, {
    chunkId,
    matchCount: typeof match.matchCount === "number" ? match.matchCount : 1,
    spans: Array.isArray(match.spans) ? match.spans : [],
  }, []);
}

/**
 * Validate grep results array
 * @param {any} results
 * @returns {ValidationResult}
 */
export function validateGrepResults(results) {
  if (!isPlainObject(results)) {
    return result(false, null, ["grepResults: expected object"]);
  }

  const errors = [];

  if (!Array.isArray(results.matches)) {
    errors.push("grepResults.matches: expected array");
  }

  if (results.error !== undefined && typeof results.error !== "string") {
    errors.push("grepResults.error: expected string or undefined");
  }

  if (errors.length > 0) {
    return result(false, null, errors);
  }

  // Validate individual matches (with tolerance)
  const validMatches = [];
  for (let i = 0; i < results.matches.length; i++) {
    const r = validateGrepMatch(results.matches[i], i);
    if (r.ok) {
      validMatches.push(r.value);
    }
    // Silently skip invalid matches to avoid blocking entire search
  }

  return result(true, {
    matches: validMatches,
    error: results.error,
  }, []);
}

/**
 * Validate search query structure
 * @param {any} query
 * @returns {ValidationResult}
 */
export function validateSearchQuery(query) {
  if (!isPlainObject(query)) {
    return result(false, null, ["query: expected object"]);
  }

  const errors = [];

  // Strategy validation
  const validStrategies = ["auto", "glob-then-grep", "grep-only"];
  if (query.strategy !== undefined) {
    const s = toNonEmptyString(query.strategy)?.toLowerCase();
    if (s && !validStrategies.includes(s)) {
      errors.push(`query.strategy: expected one of ${validStrategies.join(", ")}, got "${s}"`);
    }
  }

  // Patterns validation
  if (query.patterns !== undefined && !Array.isArray(query.patterns)) {
    errors.push("query.patterns: expected array");
  }

  // Keywords validation
  if (query.keywords !== undefined && !Array.isArray(query.keywords)) {
    errors.push("query.keywords: expected array");
  }

  if (errors.length > 0) {
    return result(false, null, errors);
  }

  return result(true, {
    strategy: toNonEmptyString(query.strategy)?.toLowerCase(),
    patterns: Array.isArray(query.patterns) ? query.patterns : [],
    keywords: Array.isArray(query.keywords) ? query.keywords : [],
  }, []);
}

/**
 * Error codes for structured error handling
 */
export const ValidationErrorCode = Object.freeze({
  INVALID_CHUNKS: "INVALID_CHUNKS",
  INVALID_QUERY: "INVALID_QUERY",
  INVALID_GLOB_RESULT: "INVALID_GLOB_RESULT",
  INVALID_GREP_RESULT: "INVALID_GREP_RESULT",
  NO_KEYWORDS: "NO_KEYWORDS",
  GLOB_FAILED: "GLOB_FAILED",
  GREP_FAILED: "GREP_FAILED",
  ABORTED: "ABORTED",
  TIMEOUT: "TIMEOUT",
});

/**
 * Create a structured error response
 * @param {string} code - Error code from ValidationErrorCode
 * @param {string} message - Human-readable message
 * @param {Object} [details] - Additional details
 * @returns {Object}
 */
export function createValidationError(code, message, details = {}) {
  return {
    ok: false,
    error: { code, message, ...details },
    results: [],
    stats: {},
  };
}

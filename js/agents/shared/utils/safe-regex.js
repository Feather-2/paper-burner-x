/**
 * Safe Regex Utility
 *
 * Provides best-effort protection against ReDoS (catastrophic backtracking) by:
 * - validating pattern complexity with simple heuristics before compilation
 * - keeping pattern length bounded
 */

const DEFAULT_MAX_PATTERN_LENGTH = 1000;
const DEFAULT_TIMEOUT_MS = 2000;

function hasNestedQuantifiers(src) {
  // Rough heuristic for patterns like (a+)+, (a*)+, (a{1,2})*
  return /\([^)]*[+*}][^)]*\)\s*(?:[+*]|\{\d+(?:,\d*)?\})/.test(src);
}

function hasRepeatedAlternation(src) {
  // Patterns like (a|ab)* or (foo|bar)+ are prone to catastrophic backtracking.
  return /\([^)]*\|[^)]*\)\s*(?:[+*]|\{\d+(?:,\d*)?\})/.test(src);
}

/**
 * Checks if a regex pattern looks potentially dangerous (heuristic).
 * @param {string} pattern
 * @returns {boolean}
 */
export function isPotentiallyDangerous(pattern) {
  if (!pattern || typeof pattern !== "string") return false;

  if (pattern.length > DEFAULT_MAX_PATTERN_LENGTH) return true;

  // Heuristic signals (not exhaustive):
  // - nested quantifiers: (a+)+
  // - alternation inside a repeated group: (a|ab)*
  // - many alternations: (a|b|c|...)
  // - nested repetition ranges: {m,n}{p,q}
  const dangerousPatterns = [
    /(\([^)]*\|[^)]*\)){3,}/, // Too many alternations in groups
    /\{[^}]*,[^}]*\}\s*\{/, // Nested ranges
  ];

  if (hasNestedQuantifiers(pattern)) return true;
  if (hasRepeatedAlternation(pattern)) return true;
  return dangerousPatterns.some((re) => re.test(pattern));
}

/**
 * Creates a RegExp object with safety checks.
 * @param {string} pattern
 * @param {string} flags
 * @returns {RegExp}
 */
export function createSafeRegex(pattern, flags = "gu") {
  if (isPotentiallyDangerous(pattern)) {
    throw new Error("RegExp pattern exceeds complexity limits (Potential ReDoS)");
  }

  try {
    return new RegExp(pattern, flags);
  } catch (err) {
    throw new Error(`Invalid RegExp: ${err.message}`);
  }
}

/**
 * Executes a regex match with a "timeout" parameter for API compatibility.
 * Note: JS regex execution is synchronous; we rely on pre-validation instead.
 */
export function safeMatch(text, regex, timeoutMs = DEFAULT_TIMEOUT_MS) {
  void timeoutMs;
  return String(text ?? "").match(regex);
}

/**
 * Converts a glob pattern to a RegExp.
 *
 * Supports:
 * - `*` → match any characters except path separators
 * - `**` → match any characters including path separators
 * - `?` → match single character
 *
 * @param {string} pattern - Glob pattern
 * @returns {RegExp}
 */
export function globToRegex(pattern) {
  const src = (pattern && typeof pattern === 'string') ? pattern : '*';
  const escaped = src
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '<<<GLOBSTAR>>>')
    .replace(/\*/g, '[^/\\\\]*')
    .replace(/<<<GLOBSTAR>>>/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(escaped);
}

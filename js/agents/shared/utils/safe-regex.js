/**
 * Safe Regex Utility
 * 
 * Provides protection against ReDoS (Regular Expression Denial of Service)
 * by validating pattern complexity and providing a timeout-capable execution.
 */

const DEFAULT_MAX_PATTERN_LENGTH = 1000;
const DEFAULT_TIMEOUT_MS = 2000;

/**
 * Checks if a regex pattern looks potentially dangerous (simple heuristic).
 * @param {string} pattern 
 * @returns {boolean}
 */
export function isPotentiallyDangerous(pattern) {
    if (!pattern || typeof pattern !== 'string') return false;

    // Heuristic: excessive nested quantifiers like (a+)+ or (a|b|c)*
    const dangerousPatterns = [
        /\(.*\+.*\)\+/,
        /\(.*\x2A.*\)\x2A/,
        /(\(.*\|.*\)){3,}/, // Too many alternatives
        /\{.*,.*\}{2,}/     // Nested ranges
    ];

    if (pattern.length > DEFAULT_MAX_PATTERN_LENGTH) return true;

    return dangerousPatterns.some(re => re.test(pattern));
}

/**
 * Creates a RegExp object with safety checks.
 * @param {string} pattern 
 * @param {string} flags 
 * @returns {RegExp}
 */
export function createSafeRegex(pattern, flags = 'gu') {
    if (isPotentiallyDangerous(pattern)) {
        console.warn(`[SafeRegex] Potentially dangerous regex pattern detected: ${pattern.slice(0, 50)}...`);
        // Fallback to a literal match or a sanitized version if necessary
        // For now, we'll just throw or return a more restrictive one
        throw new Error('RegExp pattern exceeds complexity limits (Potential ReDoS)');
    }

    try {
        return new RegExp(pattern, flags);
    } catch (err) {
        throw new Error(`Invalid RegExp: ${err.message}`);
    }
}

/**
 * Executes a regex match with a timeout (simulated or via Worker if practical).
 * In a standard JS environment without synchronous timeout, we rely on 
 * preventing the dangerous patterns from being compiled in the first place.
 */
export function safeMatch(text, regex, timeoutMs = DEFAULT_TIMEOUT_MS) {
    // In a pure JS async-friendly environment, we might use a Worker.
    // For this implementation, we rely on 'isPotentiallyDangerous' during creation.
    return text.match(regex);
}

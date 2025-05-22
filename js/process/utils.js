/**
 * 计算指数退避的重试延迟，并加入抖动以减少多个实例同时重试的概率。
 *
 * 主要逻辑:
 * 1. 根据重试次数计算基础的指数延迟 (baseDelay * 2^retryCount)。
 * 2. 生成一个抖动值，其范围是指数延迟的 ±10% (即 exponentialDelay * 0.2 * (Math.random() - 0.5))。
 * 3. 将抖动值加到指数延迟上。
 * 4. 确保总延迟不超过 `maxDelay`。
 * 5. 确保总延迟不小于 `baseDelay` (以防抖动导致延迟过小)。
 *
 * @param {number} retryCount - 当前重试次数 (从0开始计数)。
 * @param {number} baseDelay - 基础延迟时间 (毫秒)，默认为 500ms。
 * @param {number} maxDelay - 最大延迟时间 (毫秒)，默认为 30000ms。
 * @returns {number} 计算后并应用了抖动和上下限的延迟时间 (毫秒)。
 */
function getRetryDelay(retryCount, baseDelay = 500, maxDelay = 30000) {
    const exponentialDelay = baseDelay * Math.pow(2, retryCount);
    // 抖动: 在 ±10% 范围内随机浮动
    const jitter = exponentialDelay * 0.2 * (Math.random() - 0.5);
    const totalDelay = Math.min(exponentialDelay + jitter, maxDelay);
    return Math.max(totalDelay, baseDelay);
}

/**
 * 基于文本特性估算其 token 数量。
 * 此方法为启发式估算，并非精确计数，主要针对不同语言特性采用不同策略。
 *
 * 主要逻辑:
 * 1. 如果文本为空或未定义，直接返回 0。
 * 2. 计算文本中非 ASCII 字符 (粗略地判断为 CJK 字符等) 的比例。
 * 3. **CJK 语言处理**: 如果非 ASCII 字符的比例超过一个阈值 (例如 0.3)，则认为文本主要由 CJK 字符构成。
 *    此时，token 数大致估算为 `text.length * 1.1` (一个字符约等于 1.1 个 token)。
 * 4. **其他语言处理 (如英文、代码)**: 否则，认为文本主要由 ASCII 字符构成。
 *    此时，token 数大致估算为 `text.length / 3.5` (约 3-4 个字符为一个 token)。
 * 5. 对估算结果向上取整。
 *
 * @param {string} text - 需要估算 token 数的输入文本。
 * @returns {number} 估算出的 token 数量。
 */
function estimateTokenCount(text) {
    if (!text) return 0;
    // 针对CJK等非ASCII字符的优化估算
    const nonAsciiRatio = (text.match(/[^ - ]/g) || []).length / text.length;
    if (nonAsciiRatio > 0.3) { // 中日韩等语言的启发式判断
        return Math.ceil(text.length * 1.1);
    } else {
        // 英文和代码大约3-4个字符一个token
        return Math.ceil(text.length / 3.5);
    }
}

/**
 * 转义字符串中的正则表达式特殊字符。
 * 当需要将一个普通字符串用作正则表达式的一部分进行精确匹配时，
 * 该字符串中可能包含的正则表达式特殊字符 (如 `.`、`*`、`+`、`?` 等) 需要被转义，
 * 以确保它们被解释为字面量字符而不是元字符。
 *
 * 主要逻辑:
 * - 使用 `String.prototype.replace()` 方法。
 * - 正则表达式 `/[.*+?^${}()|[\\]\\]/g` 匹配所有常见的正则表达式特殊字符。
 * - 替换函数 `$&` 表示匹配到的整个子字符串，在其前面加上反斜杠 `\\` 进行转义。
 *
 * @param {string} string - 需要转义的原始字符串。
 * @returns {string} 特殊字符已被转义的字符串，可以直接安全地用于构建新的正则表达式。
 */
function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 将工具函数添加到processModule对象
if (typeof processModule !== 'undefined') {
    processModule.getRetryDelay = getRetryDelay;
    processModule.estimateTokenCount = estimateTokenCount;
    processModule.escapeRegex = escapeRegex;
}
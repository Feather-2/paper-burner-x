/**
 * 计算指数退避+抖动的重试延迟
 * @param {number} retryCount - 当前重试次数
 * @param {number} baseDelay - 基础延迟(ms)，默认500ms
 * @param {number} maxDelay - 最大延迟(ms)，默认30000ms
 * @returns {number} 计算后的延迟时间(ms)
 */
function getRetryDelay(retryCount, baseDelay = 500, maxDelay = 30000) {
    const exponentialDelay = baseDelay * Math.pow(2, retryCount);
    // 抖动: 在 ±10% 范围内随机浮动
    const jitter = exponentialDelay * 0.2 * (Math.random() - 0.5);
    const totalDelay = Math.min(exponentialDelay + jitter, maxDelay);
    return Math.max(totalDelay, baseDelay);
}

/**
 * 估算文本的token数量
 * @param {string} text - 待估算的文本
 * @returns {number} 估算的token数量
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
 * 转义正则表达式中的特殊字符
 * @param {string} string - 需要转义的字符串
 * @returns {string} 转义后的字符串
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
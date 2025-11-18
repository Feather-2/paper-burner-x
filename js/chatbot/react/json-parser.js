// json-parser.js
// 增强的 JSON 解析器，提高容错性

(function(window) {
  'use strict';

  /**
   * 从 LLM 响应中提取并解析 JSON
   * 支持多种格式的响应，提高容错性
   */
  class ReActJsonParser {
    /**
     * 解析 LLM 响应，提取决策信息
     * @param {string} response - LLM 的原始响应
     * @returns {Object} 解析后的决策对象
     */
    static parse(response) {
      console.log('[JsonParser] 开始解析响应，长度:', response.length);

      // 策略 1: 尝试直接提取 JSON 块（支持 markdown 代码块）
      let parsed = this._extractFromCodeBlock(response);
      if (parsed) return parsed;

      // 策略 2: 尝试提取裸 JSON（最常见）
      parsed = this._extractRawJson(response);
      if (parsed) return parsed;

      // 策略 3: 尝试修复常见 JSON 错误后解析
      parsed = this._extractWithFixing(response);
      if (parsed) return parsed;

      // 策略 4: 如果完全无法解析，判断是否是纯文本回答
      console.warn('[JsonParser] 无法提取 JSON，尝试作为纯文本回答处理');
      return {
        action: 'answer',
        thought: '无法解析为工具调用，作为直接回答',
        answer: response.trim()
      };
    }

    /**
     * 从 markdown 代码块中提取 JSON
     */
    static _extractFromCodeBlock(response) {
      const codeBlockMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (codeBlockMatch) {
        try {
          const json = codeBlockMatch[1].trim();
          const parsed = JSON.parse(json);
          console.log('[JsonParser] 成功从代码块提取 JSON');
          return this._normalizeDecision(parsed);
        } catch (e) {
          console.warn('[JsonParser] 代码块中的 JSON 格式错误:', e.message);
        }
      }
      return null;
    }

    /**
     * 提取裸 JSON（最宽松的匹配）
     */
    static _extractRawJson(response) {
      // 匹配从第一个 { 到最后一个 }
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          console.log('[JsonParser] 成功提取裸 JSON');
          return this._normalizeDecision(parsed);
        } catch (e) {
          console.warn('[JsonParser] 裸 JSON 格式错误:', e.message);
        }
      }
      return null;
    }

    /**
     * 尝试修复常见 JSON 错误后解析
     */
    static _extractWithFixing(response) {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      let jsonStr = jsonMatch[0];

      // 修复 1: 移除尾随逗号
      jsonStr = jsonStr.replace(/,\s*([}\]])/g, '$1');

      // 修复 2: 修复单引号为双引号
      jsonStr = jsonStr.replace(/'/g, '"');

      // 修复 3: 移除注释
      jsonStr = jsonStr.replace(/\/\/.*$/gm, '');
      jsonStr = jsonStr.replace(/\/\*[\s\S]*?\*\//g, '');

      try {
        const parsed = JSON.parse(jsonStr);
        console.log('[JsonParser] 成功通过修复提取 JSON');
        return this._normalizeDecision(parsed);
      } catch (e) {
        console.warn('[JsonParser] 修复后的 JSON 仍然错误:', e.message);
      }

      return null;
    }

    /**
     * 规范化决策对象，确保字段完整
     */
    static _normalizeDecision(parsed) {
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('解析结果不是对象');
      }

      // 验证必须字段
      if (!parsed.action) {
        throw new Error('缺少 action 字段');
      }

      if (parsed.action === 'answer') {
        return {
          action: 'answer',
          thought: parsed.thought || '',
          answer: parsed.answer || ''
        };
      }

      if (parsed.action === 'use_tool') {
        // 支持两种格式：单工具和并行工具
        if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
          // 并行工具调用
          return {
            action: 'use_tool',
            thought: parsed.thought || '',
            parallel: true,
            tool_calls: parsed.tool_calls.map(call => ({
              tool: call.tool,
              params: call.params || {}
            }))
          };
        } else if (parsed.tool) {
          // 单工具调用
          return {
            action: 'use_tool',
            thought: parsed.thought || '',
            parallel: false,
            tool: parsed.tool,
            params: parsed.params || {}
          };
        } else {
          throw new Error('use_tool 需要指定 tool 或 tool_calls');
        }
      }

      throw new Error('未知的 action 类型: ' + parsed.action);
    }
  }

  // 导出到全局
  window.ReActJsonParser = ReActJsonParser;

  console.log('[ReActJsonParser] 模块已加载');

})(window);

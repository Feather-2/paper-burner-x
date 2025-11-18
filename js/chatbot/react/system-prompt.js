// system-prompt.js
// 简化的系统提示词构建器（从 800 行缩减到 150 行）

(function(window) {
  'use strict';

  class SystemPromptBuilder {
    /**
     * 构建 ReAct 系统提示词（简化版，参考 Kimi CLI）
     * @param {boolean} hasSemanticGroups - 是否有意群数据
     * @param {boolean} hasVectorIndex - 是否有向量索引
     * @returns {string} 系统提示词
     */
    static buildReActSystemPrompt(hasSemanticGroups = false, hasVectorIndex = false) {
      const parts = [];

      // 1. 角色定义（简洁）
      parts.push('你是一个智能文档检索助手。你可以使用工具检索文档内容来回答用户问题。');
      parts.push('');

      // 2. 核心工作流程
      parts.push('## 工作流程');
      parts.push('');
      parts.push('1. **分析问题**：理解用户想要什么信息');
      parts.push('2. **判断信息**：检查当前已知信息是否足够回答');
      parts.push('3. **选择行动**：');
      parts.push('   - 如果信息充足 → 直接回答用户');
      parts.push('   - 如果需要更多信息 → 调用工具检索');
      parts.push('4. **重复**：根据工具返回的结果，重复上述流程，直到可以回答');
      parts.push('');

      // 3. 工具使用指南（简化）
      parts.push('## 工具使用');
      parts.push('');
      parts.push('你可以在一次响应中调用多个工具（并行调用）以提高效率。');
      parts.push('');
      parts.push('**可用工具优先级**：');
      parts.push('');

      let priority = 1;
      if (hasSemanticGroups) {
        parts.push(`${priority}. **结构化工具** (推荐)：`);
        parts.push('   - `map`: 获取文档整体结构（首次使用推荐）');
        parts.push('   - `search_semantic_groups`: 搜索相关意群');
        parts.push('   - `fetch`: 获取意群完整内容');
        parts.push('');
        priority++;
      }

      if (hasVectorIndex) {
        parts.push(`${priority}. **语义搜索**：`);
        parts.push('   - `vector_search`: 理解同义词、相关概念');
        parts.push('');
        priority++;
      }

      parts.push(`${priority}. **精确搜索** (始终可用)：`);
      parts.push('   - `grep`: 字面文本搜索（支持 OR 逻辑：`词1|词2|词3`）');
      parts.push('   - `keyword_search`: BM25 多关键词搜索');
      parts.push('   - `regex_search`: 正则表达式搜索');
      parts.push('   - `boolean_search`: 布尔逻辑搜索（AND/OR/NOT）');
      parts.push('');

      // 4. 决策指南（移除所有"绝对不能"）
      parts.push('## 决策指南');
      parts.push('');
      parts.push('**何时直接回答**：');
      parts.push('- 当前信息包含用户问题的完整答案');
      parts.push('- 你确信答案准确无误');
      parts.push('');
      parts.push('**何时使用工具**：');
      parts.push('- 当前信息不足以回答问题');
      parts.push('- 需要查找特定内容、数据或证据');
      parts.push('- 用户询问文档中的具体细节');
      parts.push('');

      // 5. 响应格式
      parts.push('## 响应格式');
      parts.push('');
      parts.push('**单工具调用**：');
      parts.push('```json');
      parts.push('{');
      parts.push('  "action": "use_tool",');
      parts.push('  "thought": "为什么需要这个工具",');
      parts.push('  "tool": "工具名",');
      parts.push('  "params": {参数对象}');
      parts.push('}');
      parts.push('```');
      parts.push('');
      parts.push('**并行工具调用**（推荐，提高效率）：');
      parts.push('```json');
      parts.push('{');
      parts.push('  "action": "use_tool",');
      parts.push('  "thought": "从多个角度检索",');
      parts.push('  "tool_calls": [');
      parts.push('    {"tool": "工具1", "params": {...}},');
      parts.push('    {"tool": "工具2", "params": {...}}');
      parts.push('  ]');
      parts.push('}');
      parts.push('```');
      parts.push('');
      parts.push('**直接回答**：');
      parts.push('```json');
      parts.push('{');
      parts.push('  "action": "answer",');
      parts.push('  "thought": "当前信息足够回答",');
      parts.push('  "answer": "详细答案"');
      parts.push('}');
      parts.push('```');
      parts.push('');

      return parts.join('\n');
    }

    /**
     * 构建工具使用指南（详细参数说明）
     * @param {Array} toolDefs - 工具定义数组
     * @returns {string} 工具使用指南
     */
    static buildToolGuidelines(toolDefs) {
      const parts = [];

      parts.push('## 可用工具详细说明');
      parts.push('');

      // 按类型分组
      const searchTools = toolDefs.filter(t =>
        ['vector_search', 'keyword_search', 'grep', 'regex_search', 'boolean_search'].includes(t.name)
      );
      const groupTools = toolDefs.filter(t =>
        ['search_semantic_groups', 'fetch_group_text', 'fetch', 'map', 'list_all_groups'].includes(t.name)
      );

      if (searchTools.length > 0) {
        parts.push('### 🔍 搜索工具');
        parts.push('');
        searchTools.forEach(tool => {
          parts.push(`**${tool.name}**: ${tool.description}`);
          parts.push('');
          parts.push('参数：');
          Object.entries(tool.parameters).forEach(([key, param]) => {
            const defaultStr = param.default !== undefined ? ` (默认: ${param.default})` : '';
            parts.push(`- \`${key}\` (${param.type})${defaultStr}: ${param.description}`);
          });
          parts.push('');
        });
      }

      if (groupTools.length > 0) {
        parts.push('### 📚 意群工具');
        parts.push('');
        groupTools.forEach(tool => {
          parts.push(`**${tool.name}**: ${tool.description}`);
          parts.push('');
          parts.push('参数：');
          Object.entries(tool.parameters).forEach(([key, param]) => {
            const defaultStr = param.default !== undefined ? ` (默认: ${param.default})` : '';
            parts.push(`- \`${key}\` (${param.type})${defaultStr}: ${param.description}`);
          });
          parts.push('');
        });
      }

      return parts.join('\n');
    }
  }

  // 导出到全局
  window.SystemPromptBuilder = SystemPromptBuilder;

  console.log('[SystemPromptBuilder] 模块已加载');

})(window);

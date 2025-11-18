// index.js
// ReAct 模块主入口文件

/**
 * ReAct (Reasoning + Acting) 模块
 *
 * 架构说明：
 * - json-parser.js: 增强的 JSON 解析器，提高容错性
 * - system-prompt.js: 简化的系统提示词构建器（从 800 行减到 150 行）
 * - context-builder.js: 上下文构建器（改进初始上下文策略）
 * - tool-registry.js: 工具注册表（10个检索工具）
 * - token-budget.js: Token 预算管理器
 * - engine.js: 简化的核心引擎（移除强制模式匹配）
 *
 * 使用方法：
 * ```javascript
 * const engine = new window.ReActEngine({
 *   maxIterations: 5,
 *   tokenBudget: {
 *     totalBudget: 32000,
 *     contextTokens: 18000
 *   },
 *   llmConfig: {...}
 * });
 *
 * const generator = engine.run(userQuestion, docContent, systemPrompt, chatHistory);
 * for await (const event of generator) {
 *   console.log(event);
 * }
 * ```
 *
 * 改进要点（相比原版）：
 * 1. ✅ JSON 解析更可靠（多策略解析 + 修复常见错误）
 * 2. ✅ 提示词简化 70%（从 800 行减到 150 行）
 * 3. ✅ 移除强制模式匹配（checkForcedAction）
 * 4. ✅ 改进初始上下文（包含文档概览而非完全空白）
 * 5. ✅ 模块化架构（易于维护和扩展）
 *
 * 版本：v2.0.0
 * 更新日期：2025-01-18
 */

(function(window) {
  'use strict';

  // 检查依赖项
  const requiredModules = [
    'ReActJsonParser',
    'SystemPromptBuilder',
    'ContextBuilder',
    'ToolRegistry',
    'TokenBudgetManager',
    'ReActEngine'
  ];

  const missingModules = requiredModules.filter(module => !window[module]);

  if (missingModules.length > 0) {
    console.error('[ReAct Module] 缺少必需的模块:', missingModules.join(', '));
    console.error('[ReAct Module] 请确保按顺序加载所有模块文件');
  } else {
    console.log('[ReAct Module] ✓ 所有模块已成功加载');
    console.log('[ReAct Module] 可用组件:', requiredModules.join(', '));
  }

  // 导出版本信息
  window.ReActModule = {
    version: '2.0.0',
    components: {
      JsonParser: window.ReActJsonParser,
      SystemPromptBuilder: window.SystemPromptBuilder,
      ContextBuilder: window.ContextBuilder,
      ToolRegistry: window.ToolRegistry,
      TokenBudgetManager: window.TokenBudgetManager,
      Engine: window.ReActEngine
    },
    changelog: {
      'v2.0.0': [
        '模块化重构',
        'JSON 解析增强（多策略 + 容错）',
        '提示词简化 70%',
        '移除强制模式匹配',
        '改进初始上下文策略'
      ],
      'v1.2.0': ['并行工具调用', '详细工具描述'],
      'v1.1.0': ['工具扩展到 10 个'],
      'v1.0.0': ['首次发布']
    }
  };

  console.log(`[ReAct Module] v${window.ReActModule.version} 已就绪`);

})(window);

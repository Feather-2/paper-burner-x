// chatbot-preset.js


/**
 * @const {Array<string>} PRESET_QUESTIONS
 * 预设问题列表，用于在聊天机器人界面快速提问。
 * 这些问题通常是针对当前文档内容的常见查询。
 */

const PRESET_QUESTIONS = [
  '总结本文', '有哪些关键公式？', '研究背景与意义？', '研究方法及发现？',
  '应用与前景？', '用通俗语言解释全文', '生成思维导图🧠', '生成流程图🔄',
  '生成更多配图🎨'
];

/**
 * @const {string} MERMAID_FLOWCHART_PROMPT
 * Mermaid 流程图生成的提示词模板
 */
const MERMAID_FLOWCHART_PROMPT = `
请用Mermaid语法输出流程图，节点用[]包裹，箭头用-->连接。
- 每一条流程图语句必须单独一行，不能多条语句写在一行。
- 节点内容必须全部在一行内，不能有任何换行、不能有 <br>、不能有 \\n。
- **节点标签内禁止使用特殊符号**：不能包含 [ ] ( ) | { } < > 等符号，如需表示请用中文或文字描述。
  * ❌ 错误：D[PET成像 [11C]K-2] （包含方括号）
  * ✓ 正确：D[PET成像 11C-K-2] 或 D[PET成像使用11C标记的K-2]
- 不允许在节点内容中出现任何 HTML 标签，只能用纯文本。
- **每个节点都必须有连线，不能有孤立节点。**
- **节点定义后不要重复节点ID**：A[文本] --> B 而不是 A[文本]A --> B
- 如果文档内容有分支、并行、循环等，请在流程图中体现出来，不要只画一条直线。
- 如需使用subgraph，必须严格遵守Mermaid语法，subgraph必须单独一行，内容缩进，最后用end结束。
- 只输出代码块，不要解释，不要输出除代码块以外的任何内容。
- 例如：
\`\`\`mermaid
graph TD
A[开始] --> B{条件判断}
B -- 是 --> C[处理1]
B -- 否 --> D[处理2]
subgraph 参与者流程
  C --> E[结束]
  D --> E
end
\`\`\`
`;

/**
 * @const {string} MINDMAP_PROMPT
 * 思维导图生成的提示词模板
 */
const MINDMAP_PROMPT = `
请注意：用户请求生成思维导图。请按照以下Markdown格式返回思维导图结构：
# 文档主题（根节点）
## 一级主题1
### 二级主题1.1
### 二级主题1.2
## 一级主题2
### 二级主题2.1
#### 三级主题2.1.1

只需提供思维导图的结构，不要添加额外的解释。结构应该清晰反映文档的层次关系和主要内容。
`;

/**
 * @function getDrawioPicturesPrompt
 * draw.io 配图生成的提示词模板（配合 [加入配图] 前缀使用）。
 * 使用 DrawioLite DSL 代替 XML，减少格式错误
 * 动态获取以确保 DrawioLite 模块已加载
 */
function getDrawioPicturesPrompt() {
  const drawioLitePrompt = window.DrawioLitePrompt?.DRAWIO_LITE_SYSTEM_PROMPT;

  if (!drawioLitePrompt) {
    console.error('[ChatbotPreset] ❌ DrawioLitePrompt 未加载！请检查脚本加载顺序');
    return `你现在处于「配图生成模式」，请生成 DrawioLite DSL 代码。DrawioLite 极简语法示例：
node A "标签" rect blue
node B "标签2" ellipse green
A -> B "连接"
只输出 DSL 代码，不要解释。`;
  }

  return `你现在处于「配图生成模式」，本轮对话中不要充当通用问答助手，只充当 DrawioLite 图表生成器。

请根据当前文章内容和用户要求，为读者补充所需的配图。
用户会在问题中自行说明需要哪类配图（例如：整体结构、方法流程、实验设置、变量关系、对比分析等），请充分理解后再设计图形。

${drawioLitePrompt}`;
}

// 向后兼容：lazy getter
Object.defineProperty(window.ChatbotPreset || {}, 'DRAWIO_PICTURES_PROMPT', {
  get: getDrawioPicturesPrompt,
  enumerable: true
});

// 立即求值版本（用于不支持动态获取的旧代码）
const DRAWIO_PICTURES_PROMPT = getDrawioPicturesPrompt();

/**
 * @const {string} BASE_SYSTEM_PROMPT
 * 基础系统提示词模板
 */
const BASE_SYSTEM_PROMPT = `你现在是 PDF 文档智能助手，用户正在查看文档"{docName}"。
你的回答应该：
1. 基于PDF文档内容
2. 简洁清晰
3. 学术准确`;

/**
 * 处理预设问题的点击事件。
 * 当用户点击一个预设问题时，此函数会将问题文本填充到聊天输入框，
 * 并尝试调用全局的 `window.handleChatbotSend` 函数来发送消息。
 *
 * 注意：Mermaid 流程图的 prompt 不在这里注入，而是在 buildSystemPrompt 中注入到系统提示词
 *
 * @param {string} q被点击的预设问题文本。
 */
function handlePresetQuestion(q) {
  const input = document.getElementById('chatbot-input');
  if (!input) return;
  input.value = q;  // 直接设置问题文本，不拼接 prompt
  if (typeof window.handleChatbotSend === 'function') {
    window.handleChatbotSend();
  }
}

/**
 * 增强用户输入的提示词
 * 注意：Mermaid 流程图的 prompt 已改为在系统提示词中注入（prompt-constructor.js），
 * 此函数不再处理流程图 prompt
 *
 * @param {string|Array} userInput - 用户输入，可能是字符串或多模态消息数组
 * @returns {string|Array} - 增强后的用户输入（目前保持不变）
 */
function enhanceUserPrompt(userInput) {
  // 目前不在用户输入中添加任何 prompt
  // 所有 prompt 都应在系统提示词中注入
  return userInput;
}

/**
 * 检查用户输入是否为配图请求（基于前缀 [加入配图]）。
 *
 * @param {string} input - 用户输入文本
 * @returns {boolean} - 是否为配图请求
 */
function isDrawioPicturesRequest(input) {
  if (!input) return false;
  return input.trim().startsWith('[加入配图]');
}

/**
 * 检查用户输入是否包含思维导图请求关键词
 *
 * @param {string} input - 用户输入文本
 * @returns {boolean} - 是否包含思维导图关键词
 */
function isMindMapRequest(input) {
  if (!input) return false;
  return input.includes('思维导图') || input.includes('脑图');
}

window.ChatbotPreset = {
  PRESET_QUESTIONS,
  MERMAID_FLOWCHART_PROMPT,
  MINDMAP_PROMPT,
  DRAWIO_PICTURES_PROMPT,
  BASE_SYSTEM_PROMPT,
  handlePresetQuestion,
  enhanceUserPrompt,
  isMindMapRequest,
  isDrawioPicturesRequest
};
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
 * @const {string} DRAWIO_PICTURES_PROMPT
 * draw.io 配图生成的提示词模板（配合 [加入配图] 前缀使用）。
 */
const DRAWIO_PICTURES_PROMPT = `
你现在处于「配图生成模式」，本轮对话中不要充当通用问答助手，只充当 diagrams.net / draw.io 图形生成器。

请根据当前文章内容和用户要求，为读者补充所需的配图。
用户会在问题中自行说明需要哪类配图（例如：整体结构、方法流程、实验设置、变量关系、对比分析等），请充分理解后再设计图形。

输出格式和约束（必须全部遵守）：
1. 整个回答只能包含一段 XML 内容，不能包含任何自然语言说明、Markdown 或 HTML。
2. 请用自定义标记包裹完整的 XML：
   - 第一行写：[xml_content]
   - 最后一行写：[/xml_content]
   - 中间仅包含 diagrams.net / draw.io 兼容的 XML 内容，不要加入其他文字。
3. XML 必须是一个完整合法的 <mxfile> 结构。请严格参考下面的模板生成你自己的图，只需替换节点的文本、坐标或增删节点/连线，保持整体结构不变：

[xml_content]
<mxfile>
  <diagram name="示意图">
    <mxGraphModel dx="1600" dy="900" grid="1" gridSize="10"
                  guides="1" tooltips="1" connect="1" arrows="1"
                  fold="1" page="1" pageScale="1" pageWidth="1600"
                  pageHeight="900" math="0" shadow="0">
      <root>
        <!-- 固定根节点，必须保留 -->
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>

        <!-- 示例：标题节点（你可以修改 value 文本） -->
        <mxCell id="title" value="这里是标题"
                style="text;html=1;align=center;verticalAlign=middle;fontSize=20;fontStyle=1"
                vertex="1" parent="1">
          <mxGeometry x="40" y="20" width="800" height="40" as="geometry"/>
        </mxCell>

        <!-- 示例：步骤节点 1（你可以修改 value 文本和坐标） -->
        <mxCell id="step1" value="步骤 1：做什么"
                style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf"
                vertex="1" parent="1">
          <mxGeometry x="80" y="100" width="260" height="80" as="geometry"/>
        </mxCell>

        <!-- 示例：步骤节点 2 -->
        <mxCell id="step2" value="步骤 2：然后做什么"
                style="rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366"
                vertex="1" parent="1">
          <mxGeometry x="420" y="100" width="260" height="80" as="geometry"/>
        </mxCell>

        <!-- 示例：从 step1 到 step2 的有向边 -->
        <mxCell id="edge1"
                style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;endArrow=block;endFill=1"
                edge="1" parent="1" source="step1" target="step2">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
[/xml_content]

请生成你自己的图时：
- 只能在示例节点的位置增删节点或修改节点文本/坐标，必须保留 <mxfile> / <diagram> / <mxGraphModel> / <root> / id="0" / id="1" 等固定结构。
- 节点文本中可以使用换行符表示分行，但不要使用未配对的引号或 HTML 标签。
- 每个 <mxCell> 要么是 vertex="1"（节点），要么是 edge="1"（连线），不要两者同时出现。
- 控制节点数量，通常不超过 40 个，避免图过于拥挤。
`;

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
 * @param {string} q被点击的预设问题文本。
 */
function handlePresetQuestion(q) {
  const input = document.getElementById('chatbot-input');
  if (!input) return;
  let sendText = q;
  if (q.includes('流程图')) {
    sendText += MERMAID_FLOWCHART_PROMPT;
  }
  input.value = sendText;
  if (typeof window.handleChatbotSend === 'function') {
    window.handleChatbotSend();
  }
}

/**
 * 增强用户输入的提示词
 * 如果输入包含特定关键词，添加相应的提示词
 *
 * @param {string|Array} userInput - 用户输入，可能是字符串或多模态消息数组
 * @returns {string|Array} - 增强后的用户输入
 */
function enhanceUserPrompt(userInput) {
  // 如果是数组（多模态消息），找到文本部分并增强
  if (Array.isArray(userInput)) {
    const textPartIndex = userInput.findIndex(p => p.type === 'text');
    if (textPartIndex !== -1) {
      const textContent = userInput[textPartIndex].text;
      if (textContent.includes('流程图') && !textContent.includes('Mermaid语法')) {
        userInput[textPartIndex].text += MERMAID_FLOWCHART_PROMPT;
      }
    }
    return userInput;
  }
  // 如果是字符串，直接增强
  else if (typeof userInput === 'string') {
    if (userInput.includes('流程图') && !userInput.includes('Mermaid语法')) {
      return userInput + MERMAID_FLOWCHART_PROMPT;
    }
  }
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
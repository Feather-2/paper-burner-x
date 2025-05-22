// chatbot-preset.js

/**
 * @const {Array<string>} PRESET_QUESTIONS
 * 预设问题列表，用于在聊天机器人界面快速提问。
 * 这些问题通常是针对当前文档内容的常见查询。
 */
const PRESET_QUESTIONS = [
  '请总结本文',
  '有哪些关键公式？',
  '研究背景与意义？',
  '研究方法是什么，有什么发现？',
  '应用与前景如何？',
  '请用通俗语言解释全文',
  '为本文内容生成思维导图'
];

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
  input.value = q;
  if (typeof window.handleChatbotSend === 'function') {
    window.handleChatbotSend();
  }
}

window.ChatbotPreset = {
  PRESET_QUESTIONS,
  handlePresetQuestion
};
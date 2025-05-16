// chatbot-preset.js

const PRESET_QUESTIONS = [
  '请总结本文',
  '有哪些关键公式？',
  '研究背景与意义？',
  '研究方法是什么，有什么发现？',
  '应用与前景如何？',
  '请用通俗语言解释全文',
  '为本文内容生成思维导图'
];

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
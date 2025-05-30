// history_detail_scripts.js - 从history_detail.html中提取的JavaScript代码
// 这个文件包含了历史详情页面的主要JavaScript逻辑

window.addEventListener('storage', function(e) {
  if (e.key === 'paperBurnerSettings') {
    // 重新加载设置并刷新 chatbot 配置
    if (window.ChatbotCore && typeof window.ChatbotCore.getChatbotConfig === 'function') {
      // 你可以强制刷新 Chatbot UI 或重载配置
      window.ChatbotUI && window.ChatbotUI.updateChatbotUI && window.ChatbotUI.updateChatbotUI();
    }
  }
});

/**
 * 将 exact 文本转为模糊正则，允许空格、换行模糊匹配，大小写不敏感
 * @param {string} exact
 * @returns {RegExp}
 */
function escapeRegExp(string) {
  // 更安全地转义所有正则特殊字符
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fuzzyRegFromExact(exact) {
  // 先转义所有正则特殊字符
  let pattern = escapeRegExp(exact);
  // 将所有空白替换为 \s+，允许跨行、多个空格
  pattern = pattern.replace(/\s+/g, '\\s+');
  // 可选：忽略前后空白
  pattern = '\\s*' + pattern + '\\s*';
  return new RegExp(pattern, 'gi');
}

// function highlightTextWithAnnotations(text, annotations, contentIdentifier) { // Obsolete due to block based.
//   console.warn('[highlightTextWithAnnotations] This function is part of the old text-based highlighting system and should ideally be phased out.');
//   if (!annotations || !Array.isArray(annotations) || !text) return text;
//   // 只处理当前内容类型的高亮
//   const relevant = annotations.filter(
//     ann =>
//       ann.targetType === contentIdentifier &&
//       ann.target &&
//       Array.isArray(ann.target.selector) &&
//       ann.target.selector[0] &&
//       ann.target.selector[0].exact
//   );
//   if (relevant.length === 0) return text;

//   // 按照 exact 长度降序排序，避免嵌套覆盖
//   relevant.sort((a, b) => (b.target.selector[0].exact.length - a.target.selector[0].exact.length));

//   let result = text;
//   relevant.forEach(ann => {
//     const color = ann.highlightColor || 'yellow';
//     const note = ann.body && ann.body.length > 0 && ann.body[0].value ? ann.body[0].value : '';
//     const exact = ann.target.selector[0].exact;
//     const reg = fuzzyRegFromExact(exact);
//     result = result.replace(
//       reg,
//       `<mark class="annotation-highlight" style="background:${color}" title="${note.replace(/"/g, '&quot;')}">$&</mark>`
//     );
//   });
//   return result;
// }

// 以下是从原始HTML文件中提取的其他JavaScript代码
// 注意：许多函数已经移动到其他JS文件中，这里保留了注释以便于理解代码结构

// 绑定tab按钮点击事件
document.addEventListener('DOMContentLoaded', function() {
  if (document.getElementById('tab-ocr')) {
    document.getElementById('tab-ocr').onclick = function() { showTab('ocr'); };
  }
  if (document.getElementById('tab-translation')) {
    document.getElementById('tab-translation').onclick = function() { showTab('translation'); };
  }
  if (document.getElementById('tab-chunk-compare')) {
    document.getElementById('tab-chunk-compare').onclick = function() { showTab('chunk-compare'); };
  }

  // 页面加载后渲染详情
  if (typeof renderDetail === 'function') {
    renderDetail();
  }
});

// process/glossary.js

/**
 * 翻译备择库（术语库）匹配与注入工具。
 * 提供：
 * - 获取启用的术语条目
 * - 在给定文本中匹配命中条目
 * - 构建注入到系统提示词中的术语翻译指引
 */

function _loadEnabledGlossaryEntries() {
  if (typeof loadGlossaryEntries !== 'function') return [];
  const all = loadGlossaryEntries();
  return all.filter(e => e && e.enabled && e.term && e.translation);
}

function _buildRegexForEntry(term, wholeWord, caseSensitive) {
  // 基本转义
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hasAsciiWord = /[A-Za-z0-9_]/.test(term);
  const source = esc(term);
  let pattern = source;
  if (wholeWord && hasAsciiWord) {
    // 英文等使用 \b 边界；对中文不加边界
    pattern = `\\b${source}\\b`;
  }
  const flags = caseSensitive ? 'g' : 'gi';
  try {
    return new RegExp(pattern, flags);
  } catch (e) {
    console.warn('Invalid glossary regex from term:', term, e);
    return null;
  }
}

/**
 * 在文本中查找命中的术语条目。
 * @param {string} text
 * @returns {Array<{term:string, translation:string}>}
 */
function getGlossaryMatchesForText(text) {
  if (!text) return [];
  const entries = _loadEnabledGlossaryEntries();
  const matched = [];
  const seen = new Set();
  for (const e of entries) {
    const re = _buildRegexForEntry(e.term, !!e.wholeWord, !!e.caseSensitive);
    if (!re) continue;
    if (re.test(text)) {
      const key = `${e.term}=>${e.translation}`;
      if (!seen.has(key)) {
        matched.push({ term: e.term, translation: e.translation });
        seen.add(key);
      }
    }
  }
  return matched;
}

/**
 * 构建注入系统提示词的术语指引段落。
 * 仅对当前分块/表格生效，控制模型按指定译法统一翻译。
 * @param {Array<{term:string, translation:string}>} matches
 * @param {string} targetLangName - 目标语言展示名（可直接使用 settings 的 targetLanguage 值或用户自定义）
 */
function buildGlossaryInstruction(matches, targetLangName) {
  if (!matches || matches.length === 0) return '';
  const items = matches.map(m => `- "${m.term}" -> "${m.translation}"`).join('\n');
  return `术语翻译指引（仅对本段文本生效）：\n${items}\n\n要求：遇到上述术语/词组时，请严格使用对应译法，保持统一。不要修改代码块、公式中的内容，保持 Markdown 结构不变。`;
}

// 挂载到 processModule
if (typeof processModule !== 'undefined') {
  processModule.getGlossaryMatchesForText = getGlossaryMatchesForText;
  processModule.buildGlossaryInstruction = buildGlossaryInstruction;
}


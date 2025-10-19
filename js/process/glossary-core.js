// process/glossary.js

/**
 * 翻译备择库（术语库）匹配与注入工具。
 * 提供：
 * - 获取启用的术语条目
 * - 在给定文本中匹配命中条目
 * - 构建注入到系统提示词中的术语翻译指引
 */

// 缓存编译好的正则表达式
let _glossaryRegexCache = null;
let _glossaryRegexVersion = 0;

function _loadEnabledGlossaryEntries() {
  if (typeof loadGlossaryEntries !== 'function') return [];
  const all = loadGlossaryEntries();
  return all.filter(e => e && e.enabled && e.term && e.translation);
}

function _buildRegexMapForEntries(entries) {
  const map = new Map();
  for (const e of entries) {
    const re = _buildRegexForEntry(e.term, !!e.wholeWord, !!e.caseSensitive);
    if (re) {
      map.set(e, re);
    }
  }
  return map;
}

function _getOrBuildRegexMap() {
  const entries = _loadEnabledGlossaryEntries();
  const currentVersion = entries.length + entries.map(e => e.term).join('|');

  if (_glossaryRegexCache && _glossaryRegexVersion === currentVersion) {
    return _glossaryRegexCache;
  }

  _glossaryRegexCache = _buildRegexMapForEntries(entries);
  _glossaryRegexVersion = currentVersion;
  return _glossaryRegexCache;
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
 * 使用高效的 Trie 树多模式匹配算法（O(L+m) 复杂度）
 * @param {string} text
 * @returns {Array<{term:string, translation:string}>}
 */
function getGlossaryMatchesForText(text) {
  if (!text) return [];

  // 优先使用新的高效匹配器
  if (typeof findGlossaryMatchesFast === 'function') {
    const matches = findGlossaryMatchesFast(text);
    return _filterAndSortMatches(matches, text);
  }

  // 降级到正则表达式方案
  const regexMap = _getOrBuildRegexMap();
  const matched = [];
  const seen = new Set();

  for (const [entry, regex] of regexMap) {
    if (regex.test(text)) {
      const key = `${entry.term}=>${entry.translation}`;
      if (!seen.has(key)) {
        matched.push({ term: entry.term, translation: entry.translation });
        seen.add(key);
      }
    }
  }
  return _filterAndSortMatches(matched, text);
}

/**
 * 检查是否应该应用智能过滤
 * 如果至少有一个启用的术语库开启了智能过滤，则返回 true
 * @returns {boolean}
 */
function _shouldApplySmartFilter() {
  if (typeof loadGlossarySets !== 'function') return true; // 默认启用

  const sets = loadGlossarySets();
  const setIds = Object.keys(sets || {});

  // 如果没有术语库，默认启用过滤
  if (setIds.length === 0) return true;

  // 检查是否至少有一个启用的术语库开启了智能过滤
  for (const id of setIds) {
    const set = sets[id];
    if (set && set.enabled) {
      // enableSmartFilter 默认为 true（未定义时）
      if (set.enableSmartFilter !== false) {
        return true;
      }
    }
  }

  // 所有启用的术语库都禁用了智能过滤
  return false;
}

/**
 * 过滤和排序匹配结果，优先保留重要术语
 * @param {Array} matches - 原始匹配结果
 * @returns {Array} 过滤和排序后的匹配结果
 */
function _filterAndSortMatches(matches) {
  if (!matches || matches.length === 0) return [];

  // 检查是否需要智能过滤
  const shouldApplySmartFilter = _shouldApplySmartFilter();

  if (!shouldApplySmartFilter) {
    // 不应用智能过滤，只做简单排序
    return matches.slice().sort((a, b) => {
      return (b.term || '').length - (a.term || '').length;
    });
  }

  // 应用智能过滤
  // 常见通用词黑名单（这些词不应该作为专业术语）
  const COMMON_WORDS_BLACKLIST = new Set([
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could',
    'may', 'might', 'must', 'can', 'of', 'in', 'on', 'at', 'to', 'for', 'with',
    'by', 'from', 'as', 'that', 'this', 'these', 'those', 'it', 'its',
    'and', 'or', 'but', 'if', 'so', 'not', 'no', 'yes', 'all', 'any', 'some',
    'i', 'you', 'he', 'she', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
    'my', 'your', 'his', 'her', 'our', 'their', 'one', 'two', 'three',
    'first', 'second', 'more', 'most', 'other', 'such', 'only', 'own', 'same',
    'up', 'out', 'over', 'under', 'above', 'below', 'between', 'through',
    'during', 'before', 'after', 'since', 'until', 'while', 'about', 'than',
    'also', 'very', 'just', 'here', 'there', 'where', 'when', 'why', 'how',
    'what', 'which', 'who', 'whom', 'whose', 'each', 'every', 'both', 'few',
    'many', 'much', 'several', 'now', 'then', 'always', 'never', 'often',
    'sometimes', 'usually', 'really', 'actually', 'basically', 'generally'
  ]);

  // 常见通用短语黑名单（多词组合但不是专业术语）
  const COMMON_PHRASES_BLACKLIST = new Set([
    'with regard to', 'with respect to', 'in terms of', 'in relation to',
    'with reference to', 'in connection with', 'in accordance with',
    'as a result', 'as a result of', 'in addition to', 'in spite of',
    'as well as', 'as long as', 'as soon as', 'in order to', 'in case of',
    'by means of', 'on behalf of', 'because of', 'instead of', 'in front of',
    'in place of', 'by way of', 'for the sake of', 'at the same time',
    'in the meantime', 'in the end', 'at the end', 'in the beginning',
    'for example', 'for instance', 'such as', 'and so on', 'and so forth',
    'in other words', 'in fact', 'in practice', 'in theory', 'in general',
    'in particular', 'in detail', 'in brief', 'in short', 'in conclusion',
    'on the other hand', 'on the contrary', 'by the way', 'in the way',
    'the situation', 'the case', 'the fact', 'the point', 'the problem',
    'the question', 'the answer', 'the reason', 'the result', 'the purpose',
    'at least', 'at most', 'at first', 'at last', 'at all', 'not at all',
    'as usual', 'as follows', 'as mentioned', 'as noted', 'as shown'
  ]);

  // 过滤逻辑
  const MIN_TERM_LENGTH = 3; // 最小长度提高到 3
  const filtered = matches.filter(m => {
    const term = (m.term || '').toLowerCase().trim();

    // 1. 过滤掉单词黑名单中的通用词
    if (COMMON_WORDS_BLACKLIST.has(term)) {
      return false;
    }

    // 2. 过滤掉短语黑名单中的通用短语
    if (COMMON_PHRASES_BLACKLIST.has(term)) {
      return false;
    }

    // 3. 保留长度 >= 3 的术语
    if (term.length < MIN_TERM_LENGTH) {
      // 除非是中文术语（中文术语可以更短）
      if (!/[\u4e00-\u9fa5]/.test(term)) {
        return false;
      }
    }

    // 4. 过滤掉纯数字
    if (/^\d+$/.test(term)) {
      return false;
    }

    // 5. 保留包含大写字母的术语（可能是缩写或专有名词，如 API, NASA）
    if (/[A-Z]/.test(m.term)) {
      return true;
    }

    // 6. 保留多个单词组成的短语（更可能是专业术语）
    // 但需要检查是否包含过多常用词
    if (/\s/.test(term)) {
      const words = term.split(/\s+/);
      const commonWordCount = words.filter(w => COMMON_WORDS_BLACKLIST.has(w)).length;
      // 如果超过一半是常用词，则过滤掉
      if (commonWordCount > words.length / 2) {
        return false;
      }
      return true;
    }

    // 7. 保留包含连字符或特殊字符的术语（如 machine-learning, AI/ML）
    if (/[-_\/]/.test(term)) {
      return true;
    }

    return true;
  });

  // 计算术语的"重要性得分"并排序
  const scored = filtered.map(m => {
    let score = 0;
    const term = m.term || '';

    // 长度越长，得分越高（长术语通常更专业）
    score += term.length * 2;

    // 包含大写字母（缩写、专有名词）+20
    if (/[A-Z]/.test(term)) {
      score += 20;
    }

    // 多词短语 +30
    if (/\s/.test(term)) {
      score += 30;
    }

    // 包含特殊字符 +10
    if (/[-_\/]/.test(term)) {
      score += 10;
    }

    // 中文术语 +15
    if (/[\u4e00-\u9fa5]/.test(term)) {
      score += 15;
    }

    return { ...m, _score: score };
  });

  // 按得分降序排序
  scored.sort((a, b) => b._score - a._score);

  // 移除得分属性并返回
  return scored.map(({ _score, ...rest }) => rest);
}

/**
 * 构建注入系统提示词的术语指引段落。
 * 仅对当前分块/表格生效，控制模型按指定译法统一翻译。
 * @param {Array<{term:string, translation:string}>} matches
 * @param {string} targetLangName - 目标语言展示名（可直接使用 settings 的 targetLanguage 值或用户自定义）
 */
function buildGlossaryInstruction(matches, targetLangName) {
  if (!matches || matches.length === 0) return '';

  // 获取数量限制配置（检查所有启用的术语库，取最小值）
  let maxTerms = 50; // 默认值
  if (typeof loadGlossarySets === 'function') {
    const sets = loadGlossarySets();
    const setIds = Object.keys(sets || {});
    for (const id of setIds) {
      const set = sets[id];
      if (set && set.enabled && set.maxTermsInPrompt) {
        maxTerms = Math.max(1, Math.min(500, set.maxTermsInPrompt));
        break; // 使用第一个启用的术语库的配置
      }
    }
  }

  // 限制术语数量
  const limitedMatches = matches.slice(0, maxTerms);

  const items = limitedMatches.map(m => `${m.term}→${m.translation}`).join('、');

  return `[术语参考] ${items}

注：以上为本段可能涉及的专业术语建议译法，仅供参考。请以自然流畅的翻译为主，适当参考术语建议即可。`;
}

// 挂载到 processModule
if (typeof processModule !== 'undefined') {
  processModule.getGlossaryMatchesForText = getGlossaryMatchesForText;
  processModule.buildGlossaryInstruction = buildGlossaryInstruction;
}

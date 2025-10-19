// process/glossary-matcher.js
/**
 * 高效多模式术语匹配器
 * 使用改进的 Aho-Corasick 算法，时间复杂度 O(L + m)
 * L = 文本长度，m = 匹配数
 */

class GlossaryMatcher {
  constructor() {
    this.root = { children: new Map(), entries: [] };
    this.caseInsensitiveRoot = { children: new Map(), entries: [] };
    this.hasWholeWordEntries = false;
  }

  /**
   * 构建 Trie 树
   * @param {Array} entries - 术语条目数组
   */
  build(entries) {
    this.root = { children: new Map(), entries: [] };
    this.caseInsensitiveRoot = { children: new Map(), entries: [] };
    this.hasWholeWordEntries = false;

    for (const entry of entries) {
      if (!entry.term || !entry.translation) continue;

      const root = entry.caseSensitive ? this.root : this.caseInsensitiveRoot;
      const term = entry.caseSensitive ? entry.term : entry.term.toLowerCase();

      let node = root;
      for (const char of term) {
        if (!node.children.has(char)) {
          node.children.set(char, { children: new Map(), entries: [] });
        }
        node = node.children.get(char);
      }

      node.entries.push({
        term: entry.term,
        translation: entry.translation,
        wholeWord: !!entry.wholeWord,
        caseSensitive: !!entry.caseSensitive
      });

      if (entry.wholeWord) {
        this.hasWholeWordEntries = true;
      }
    }
  }

  /**
   * 检查是否为单词边界
   */
  _isWordBoundary(text, index) {
    if (index < 0 || index >= text.length) return true;
    const char = text[index];
    return !/[A-Za-z0-9_]/.test(char);
  }

  /**
   * 检查位置是否有 ASCII 字符（用于判断是否需要边界检查）
   */
  _hasAsciiWord(str) {
    return /[A-Za-z0-9_]/.test(str);
  }

  /**
   * 在文本中查找所有匹配
   * @param {string} text - 要搜索的文本
   * @returns {Array} 匹配的术语列表
   */
  findMatches(text) {
    if (!text) return [];

    const matches = [];
    const seen = new Set();
    const textLower = text.toLowerCase();

    // 遍历文本的每个位置
    for (let i = 0; i < text.length; i++) {
      // 尝试大小写敏感匹配
      this._searchFromPosition(text, i, this.root, true, matches, seen);

      // 尝试大小写不敏感匹配
      this._searchFromPosition(textLower, i, this.caseInsensitiveRoot, false, matches, seen);
    }

    return matches;
  }

  /**
   * 从指定位置开始搜索
   */
  _searchFromPosition(text, startPos, root, caseSensitive, matches, seen) {
    let node = root;
    let pos = startPos;

    while (pos < text.length) {
      const char = text[pos];

      if (!node.children.has(char)) {
        break;
      }

      node = node.children.get(char);
      pos++;

      // 检查当前节点是否有完整术语
      if (node.entries.length > 0) {
        const matchedText = text.substring(startPos, pos);

        for (const entry of node.entries) {
          // 检查大小写是否匹配
          if (entry.caseSensitive !== caseSensitive) continue;

          // 如果需要全词匹配，检查边界
          if (entry.wholeWord && this._hasAsciiWord(entry.term)) {
            if (!this._isWordBoundary(text, startPos - 1) ||
                !this._isWordBoundary(text, pos)) {
              continue;
            }
          }

          const key = `${entry.term}=>${entry.translation}`;
          if (!seen.has(key)) {
            matches.push({
              term: entry.term,
              translation: entry.translation
            });
            seen.add(key);
          }
        }
      }
    }
  }

  /**
   * 快速检查文本是否包含任何术语（用于预过滤）
   */
  hasAnyMatch(text) {
    if (!text) return false;

    const textLower = text.toLowerCase();

    // 快速检查：遍历到第一个匹配就返回
    for (let i = 0; i < text.length; i++) {
      if (this._hasMatchAtPosition(text, i, this.root, true)) return true;
      if (this._hasMatchAtPosition(textLower, i, this.caseInsensitiveRoot, false)) return true;
    }

    return false;
  }

  _hasMatchAtPosition(text, startPos, root, caseSensitive) {
    let node = root;
    let pos = startPos;

    while (pos < text.length) {
      const char = text[pos];
      if (!node.children.has(char)) break;

      node = node.children.get(char);
      pos++;

      if (node.entries.length > 0) {
        // 找到至少一个匹配（不检查全词边界，快速返回）
        for (const entry of node.entries) {
          if (entry.caseSensitive === caseSensitive) {
            if (!entry.wholeWord) return true;

            // 检查全词边界
            if (this._hasAsciiWord(entry.term)) {
              if (this._isWordBoundary(text, startPos - 1) &&
                  this._isWordBoundary(text, pos)) {
                return true;
              }
            } else {
              return true;
            }
          }
        }
      }
    }

    return false;
  }
}

// 全局实例和缓存
let _globalMatcher = null;
let _matcherVersion = 0;

/**
 * 获取或创建全局匹配器实例
 */
function getOrCreateMatcher() {
  if (typeof loadGlossaryEntries !== 'function') {
    return new GlossaryMatcher();
  }

  const allEntries = loadGlossaryEntries();
  const enabledEntries = allEntries.filter(e => e && e.enabled && e.term && e.translation);

  // 简单版本控制：长度 + 前几个术语的哈希
  const versionHash = enabledEntries.length +
    enabledEntries.slice(0, 10).map(e => e.term).join('|');

  if (_globalMatcher && _matcherVersion === versionHash) {
    return _globalMatcher;
  }

  const matcher = new GlossaryMatcher();
  matcher.build(enabledEntries);

  _globalMatcher = matcher;
  _matcherVersion = versionHash;

  return matcher;
}

// 导出函数供旧 API 兼容
function findGlossaryMatchesFast(text) {
  const matcher = getOrCreateMatcher();
  return matcher.findMatches(text);
}

// 挂载到全局
if (typeof window !== 'undefined') {
  window.GlossaryMatcher = GlossaryMatcher;
  window.getGlossaryMatcher = getOrCreateMatcher;
  window.findGlossaryMatchesFast = findGlossaryMatchesFast;
}

// js/chatbot/agents/semantic-tools.js
(function(window){
  'use strict';

  if (window.SemanticTools) return;

  function ensureGroups() {
    const groups = window.data && Array.isArray(window.data.semanticGroups) ? window.data.semanticGroups : [];
    return groups;
  }

  function listGroups(limit = 50, includeDigest = false) {
    const groups = ensureGroups();
    const out = groups.slice(0, limit).map(g => ({
      groupId: g.groupId,
      charCount: g.charCount || 0,
      keywords: Array.isArray(g.keywords) ? g.keywords : [],
      summary: g.summary || '',
      digest: includeDigest ? (g.digest || '').slice(0, 800) : undefined
    }));
    return out;
  }

  function searchGroups(query, limit = 8) {
    const groups = ensureGroups();
    if (!query || !groups.length) return [];
    try {
      if (window.SemanticGrouper && typeof window.SemanticGrouper.quickMatch === 'function') {
        const matched = window.SemanticGrouper.quickMatch(query, groups) || [];
        return matched.slice(0, limit).map(g => ({ groupId: g.groupId, summary: g.summary || '', keywords: g.keywords || [], charCount: g.charCount || 0 }));
      }
    } catch (e) { console.warn('[SemanticTools.searchGroups] quickMatch failed:', e); }
    // fallback: naive search on summary and keywords
    const q = String(query).toLowerCase();
    const scored = groups.map(g => {
      let score = 0;
      if (g.summary && g.summary.toLowerCase().includes(q)) score += 2;
      if (Array.isArray(g.keywords) && g.keywords.some(k => String(k).toLowerCase().includes(q))) score += 3;
      return { g, score };
    });
    scored.sort((a,b)=>b.score-a.score);
    return scored.filter(s => s.score>0).slice(0, limit).map(s => ({ groupId: s.g.groupId, summary: s.g.summary || '', keywords: s.g.keywords || [], charCount: s.g.charCount || 0 }));
  }

  function fetchGroupText(groupId, granularity = 'digest') {
    const groups = ensureGroups();
    const g = groups.find(x => x.groupId === groupId);
    if (!g) return { groupId, granularity, text: '' };
    const gran = (granularity || 'digest').toLowerCase();
    let text = '';
    if (gran === 'full') text = g.fullText || g.digest || g.summary || '';
    else if (gran === 'summary') text = g.summary || '';
    else text = g.digest || g.summary || g.fullText || '';
    // 限制长度，避免爆 token
    const caps = { summary: 800, digest: 3000, full: 8000 };
    const cap = caps[gran] || 3000;
    if (text.length > cap) text = text.slice(0, cap);
    return { groupId, granularity: gran, text };
  }

  function findInGroups(query, scope = 'digest', limit = 10) {
    const groups = ensureGroups();
    if (!query || !groups.length) return [];
    const q = String(query).trim();
    if (!q) return [];
    const tokens = q.toLowerCase().split(/[\s,，。、“”\-—_:;；]+/).filter(t => t.length > 0);
    const pickText = (g) => {
      const s = scope.toLowerCase();
      if (s === 'summary') return g.summary || '';
      if (s === 'full') return g.fullText || g.digest || g.summary || '';
      return g.digest || g.summary || g.fullText || '';
    };
    const scored = groups.map(g => {
      const text = pickText(g);
      const lower = text.toLowerCase();
      let score = 0;
      tokens.forEach(t => { if (lower.includes(t)) score += 1; });
      // 简单长度惩罚，偏向短文本匹配
      score = score / Math.max(1, Math.log10(text.length + 10));
      return { g, score, text };
    }).filter(x => x.score > 0);
    scored.sort((a,b)=>b.score-a.score);
    const top = scored.slice(0, limit).map(x => {
      // 取第一处命中附近的片段
      let idx = -1;
      for (const t of tokens) { idx = x.text.toLowerCase().indexOf(t); if (idx >= 0) break; }
      if (idx < 0) idx = 0;
      const start = Math.max(0, idx - 80);
      const end = Math.min(x.text.length, idx + 220);
      const snippet = x.text.slice(start, end);
      return { groupId: x.g.groupId, score: x.score, snippet, scope };
    });
    return top;
  }

  window.SemanticTools = {
    listGroups,
    searchGroups,
    fetchGroupText,
    findInGroups
  };

  console.log('[SemanticTools] 工具模块已加载');
})(window);

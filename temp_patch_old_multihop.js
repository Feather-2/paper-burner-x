// 临时脚本：更新旧的multiHopRetrieve函数
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'js/chatbot/core/chatbot-core.js');
let content = fs.readFileSync(filePath, 'utf8');

// 修改1: 第1831行 - 展示所有意群
content = content.replace(
  /let candidates = groups\.slice\(0, Math\.min\(groups\.length, 12\)\);/,
  'const candidates = groups; // 展示所有意群作为全局地图'
);

// 修改2: 第1832-1853行 - 删除预筛选逻辑
const oldPrefilter = `    try {
      // 优先使用向量搜索
      if (window.SemanticVectorSearch && window.EmbeddingClient?.config?.enabled) {
        const matched = await window.SemanticVectorSearch.search(String(userQuestion || ''), groups, {
          topK: 12,
          threshold: 0.3,
          useHybrid: true
        });
        if (matched && matched.length > 0) {
          candidates = matched;
          console.log('[multiHopRetrieve] 使用向量搜索获取候选意群');
        }
      } else if (window.SemanticGrouper && typeof window.SemanticGrouper.quickMatch === 'function') {
        const matched = window.SemanticGrouper.quickMatch(String(userQuestion || ''), groups);
        if (matched && matched.length > 0) {
          candidates = matched.slice(0, 12);
          console.log('[multiHopRetrieve] 使用关键词匹配获取候选意群');
        }
      }
    } catch (e) {
      console.warn('[multiHopRetrieve] 候选意群匹配失败，使用前12个:', e);
    }`;

content = content.replace(oldPrefilter, '');

// 修改3: 第1861行 - 展示完整意群地图
content = content.replace(
  /const listText = candidates\.map\(g => `id:\$\{g\.groupId\} \| 关键词:\$\{.*/,
  `const listText = candidates.map(g => {
        const struct = g.structure || {};
        const parts = [\`【\${g.groupId}】 \${g.charCount || 0}字\`];
        if (g.keywords && g.keywords.length > 0) parts.push(\`关键词: \${g.keywords.join('、')}\`);
        if (struct.figures && struct.figures.length > 0) parts.push(\`包含图: \${struct.figures.join('; ')}\`);
        if (struct.tables && struct.tables.length > 0) parts.push(\`包含表: \${struct.tables.join('; ')}\`);
        if (struct.sections && struct.sections.length > 0) parts.push(\`章节: \${struct.sections.join('; ')}\`);
        if (struct.keyPoints && struct.keyPoints.length > 0) parts.push(\`要点: \${struct.keyPoints.join('; ')}\`);
        if (g.summary) parts.push(\`摘要: \${g.summary}\`);
        return parts.join('\\\\n');
      }).join('\\\\n\\\\n');`
);

// 修改4: 第1863行 - 更新系统提示词
const oldSys = `const sys = \`你是检索规划助手。你可以调用以下工具，按需多轮取材：\\n\\n工具定义(JSON)：\\n- {"tool":"search_groups","args":{"query":"...","limit":3}} -> 按关键词/摘要匹配，返回候选组\\n- {"tool":"find","args":{"query":"...","scope":"summary|digest|full","limit":3}} -> 在所有意群的指定粒度文本中查找命中片段，返回候选组及片段\\n- {"tool":"fetch_group","args":{"groupId":"group-1","granularity":"summary|digest|full"}} -> 取该意群对应粒度的内容\\n\\n规划规则：\\n1. 每轮 operations 至少包含一次 fetch_group（可以先 search/find 再 fetch）。\\n2. 如果不确定取哪一组，也要 fetch_group 获得最可能的内容。\\n3. 只有在你已经获取到足够的上下文后，才设置 "final": true。\\n\\n返回格式(JSON-only)：\\n{"operations":[{"tool":"search_groups", "args":{...}}, {"tool":"find", "args":{...}}, {"tool":"fetch_group", "args":{...}}], "final": false}\\n不要输出解释文字。\`;`;

const newSys = `const sys = \`你是检索规划助手。你可以调用以下工具，按需多轮取材：

工具定义(JSON)：
- {"tool":"vector_search","args":{"query":"...","limit":5}} -> 向量语义搜索，在文档的所有原始chunks中搜索，返回最相关的chunks（每个chunk 1500-3000字）
- {"tool":"keyword_search","args":{"keywords":["关键词1","关键词2"],"limit":3}} -> 关键词精确匹配，在所有chunks中搜索，返回包含这些关键词的chunks
- {"tool":"fetch_group","args":{"groupId":"group-1","granularity":"summary|digest|full"}} -> 获取指定意群的内容（意群是多个chunks的聚合，5000字）

重要说明：
1. 【候选意群列表】提供了文档的完整结构地图，包括每个意群的摘要、图表、章节信息，帮助你建立全局视角。
2. 【务必使用vector_search或keyword_search】来精确定位相关内容，不要依赖意群摘要判断。
3. vector_search和keyword_search返回的是原始chunks（1500-3000字），比意群更精确。
4. 如果需要更完整的上下文，可以根据chunk的belongsToGroup字段，使用fetch_group获取完整意群。

规划规则：
1. 第一轮必须使用vector_search或keyword_search进行搜索，不能直接fetch_group。
2. vector_search用于语义相似搜索，keyword_search用于精确术语匹配。
3. 根据问题性质选择合适的检索工具，也可以同时使用多个工具。
4. 只有在你已经获取到足够的上下文后，才设置 "final": true。

返回格式(JSON-only)：
{"operations":[{"tool":"vector_search", "args":{...}}, {"tool":"keyword_search", "args":{...}}, {"tool":"fetch_group", "args":{...}}], "final": false}
不要输出解释文字。\`;`;

content = content.replace(oldSys, newSys);

fs.writeFileSync(filePath, content, 'utf8');
console.log('✅ 旧的multiHopRetrieve函数已更新');

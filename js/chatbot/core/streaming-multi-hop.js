// js/chatbot/core/streaming-multi-hop.js
// 流式多轮取材 - 实时进度反馈
(function(window) {
  'use strict';

  /**
   * 估算文本的token数量（简化版）
   * @param {string} text - 要估算的文本
   * @returns {number} 估算的token数
   */
  function estimateTokens(text) {
    if (!text || typeof text !== 'string') return 0;

    // 中文字符：平均1.5字符 = 1 token
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const chineseTokens = Math.ceil(chineseChars / 1.5);

    // 英文单词：平均1个单词 = 0.75 token
    const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
    const englishTokens = Math.ceil(englishWords * 0.75);

    // 数字和符号：粗略估算
    const otherChars = text.length - chineseChars - text.match(/[a-zA-Z\s]/g)?.length || 0;
    const otherTokens = Math.ceil(otherChars / 4);

    return chineseTokens + englishTokens + otherTokens;
  }

  /**
   * 流式多轮取材
   * 使用 Generator 函数实现流式输出，每个步骤都实时反馈给UI
   *
   * @param {string} userQuestion - 用户问题
   * @param {Object} docContentInfo - 文档内容信息
   * @param {Object} config - 配置
   * @param {Object} options - 选项
   * @returns {AsyncGenerator} 异步生成器
   */
  async function* streamingMultiHopRetrieve(userQuestion, docContentInfo, config, options = {}) {
    const userSet = window.semanticGroupsSettings || {};
    // 设置较大上限防止死循环，但主要由AI通过final标志决定何时结束
    const maxRounds = Number(options.maxRounds ?? userSet.maxRounds) > 0 ? Number(options.maxRounds ?? userSet.maxRounds) : 10;

    try {
      const groups = Array.isArray(docContentInfo.semanticGroups) ? docContentInfo.semanticGroups : [];
      const hasGroups = groups.length > 0;

      if (!hasGroups) {
        console.log('[StreamingMultiHop] 没有意群数据，将只使用grep工具进行检索');
      }

      // 1. 分析问题，获取候选意群（如果有的话）
      if (hasGroups) {
        yield {
          type: 'status',
          phase: 'analyze',
          message: '正在分析问题...'
        };
      }

      const candidates = groups;


      // 2. 多轮取材循环
      const fetched = new Map();
      const detail = [];
      let contextParts = [];
      const gist = (window.data && window.data.semanticDocGist) ? window.data.semanticDocGist : '';
      const searchHistory = []; // 记录搜索历史

      // 任务追踪状态
      let taskStatusHistory = {
        completed: [],
        current: '',
        pending: []
      };

      /**
       * 升级或获取意群内容
       * @param {Set<string>} groupIds - 意群ID集合
       * @param {string} targetGranularity - 目标粒度 (summary/digest/full)
       */
      const upgradeOrFetchGroups = async (groupIds, targetGranularity = 'digest') => {
        if (groupIds.size === 0) {
          console.warn('[StreamingMultiHop] upgradeOrFetchGroups: groupIds为空');
          return;
        }

        console.log(`[StreamingMultiHop] 开始升级/获取 ${groupIds.size} 个意群到 ${targetGranularity}`);

        for (const groupId of groupIds) {
          if (window.SemanticTools && typeof window.SemanticTools.fetchGroupText === 'function') {
            try {
              const existing = fetched.get(groupId);
              const shouldFetch = !existing ||
                                  (existing.granularity === 'summary' && targetGranularity !== 'summary') ||
                                  (existing.granularity === 'digest' && targetGranularity === 'full');

              if (shouldFetch) {
                const groupRes = window.SemanticTools.fetchGroupText(groupId, targetGranularity);
                if (groupRes && groupRes.text) {
                  const isUpgrade = fetched.has(groupId);
                  fetched.set(groupId, { granularity: groupRes.granularity, text: groupRes.text });

                  console.log(`[StreamingMultiHop] ${isUpgrade ? '升级' : '新增'} ${groupId}: ${existing?.granularity || '无'} → ${groupRes.granularity}`);

                  // 更新detail和contextParts
                  if (isUpgrade) {
                    // 升级：替换原有内容
                    const idx = detail.findIndex(d => d.groupId === groupId);
                    if (idx >= 0) detail[idx].granularity = groupRes.granularity;

                    const ctxIdx = contextParts.findIndex(c => c.startsWith(`【${groupId}`));
                    if (ctxIdx >= 0) {
                      contextParts[ctxIdx] = `【${groupId} - ${groupRes.granularity}】\n${groupRes.text}`;
                    }
                  } else {
                    // 新增
                    detail.push({ groupId: groupId, granularity: groupRes.granularity });
                    contextParts.push(`【${groupId} - ${groupRes.granularity}】\n${groupRes.text}`);
                  }
                } else {
                  console.warn(`[StreamingMultiHop] fetchGroupText返回空: ${groupId}`);
                }
              } else {
                console.log(`[StreamingMultiHop] 跳过 ${groupId}: 已有${existing.granularity}，无需升级到${targetGranularity}`);
              }
            } catch (e) {
              console.error(`[StreamingMultiHop] 升级${groupId}失败:`, e);
            }
          }
        }

        console.log(`[StreamingMultiHop] 升级完成，当前detail数量: ${detail.length}`);
      };

      // 预加载策略：第一轮给AI所有意群的summary，让AI判断哪些需要详细内容
      // 后续轮会清理掉AI不感兴趣的意群，只保留AI操作过的内容
      let preloadedInFirstRound = false;
      const interestedGroups = new Set(); // 记录AI感兴趣的意群（fetch过或搜索命中）
      let aiRequestedMapInFinalContext = false; // AI决定是否在最终上下文中包含地图
      let aiRequestedGroupListInFinalContext = false; // AI决定是否在最终上下文中包含意群简要列表

      if (hasGroups && userSet && userSet.preloadFirstRound === true && groups.length <= 50) {
        yield {
          type: 'status',
          phase: 'preload',
          message: `预加载 ${groups.length} 个意群摘要供AI判断...`
        };

        // 第一轮：预加载所有summary
        for (const g of groups) {
          if (window.SemanticTools?.fetchGroupText) {
            try {
              const res = window.SemanticTools.fetchGroupText(g.groupId, 'summary');
              if (res && res.text) {
                fetched.set(g.groupId, { granularity: 'summary', text: res.text });
                detail.push({ groupId: g.groupId, granularity: 'summary' });
                contextParts.push(`【${g.groupId} - summary】\n${res.text}`);
              }
            } catch (_) {}
          }
        }

        preloadedInFirstRound = true;
        yield {
          type: 'status',
          phase: 'preload_complete',
          message: `已预加载 ${fetched.size} 个意群摘要，等待AI判断...`
        };
      }

      for (let round = 0; round < maxRounds; round++) {
        yield {
          type: 'round_start',
          round,
          message: `第 ${round + 1} 轮取材...`
        };

        // 地图文本：仅在AI通过 map 工具请求后注入
        const listText = (typeof window._multiHopLastMapText === 'string' && window._multiHopLastMapText) ? window._multiHopLastMapText : '';

        // 构造已获取内容的摘要
        let fetchedSummary = '无';
        if (fetched.size > 0) {
          const fetchedDetails = [];
          for (const [groupId, data] of fetched.entries()) {
            const preview = data.text.length > 500 ? data.text.substring(0, 500) + '...' : data.text;
            fetchedDetails.push(`【${groupId}】(${data.granularity})\n${preview}`);
          }
          fetchedSummary = fetchedDetails.join('\n\n');
        }

        // 构造搜索历史提示
        let searchHistoryText = '';
        if (searchHistory.length > 0) {
          const recentSearches = searchHistory.slice(-5); // 最近5次
          searchHistoryText = '\n\n【搜索历史】(避免重复搜索这些查询):\n' + recentSearches.map(s => {
            const status = s.resultCount > 0 ? `✓ ${s.resultCount}个结果` : '✗ 无结果';
            return `- ${s.tool === 'keyword_search' ? '关键词' : '向量'}搜索 "${s.query}" → ${status}`;
          }).join('\n');
        }

        const preloadedNotice = (round === 0 && fetched.size > 0) ? `

提示：已缓存 ${fetched.size} 个意群摘要在【已获取内容】中；若需整体地图，请调用 map 工具。` : '';

        // 检查文档配置
        const docId = (window.data && window.data.currentPdfName) || 'unknown';
        const docConfig = window.data?.multiHopConfig?.[docId];
        const useSemanticGroups = docConfig?.useSemanticGroups !== false; // 默认true
        const useVectorSearch = docConfig?.useVectorSearch !== false; // 默认true

        // 根据配置动态构建工具列表说明
        const vectorSearchTool = useVectorSearch ? `**推荐优先使用：**
- {"tool":"vector_search","args":{"query":"语义描述","limit":15}}
  用途：**智能语义搜索**（理解同义词、相关概念、隐含关系）
  返回：语义最相关的chunks（每个1500-3000字）
  **优势**：
    * 理解问题的深层含义，不局限于字面匹配
    * 能找到换了说法但意思相同的内容
    * 适合概念性、开放性、探索性问题
    * 召回率高，不会因为换词而漏掉相关内容
  **你可以调整limit**：概念性问题可用limit=10-15，精确查找可用limit=5

` : '';

        // BM25搜索：无论是否有意群都可用（基于chunks）
        const keywordSearchTool = `
- {"tool":"keyword_search","args":{"keywords":["词1","词2"],"limit":8}}
  用途：多关键词加权搜索（BM25算法）
  返回：包含关键词的文档片段（按相关度评分）
  **使用时机**：精确查找特定关键词组合${!useVectorSearch ? '（主要搜索工具）' : '，或vector_search失败时的降级方案'}
  **你可以调整limit**：关键词明确可用limit=5，模糊查找可用limit=10
`;

        const advancedSearchTools = `
**高级匹配工具（特殊场景使用）：**
- {"tool":"regex_search","args":{"pattern":"\\\\d{4}年\\\\d{1,2}月","limit":10,"context":1500}}
  用途：正则表达式搜索（匹配特定格式）
  返回：符合正则模式的文本片段
  **适用场景**：
    * 搜索特定格式（日期"2023年5月"、编号"公式3.2"、"Fig. 1"）
    * 匹配复杂模式（电话、邮箱、特殊符号组合）
    * 数学公式编号、图表引用等
    * OCR错误的容错匹配（如"注[意愈]力"可用"注.力"匹配）
  **注意**：pattern需要转义特殊字符（\\\\d 表示数字，\\\\. 表示点号）

- {"tool":"boolean_search","args":{"query":"(CNN OR RNN) AND 对比 NOT 图像","limit":10,"context":1500}}
  用途：布尔逻辑搜索（AND/OR/NOT组合）
  返回：同时满足多个条件的文本片段
  **适用场景**：
    * 复杂逻辑查询（必须包含A和B，但不包含C）
    * 多概念精确组合（比grep的OR更强大）
    * 排除干扰信息（NOT关键词）
  **语法**：支持 AND, OR, NOT 和括号，如 "(词1 OR 词2) AND 词3 NOT 词4"
`;

        const mapFetchTools = useSemanticGroups ? `
### 获取详细内容工具
- {"tool":"fetch","args":{"groupId":"group-1"}}
  用途：获取指定意群详细内容（包含完整论述、公式、数据、图表）
  返回：完整文本（最多8000字）+ 结构信息
  **使用时机**：当搜索到的chunk片段信息不足，需要看到完整上下文时

- {"tool":"map","args":{"limit":50,"includeStructure":true}}
  用途：获取文档整体结构
  返回：意群地图（ID、字数、关键词、摘要、章节/图表/公式）
${preloadedNotice}
` : `${preloadedNotice}
`;

        const sys = `你是检索规划助手，专门负责规划如何从文档中检索相关内容。

**重要：你的角色定位**
- ⚠️ **你不负责回答用户问题**，你只负责规划如何检索文档内容
- ⚠️ **不要生成mermaid图表、思维导图或任何最终答案**
- ✓ 你的任务：分析用户问题 → 规划使用哪些工具检索文档 → 输出JSON格式的检索计划
- ✓ 检索到的内容会交给另一个AI来回答用户问题

**你的工作流程**
1. 分析用户问题，判断需要什么类型的信息
2. 选择合适的检索工具组合
3. **规划任务清单**：将复杂问题拆解为多个检索子任务
4. 输出JSON格式的检索计划（不是答案！）

## 工具定义（JSON格式）

### 搜索工具（返回chunk内容，由你决定是否需要完整意群）

${vectorSearchTool}**精确匹配场景使用：**
- {"tool":"grep","args":{"query":"具体短语","limit":20,"context":2000,"caseInsensitive":true}}
  用途：字面文本搜索（适合已知精确关键词）
  返回：包含该短语的原文片段（前后2000字上下文）
  **适用场景**：
    * 搜索专有名词、特定数字、固定术语
    * 用户问题中明确提到某个词，需要找原文
    * 你已经知道文档中的确切表达方式
  **支持OR逻辑**：query可用 | 分隔多个关键词，如 "方程|公式|equation"
  **你可以调整limit**：需要更多结果就增大limit，只需少量结果就减小limit

${keywordSearchTool}
${advancedSearchTools}
${mapFetchTools}

## 智能决策流程

**第一步：分析问题复杂度，选择工具组合策略**

**简单问题（单工具足够）：**
1. 精确实体查找
   - 示例："雷曼公司何时破产？"
   → grep("雷曼|Lehman", limit=5)

${useVectorSearch ? `2. 单一概念解释
   - 示例："什么是注意力机制？"
   → vector_search("注意力机制 原理", limit=8)

` : ''}3. 特定格式查找（编号、日期）
   - 示例："找出公式3.2的内容"
   → regex_search("公式\\\\s*3\\\\.2|式\\\\s*\\\\(3\\\\.2\\\\)", limit=5)
   - 示例："2023年的相关研究"
   → regex_search("2023年", limit=10)

4. 复杂逻辑排除
   - 示例："讨论模型但不涉及训练的内容"
   → boolean_search("模型 NOT (训练 OR train)", limit=8)

**复杂问题（建议多工具并用）：**
${useVectorSearch && useSemanticGroups ? `1. 综合性分析（如"研究背景与意义"）
   - 策略：**并发使用多个工具，全方位检索**
   - 示例："研究背景与意义？"
   → 第1轮并发（推荐加入map获取整体结构）：
     {"operations":[
       {"tool":"vector_search","args":{"query":"研究背景 意义 动机","limit":10}},
       {"tool":"grep","args":{"query":"背景|意义|动机|研究目的","limit":8}},
       {"tool":"map","args":{"limit":30}}
     ],"final":false}
   → 第2轮根据结果决定是否需要fetch关键意群

2. 多维度对比（如"CNN和RNN的区别"）
   - 策略：**搜索两个主体 + 对比关系**
   - 示例："CNN和RNN的区别"
   → {"operations":[
       {"tool":"vector_search","args":{"query":"CNN RNN 区别 对比","limit":12}},
       {"tool":"grep","args":{"query":"CNN|RNN","limit":10}}
     ],"final":false}

3. 历史/因果关系（如"金融危机的原因和影响"）
   - 策略：**语义搜索 + 关键词 + 可能需要map**
   - 示例："金融危机的原因和影响"
   → {"operations":[
       {"tool":"vector_search","args":{"query":"金融危机 原因 影响","limit":12}},
       {"tool":"grep","args":{"query":"危机|原因|影响|导致","limit":8}},
       {"tool":"map","args":{"limit":30}}
     ],"final":false}

4. 整体理解类（如"文档的主要内容"）
   - 策略：**先map看结构，再fetch关键部分**
   - 示例："文档讲了什么？"
   → 第1轮：{"operations":[{"tool":"map","args":{"limit":50}}],"final":false}
   → 第2轮：根据地图fetch重要意群

` : `1. 多关键词搜索
   - 策略：**使用grep进行关键词检索**
   - 示例："研究背景与意义？"
   → {"operations":[
       {"tool":"grep","args":{"query":"背景|意义|动机|研究目的","limit":15}}
     ],"final":false}

2. 特定概念搜索
   - 策略：**使用keyword_search进行BM25搜索**
   - 示例："什么是注意力机制？"
   → {"operations":[
       {"tool":"keyword_search","args":{"keywords":["注意力","机制","attention"],"limit":10}}
     ],"final":false}

`}**工具组合原则：**
- **复杂问题优先多工具并用**（同一轮并发执行）
${useVectorSearch ? `- vector_search（语义）+ grep（精确）= 更高召回率和准确率
${useSemanticGroups ? `- **综合性分析问题（如"研究背景与意义"）强烈建议使用map**：map提供文档整体结构，有助于理解背景脉络
- 多维度问题建议3个工具：vector + grep + map
` : ''}` : `- grep（精确）+ keyword_search（BM25）= 提高召回率
- 多个关键词组合使用，提高搜索准确性
`}- 简单问题可以单工具，但不确定时宁可多用
- **优先级判断**：
  * 有明确格式（日期、编号、公式）→ 首选 regex_search
  * 需要排除干扰词（NOT逻辑）→ 首选 boolean_search
  * 普通精确词匹配 → 使用 grep
  * 语义理解、同义词 → 使用 vector_search
- regex和boolean是**特殊场景工具**，不要过度使用，普通查询用grep/vector即可

${useSemanticGroups ? `**第二步：判断是否需要fetch意群完整内容**
- 搜索工具会返回：chunk内容 + suggestedGroups（所属意群列表）
- 如果chunk片段**已包含足够信息**回答问题 → 不需要fetch，直接final=true
- 如果chunk片段**信息不足**（如缺少公式细节、数据表、完整论述） → fetch相关意群
- **优先精准而非全面**：只fetch真正需要的意群，不要全部fetch

` : ''}**核心原则：提供充分、详细、准确的上下文**
- 你的目标是为最终AI提供**足够回答用户问题的完整上下文**
- 不要因为担心token浪费而过早结束检索
- 宁可多获取一些内容，也不要让最终AI因为信息不足而无法回答
- 【已获取内容】为空时，**绝不能**返回空操作，必须至少执行一次检索

**第三步：控制结果数量，避免噪音**
${useVectorSearch ? `- **优先用vector_search**，概念性问题用limit=10-15，精确查找用limit=5-8
- grep仅用于精确匹配场景，limit=5-10即可
` : `- **优先用grep**，精确匹配场景用limit=10-15
`}- keyword_search作为降级方案，limit=8-10
- 避免一次性返回过多结果造成token浪费
- 如果第一次搜索结果不足，可以增加limit或换工具

${useSemanticGroups ? `**第四步：地图信息的智能使用**
- 【候选意群地图】提供了文档结构概览（如果执行过map工具）
- **你可以根据任务类型自主决定是否需要地图信息辅助回答**：
  * 宏观任务（如"总结主要内容"、"思维导图"）：地图很有用，可直接引用地图结构
  * 微观任务（如"雷曼公司何时破产"）：地图意义不大，依赖具体检索结果
  * 混合/长难任务（如"谁做了什么经历"）：地图可提供流程框架，再用fetch补充细节
- **你的决策方式**：在final=true时，【已获取内容】中包含的信息应该足够最终AI回答
  * 如果认为地图有助于宏观理解，可以确保地图已在【候选意群地图】中（map工具已执行）
  * 如果地图无关紧要，只需确保检索到的chunks/groups足够即可

**第五步：并发与结束**
` : `**第四步：并发与结束**
`}
- 可以在同一轮并发执行多个操作
- 获取到足够内容后立即final=true
- 检查【搜索历史】避免重复搜索
- **只有当【已获取内容】真正充足时**，才返回{"operations":[],"final":true}
- **如果【已获取内容】为空或不足**，必须继续检索，不能直接final=true

## 任务追踪机制（Task Status Tracking）

**多轮检索时使用taskStatus追踪进度**，帮助你在复杂问题中保持目标清晰：

**taskStatus字段说明**（可选，但复杂问题强烈推荐）：
{
  "operations": [...],
  "final": false,
  "taskStatus": {
    "completed": ["✓ 已获取研究背景(vector_search+grep, 找到18个chunks)"],
    "current": "→ 正在获取方法论详细描述",
    "pending": ["待检索实验设计", "待检索结论和展望"]
  }
}

- **completed**: 已完成的检索任务（附工具和结果数）
  * 示例："✓ 已获取研究动机(vector_search, 3个chunks)"
  * 作用：避免重复检索，展示进度

- **current**: 当前正在执行的任务
  * 示例："→ 正在查找公式推导过程"
  * 作用：明确本轮目标

- **pending**: 后续待完成的任务列表
  * 示例：["待补充图表说明", "待验证时间线"]
  * 作用：规划下一步，防止遗漏

**使用场景**：
- **简单问题**（1轮完成）：可省略taskStatus
- **复杂问题**（需多轮）：必须使用taskStatus
  * 第1轮：分解任务到pending，设置current
  * 中间轮：更新completed，调整current和pending
  * 最终轮：所有任务在completed，pending为空

**完整示例：复杂问题的追踪**
问题："分析论文的背景、方法、实验和结论"

第1轮规划：
{"operations":[{"tool":"vector_search","args":{"query":"研究背景 动机","limit":10}}],"final":false,"taskStatus":{"completed":[],"current":"→ 检索研究背景和动机","pending":["待检索方法论","待检索实验","待检索结论"]}}

第2轮规划：
{"operations":[{"tool":"fetch","args":{"groupId":"group-5"}}],"final":false,"taskStatus":{"completed":["✓ 已获取研究背景(vector+grep, 18个chunks)"],"current":"→ 获取方法论详细内容","pending":["待检索实验","待检索结论"]}}

第3轮（完成）：
{"operations":[],"final":true,"taskStatus":{"completed":["✓ 研究背景","✓ 方法论","✓ 实验结果","✓ 结论"],"current":"→ 检索完成","pending":[]}}

## 示例决策

⚠️ **输出示例对比**：
问题："生成思维导图"

❌ 错误输出（直接生成mermaid代码块）：禁止！那是回答问题，不是规划检索。

✓ 正确输出（规划检索+简短说明）：
需要获取文档结构和主要内容，使用map工具。
{"operations":[{"tool":"map","args":{"limit":50}}],"final":false,"includeMapInFinalContext":true}

说明：你只规划"如何检索"，不生成"最终答案"。另一个AI会用检索结果生成mermaid。

---

示例1（复杂综合问题，多工具并用）：
问题："研究背景与意义？"
→ {"operations":[
     {"tool":"vector_search","args":{"query":"研究背景 意义 动机","limit":10}},
     {"tool":"grep","args":{"query":"背景|意义|动机|研究目的","limit":8}}
   ],"final":false}
→ 返回vector: 8个语义相关chunk + grep: 5个精确匹配chunk
→ 两者互补，语义覆盖+精确补充
→ {"operations":[{"tool":"fetch","args":{"groupId":"group-1"}}],"final":true}

示例2（对比分析，多工具）：
问题："CNN和RNN的区别"
→ {"operations":[
     {"tool":"vector_search","args":{"query":"CNN RNN 区别 对比","limit":12}},
     {"tool":"grep","args":{"query":"CNN|RNN","limit":10}}
   ],"final":false}
→ vector找语义关系，grep确保两个主体都覆盖
→ chunk足够，{"operations":[],"final":true}

示例3（简单精确查找，单工具足够）：
问题："雷曼公司何时破产"
→ {"operations":[{"tool":"grep","args":{"query":"雷曼|Lehman","limit":5}}],"final":true}
→ 返回3个chunk，包含"2008年9月15日申请破产"
→ 单工具足够

示例4（查找特定格式内容，使用正则）：
问题："找出文中所有的公式编号"
→ {"operations":[{"tool":"regex_search","args":{"pattern":"公式\\\\s*\\\\d+\\\\.\\\\d+|式\\\\s*\\\\(\\\\d+\\\\)","limit":20}}],"final":true}
→ 正则匹配"公式3.2"、"式(15)"等格式
→ 比grep更精确，避免误匹配

示例5（复杂逻辑查询，使用布尔搜索）：
问题："提到CNN但不涉及图像的内容"
→ {"operations":[{"tool":"boolean_search","args":{"query":"CNN AND (网络 OR 模型) NOT (图像 OR 视觉)","limit":10}}],"final":false}
→ 找到讨论CNN网络结构但不涉及图像应用的段落
→ 比单独用grep的OR更精确

示例6（查找日期或时间信息，用正则）：
问题："论文发表时间"
→ {"operations":[
     {"tool":"regex_search","args":{"pattern":"\\\\d{4}年|\\\\d{4}-\\\\d{2}|20\\\\d{2}","limit":10}},
     {"tool":"grep","args":{"query":"发表|出版|published","limit":5}}
   ],"final":true}
→ 正则找日期格式 + grep找相关词汇

示例7（宏观理解，map+fetch）：
问题："生成思维导图"
→ {"operations":[{"tool":"map","args":{"limit":50}}],"final":false}
→ 获取意群地图
→ {"operations":[
     {"tool":"fetch","args":{"groupId":"group-1"}},
     {"tool":"fetch","args":{"groupId":"group-5"}},
     {"tool":"fetch","args":{"groupId":"group-10"}}
   ],"final":true,"includeMapInFinalContext":true}
→ fetch关键意群 + 包含地图

## 限制与原则
- 每轮最多5个操作
- **复杂问题优先多工具并用**（在同一轮operations数组中并发执行）
- vector_search擅长语义理解，grep擅长精确匹配，**两者结合效果最佳**
- 简单精确查找可以只用grep，但综合性/分析性问题**必须多工具**
- 搜索limit不要超过20（避免噪音）
- 只fetch真正需要的意群（2-5个为宜）
- 优先chunk片段，确实不足才fetch意群

## 返回格式要求（严格遵守）

⚠️ **你只能返回JSON格式的检索计划，但可以在JSON前后添加简短说明**

**允许的输出格式**：
1. 纯JSON（推荐）
2. 简短说明 + JSON（可选，用于解释检索策略）
   例如："需要获取研究背景信息，使用向量搜索和关键词检索。\n{...JSON...}"

**禁止输出的内容**：
  * ❌ mermaid图表、思维导图代码
  * ❌ 对用户问题的直接回答（如"该研究的背景是..."）
  * ❌ 详细的论述或分析
  * ✓ 可以：简短的检索策略说明（1-2句话）

**正确格式**：
{
  "operations": [...],
  "final": true/false,
  "taskStatus": {  // 可选，复杂问题建议使用
    "completed": ["已完成的任务..."],
    "current": "当前任务",
    "pending": ["待做任务..."]
  },
  "includeMapInFinalContext": true/false,
  "includeGroupListInFinalContext": true/false
}

**给最终AI的上下文自主控制**（可选字段，默认false）：
- **includeMapInFinalContext**: 是否包含完整地图结构
  * 宏观任务（思维导图、总结全文）→ true
  * 微观任务（查找具体事实）→ false

- **includeGroupListInFinalContext**: 是否包含所有意群的简要列表（ID+字数+摘要）
  * 需要全局视角但不需要详细地图 → true
  * 只需要精确检索结果 → false

- **你fetch的意群**: 会自动包含在最终上下文中（full/digest粒度）

**灵活组合示例**：
- 微观查询："公式7是什么" → fetch(group-5) + 无地图无列表
- 宏观总结："生成思维导图" → map + includeMapInFinalContext:true + includeGroupListInFinalContext:true
- 混合任务："分析影响因素" → 搜索 + fetch若干意群 + includeGroupListInFinalContext:true（提供背景）

示例JSON：
- 示例1（继续检索，带任务追踪）：
  {"operations":[{"tool":"fetch","args":{"groupId":"group-1"}}],"final":false,"taskStatus":{"completed":["✓ 已搜索背景"],"current":"→ 获取方法论","pending":["待查实验"]}}
- 示例2（完成，仅fetch内容）：
  {"operations":[],"final":true}
- 示例3（完成，需要地图+列表）：
  {"operations":[],"final":true,"includeMapInFinalContext":true,"includeGroupListInFinalContext":true}
- 示例4（完成，带任务总结）：
  {"operations":[],"final":true,"taskStatus":{"completed":["✓ 背景","✓ 方法","✓ 实验","✓ 结论"],"current":"→ 完成","pending":[]}}

**taskStatus字段说明**（详见上方"任务追踪机制"章节）`;

        // 构建任务状态提示文本
        let taskStatusText = '';
        if (round > 0 && (taskStatusHistory.completed.length > 0 || taskStatusHistory.current || taskStatusHistory.pending.length > 0)) {
          const parts = [];
          if (taskStatusHistory.completed.length > 0) {
            parts.push(`已完成: ${taskStatusHistory.completed.join('; ')}`);
          }
          if (taskStatusHistory.current) {
            parts.push(`上轮任务: ${taskStatusHistory.current}`);
          }
          if (taskStatusHistory.pending.length > 0) {
            parts.push(`待完成: ${taskStatusHistory.pending.join('; ')}`);
          }
          taskStatusText = '\n\n【任务追踪状态】\n' + parts.join('\n');
        }

        let content = `文档总览:\n${gist}\n\n用户问题:\n${String(userQuestion || '')}${searchHistoryText}${taskStatusText}\n\n${listText ? '【候选意群地图】：\n' + listText + '\n\n' : ''}【已获取内容】：\n${fetchedSummary}`;

        // 调用LLM规划（支持重试）
        yield {
          type: 'status',
          phase: 'planning',
          round,
          message: 'LLM规划中...'
        };

        const apiKey = config.apiKey;
        let plannerOutput = null;
        let retryCount = 0;
        const maxRetries = 2; // 最多重试2次
        let parseSuccess = false;
        let plan = null;

        // 重试循环：如果JSON解析失败，给AI反馈并重试
        while (!parseSuccess && retryCount <= maxRetries) {
          if (retryCount > 0) {
            yield {
              type: 'info',
              message: `JSON格式错误，正在重试 (${retryCount}/${maxRetries})...`
            };
          }

          plannerOutput = await window.ChatbotCore.singleChunkSummary(sys, content, config, apiKey);

          // 统计规划器token使用
          const plannerInputTokens = estimateTokens(sys) + estimateTokens(content);
          const plannerOutputTokens = estimateTokens(plannerOutput);
          const plannerTotalTokens = plannerInputTokens + plannerOutputTokens;

          yield {
            type: 'token_usage',
            phase: 'planner',
            round,
            tokens: {
              input: plannerInputTokens,
              output: plannerOutputTokens,
              total: plannerTotalTokens
            }
          };

          // 尝试解析计划
          try {
          let cleaned = plannerOutput
            .replace(/```jsonc?|```tool|```/gi,'')
            .replace(/[\u0000-\u001f]/g, ' ')
            .trim();

          if (!cleaned) {
            yield { type: 'warning', message: '规划输出为空，使用后备策略' };
            break;
          }

          // 如果输出不是JSON（以中文或非{开头），尝试提取JSON
          if (!cleaned.startsWith('{') && !cleaned.startsWith('[')) {
            // 尝试提取JSON块
            const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              cleaned = jsonMatch[0];
              console.log('[streamingMultiHop] 从文本中提取JSON:', cleaned.substring(0, 100));
            } else {
              // 尝试从文本中提取operations和final信息
              console.log('[streamingMultiHop] 尝试从自然语言提取结构:', cleaned.substring(0, 200));

              // 检查是否明确表达"已完成"、"足够"等含义
              if (cleaned.match(/已.*足够|无需.*操作|不需要.*继续|已经.*完成|内容.*充足/i)) {
                plan = { operations: [], final: true };
                console.log('[streamingMultiHop] 识别为完成信号，设置final=true');
              } else {
                // 完全没有JSON且无法解析，返回空操作+final
                console.warn('[streamingMultiHop] LLM输出非JSON格式，自动结束:', cleaned.substring(0, 100));
                yield {
                  type: 'warning',
                  message: `第 ${round + 1} 轮LLM返回非JSON格式，已获取 ${fetched.size} 个意群，使用已有内容`
                };
                break;
              }
            }
          }

          if (!plan) {
            try {
              plan = JSON.parse(cleaned);
            } catch (parseErr) {
              // 尝试各种清理策略
              let normalized = cleaned
                // 移除所有控制字符和特殊空白
                .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
                // 修复中文引号
                .replace(/[""]/g, '"')
                .replace(/['']/g, "'")
                // 修复JSON中的常见错误
                .replace(/"(\w+)"\s*:\s*'([^']*)'/g, '"$1":"$2"') // 单引号改双引号
                .replace(/(\w+):/g, '"$1":') // 无引号键名加引号
                .replace(/,\s*}/g, '}') // 移除对象尾随逗号
                .replace(/,\s*]/g, ']') // 移除数组尾随逗号
                // 修复 ," "final": 这种错误
                .replace(/,\s*"\s+"(\w+)"\s*:/g, ',"$1":')
                // 修复 "operations" " 这种空格
                .replace(/"(\w+)"\s+"/g, '"$1":')
                // 修复键名周围的多余空格
                .replace(/"\s+([\w-]+)"\s*:/g, '"$1":')
                // 修复值周围的多余空格
                .replace(/:\s*"\s+/g, ':"')
                .replace(/\s+"/g, '"')
                // 修复final前的空格
                .replace(/"\s*final\s*"/gi, '"final"')
                // 修复operations
                .replace(/"operations"\s*"/i, '"operations":')
                // 移除注释
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/\/\/.*/g, '')
                // 压缩空格
                .replace(/\s+/g, ' ')
                .trim();

              console.log('[streamingMultiHop] 清理后的JSON:', normalized.substring(0, 200));
              plan = JSON.parse(normalized);
            }
          }

          yield {
            type: 'plan',
            round,
            data: {
              operations: plan.operations || [],
              final: plan.final,
              taskStatus: plan.taskStatus || null  // 传递任务状态
            }
          };

          // 捕获AI的任务状态更新
          if (plan.taskStatus) {
            // 更新任务追踪历史
            if (Array.isArray(plan.taskStatus.completed)) {
              taskStatusHistory.completed = plan.taskStatus.completed;
            }
            if (typeof plan.taskStatus.current === 'string') {
              taskStatusHistory.current = plan.taskStatus.current;
            }
            if (Array.isArray(plan.taskStatus.pending)) {
              taskStatusHistory.pending = plan.taskStatus.pending;
            }

            // 输出任务状态到UI
            yield {
              type: 'task_status',
              round,
              status: {
                completed: taskStatusHistory.completed,
                current: taskStatusHistory.current,
                pending: taskStatusHistory.pending
              }
            };

            console.log('[StreamingMultiHop] 任务状态更新:', taskStatusHistory);
          }

          // 捕获AI关于地图包含的决策
          if (plan.includeMapInFinalContext === true) {
            aiRequestedMapInFinalContext = true;
            console.log('[StreamingMultiHop] AI请求在最终上下文中包含地图概览');
          }

          // 捕获AI关于意群列表包含的决策
          if (plan.includeGroupListInFinalContext === true) {
            aiRequestedGroupListInFinalContext = true;
            console.log('[StreamingMultiHop] AI请求在最终上下文中包含意群简要列表');
          }

          parseSuccess = true; // 成功解析，退出重试循环
        } catch (e) {
          console.error('[streamingMultiHop] 解析计划失败:', e.message);
          console.error('[streamingMultiHop] LLM原始输出:', plannerOutput);

          retryCount++;

          if (retryCount <= maxRetries) {
            // 还有重试机会，构造错误提示
            const errorFeedback = `\n\n【上次输出解析失败】\n错误信息: ${e.message}\n你的输出: ${plannerOutput.substring(0, 300)}\n\n请注意：\n1. 必须输出严格的JSON格式\n2. 字符串中的特殊字符需要转义（如 $ 应写成 \\$ 或避免使用）\n3. 不要在JSON字符串值中使用 | $ \\ 等特殊字符，或使用中文替代\n4. 示例正确格式：{"operations":[{"tool":"grep","args":{"query":"公式 模型 回归","limit":10}}],"final":false}\n\n请重新输出正确的JSON：`;
            content = content + errorFeedback;
            console.log(`[streamingMultiHop] 准备第 ${retryCount} 次重试，已添加错误提示`);
          } else {
            // 重试耗尽，执行原有的fallback逻辑
            yield {
              type: 'error',
              phase: 'parse_plan',
              message: `解析计划失败（已重试${maxRetries}次）: ${e.message}`,
              raw: plannerOutput
            };

            // 如果已经获取到内容，直接使用，不要丢弃
            if (fetched.size > 0) {
              yield {
                type: 'warning',
                message: `第 ${round + 1} 轮规划失败，但已获取 ${fetched.size} 个意群，使用已有内容`
              };
              break; // 结束for循环，使用已fetch的内容
            }

            // 只有在完全没有内容时才使用后备策略
            const fallback = buildFallbackSemanticContext(userQuestion, groups);
            if (fallback) {
              yield {
                type: 'fallback',
                reason: 'parse-error',
                context: fallback.context
              };
              return fallback;
            }
            break; // 结束for循环
          }
        }
        } // 结束重试while循环

        // 如果重试循环结束但没有成功解析，跳过这一轮
        if (!parseSuccess) {
          console.log('[streamingMultiHop] 解析失败且已耗尽重试次数，跳过本轮');
          continue; // 继续下一轮round
        }

        const ops = Array.isArray(plan.operations) ? plan.operations : [];

        // 如果operations为空但已有内容，说明AI认为当前内容已足够
        if (ops.length === 0) {
          if (fetched.size > 0) {
            yield {
              type: 'info',
              message: `AI判断已有 ${fetched.size} 个意群的内容足够回答问题，结束取材`
            };
            break; // 直接使用已有内容，不触发fallback
          }

          // 只有在完全没有内容时才使用后备策略
          yield { type: 'warning', message: '规划无操作且无已获取内容，使用后备策略' };
          const fallback = buildFallbackSemanticContext(userQuestion, groups);
          if (fallback) {
            yield {
              type: 'fallback',
              reason: 'empty-ops',
              context: fallback.context
            };
            return fallback;
          }
          break;
        }

        // 3. 执行工具
        for (const [opIndex, op] of ops.entries()) {
          yield {
            type: 'tool_start',
            round,
            opIndex,
            tool: op.tool,
            args: op.args
          };

          try {
            // 检查文档配置
            const docId = (window.data && window.data.currentPdfName) || 'unknown';
            const docConfig = window.data?.multiHopConfig?.[docId];
            const useSemanticGroups = docConfig?.useSemanticGroups !== false;
            const useVectorSearch = docConfig?.useVectorSearch !== false;

            if (op.tool === 'vector_search' && op.args) {
              if (!useVectorSearch) {
                throw new Error('向量搜索功能已禁用，vector_search不可用');
              }

              // 向量语义搜索chunks
              const query = String(op.args.query || userQuestion);
              const limit = Math.min(Number(op.args.limit) || 15, 30);

              if (window.SemanticVectorSearch && window.EmbeddingClient?.config?.enabled) {
                // 获取enrichedChunks
                const chunks = window.data?.enrichedChunks || [];
                const res = await window.SemanticVectorSearch.search(query, chunks, {
                  topK: limit,
                  threshold: 0.3
                });

                // 记录搜索结果（包括无结果的情况）
                const resultCount = (Array.isArray(res) && res.length) ? res.length : 0;
                searchHistory.push({ tool: 'vector_search', query, resultCount });

                if (resultCount > 0) {
                  // 只添加搜索到的chunks完整文本，不自动fetch意群
                  res.forEach((r, idx) => {
                    const chunkText = r.text || '';
                    if (chunkText) {
                      contextParts.push(`【向量搜索片段${idx + 1}】(chunk-${r.chunkId}, 来自${r.belongsToGroup}, 相似度${r.score.toFixed(3)})\n${chunkText}`);
                    }
                  });

                  // 提取所属意群信息，供AI判断
                  const groupIds = new Set();
                  res.forEach(r => {
                    if (r.belongsToGroup) {
                      groupIds.add(r.belongsToGroup);
                      interestedGroups.add(r.belongsToGroup); // 标记AI感兴趣的意群
                    }
                  });

                  console.log(`[StreamingMultiHop] 向量搜索命中 ${resultCount} 个chunks，所属意群: [${Array.from(groupIds).join(', ')}]`);

                  // 计算返回内容的token数
                  const returnedText = res.map(r => r.text).join('\n');
                  const contentTokens = estimateTokens(returnedText);

                  yield {
                    type: 'tool_result',
                    round,
                    opIndex,
                    tool: 'vector_search',
                    result: res.map(r => ({
                      chunkId: r.chunkId,
                      belongsToGroup: r.belongsToGroup,
                      score: r.score,
                      preview: r.text.substring(0, 500)
                    })),
                    suggestedGroups: Array.from(groupIds), // 提示AI可以fetch这些意群
                    tokens: contentTokens // 返回内容的token数
                  };
                } else {
                  // 明确返回空结果，便于UI闭环
                  yield {
                    type: 'tool_result',
                    round,
                    opIndex,
                    tool: 'vector_search',
                    result: []
                  };
                }
              }

            } else if (op.tool === 'keyword_search' && op.args) {
              // 关键词精确匹配
              const keywords = Array.isArray(op.args.keywords) ? op.args.keywords : [String(op.args.keywords || '')];
              const limit = Math.min(Number(op.args.limit) || 8, 30);

              if (window.SemanticBM25Search) {
                // 使用BM25进行关键词搜索chunks（不做n-gram拆分）
                const chunks = window.data?.enrichedChunks || [];
                const res = window.SemanticBM25Search.searchChunksKeywords(keywords, chunks, {
                  topK: limit,
                  threshold: 0.0
                });

                // 记录搜索结果（包括无结果的情况）
                const resultCount = (Array.isArray(res) && res.length) ? res.length : 0;
                searchHistory.push({ tool: 'keyword_search', query: keywords.join(','), resultCount });

                if (resultCount > 0) {
                  // 只添加搜索到的chunks完整文本，不自动fetch意群
                  res.forEach((r, idx) => {
                    const chunkText = r.text || '';
                    if (chunkText) {
                      const matched = keywords.filter(kw => chunkText.includes(kw)).join(', ');
                      contextParts.push(`【关键词搜索片段${idx + 1}】(chunk-${r.chunkId}, 来自${r.belongsToGroup}, 匹配词: ${matched})\n${chunkText}`);
                    }
                  });

                  // 提取所属意群信息，供AI判断
                  const groupIds = new Set();
                  res.forEach(r => {
                    if (r.belongsToGroup) {
                      groupIds.add(r.belongsToGroup);
                      interestedGroups.add(r.belongsToGroup); // 标记AI感兴趣的意群
                    }
                  });

                  console.log(`[StreamingMultiHop] 关键词搜索命中 ${resultCount} 个chunks，所属意群: [${Array.from(groupIds).join(', ')}]`);

                  // 计算返回内容的token数
                  const returnedText = res.map(r => r.text).join('\n');
                  const contentTokens = estimateTokens(returnedText);

                  yield {
                    type: 'tool_result',
                    round,
                    opIndex,
                    tool: 'keyword_search',
                    result: res.map(r => ({
                      chunkId: r.chunkId,
                      belongsToGroup: r.belongsToGroup,
                      preview: r.text.substring(0, 500),
                      matchedKeywords: keywords.filter(kw => r.text.includes(kw))
                    })),
                    suggestedGroups: Array.from(groupIds), // 提示AI可以fetch这些意群
                    tokens: contentTokens
                  };
                } else {
                  // 明确返回空结果，便于UI闭环
                  yield {
                    type: 'tool_result',
                    round,
                    opIndex,
                    tool: 'keyword_search',
                    result: []
                  };
                }
              }

            } else if ((op.tool === 'fetch' || op.tool === 'fetch_group') && op.args) {
              if (!useSemanticGroups) {
                throw new Error('意群功能已禁用，fetch不可用');
              }

              const id = op.args.groupId;
              const gran = (op.args.granularity || (op.tool === 'fetch' ? 'full' : 'digest'));

              interestedGroups.add(id); // 标记AI感兴趣的意群

              const existing = fetched.get(id);

              // 如果已经有了，检查是否需要升级
              if (existing) {
                const needUpgrade = (existing.granularity === 'summary' && gran !== 'summary') ||
                                   (existing.granularity === 'digest' && gran === 'full');

                if (needUpgrade) {
                  // 需要升级，执行fetch（优先详细接口）
                  let res = null;
                  if (op.tool === 'fetch' && typeof window.SemanticTools?.fetchGroupDetailed === 'function') {
                    res = window.SemanticTools.fetchGroupDetailed(id);
                  } else if (typeof window.SemanticTools?.fetchGroupText === 'function') {
                    res = window.SemanticTools.fetchGroupText(id, gran);
                  }
                  if (res && res.text) {
                    fetched.set(id, { granularity: res.granularity, text: res.text });

                    const idx = detail.findIndex(d => d.groupId === id);
                    if (idx >= 0) detail[idx].granularity = res.granularity;

                    const ctxIdx = contextParts.findIndex(c => c.startsWith(`【${id}`));
                    if (ctxIdx >= 0) {
                      contextParts[ctxIdx] = `【${id} - ${res.granularity}】\n${res.text}`;
                    }

                    yield {
                      type: 'tool_result',
                      round,
                      opIndex,
                      tool: op.tool,
                      result: {
                        groupId: id,
                        granularity: res.granularity,
                        preview: res.text.slice(0, 200),
                        action: 'upgraded'
                      },
                      tokens: estimateTokens(res.text)
                    };
                  }
                } else {
                  // 已有更高级别的，跳过
                  yield {
                    type: 'tool_skip',
                    round,
                    opIndex,
                    tool: op.tool,
                    reason: existing.granularity === gran ? 'already_fetched' : 'higher_granularity_exists',
                    groupId: id,
                    existingGranularity: existing.granularity
                  };
                }
              } else {
                // 不存在，执行fetch
                let res = null;
                if (op.tool === 'fetch' && typeof window.SemanticTools?.fetchGroupDetailed === 'function') {
                  res = window.SemanticTools.fetchGroupDetailed(id);
                } else if (typeof window.SemanticTools?.fetchGroupText === 'function') {
                  res = window.SemanticTools.fetchGroupText(id, gran);
                }

                if (res && res.text) {
                  fetched.set(id, { granularity: res.granularity, text: res.text });
                  detail.push({ groupId: id, granularity: res.granularity });
                  contextParts.push(`【${id} - ${res.granularity}】\n${res.text}`);

                  yield {
                    type: 'tool_result',
                    round,
                    opIndex,
                    tool: op.tool,
                    result: {
                      groupId: id,
                      granularity: res.granularity,
                      preview: res.text.slice(0, 200)
                    },
                    tokens: estimateTokens(res.text)
                  };
                }
              }
            } else if (op.tool === 'map') {
              if (!useSemanticGroups) {
                throw new Error('意群功能已禁用，map不可用');
              }

              // 生成候选意群地图（结构+摘要）
              const limit = Math.min(Number(op.args?.limit) || 50, candidates.length);
              const includeStructure = op.args?.includeStructure !== false;
              const items = candidates.slice(0, limit).map(g => {
                const struct = g.structure || {};
                const parts = [`【${g.groupId}】 ${g.charCount || 0}字`];
                if (includeStructure && struct.orderedElements && struct.orderedElements.length > 0) {
                  const typeIcons = { 'title': '📌', 'section': '▸', 'keypoint': '•', 'figure': '🖼', 'table': '📊', 'formula': '📐' };
                  struct.orderedElements.forEach(elem => {
                    const icon = typeIcons[elem.type] || '-';
                    parts.push(`  ${icon} ${elem.content}`);
                  });
                } else {
                  if (g.keywords && g.keywords.length > 0) parts.push(`关键词: ${g.keywords.join('、')}`);
                  const s = g.structure || {};
                  if (s.sections && s.sections.length > 0) parts.push(`章节: ${s.sections.join('; ')}`);
                  if (s.keyPoints && s.keyPoints.length > 0) parts.push(`要点: ${s.keyPoints.join('; ')}`);
                }
                if (g.summary) parts.push(`摘要: ${g.summary}`);
                return parts.join('\n');
              });
              const mapText = items.join('\n\n');
              window._multiHopLastMapText = mapText; // 供下一轮规划使用

              // 记录已生成地图（用于最终汇总时判断是否需要包含地图）
              window._multiHopHasMap = true;
              window._multiHopMapSummary = {
                text: mapText,
                count: items.length,
                includeStructure: includeStructure
              };

              // 自动策略：AI主动调用map工具，说明需要地图信息，自动包含到最终上下文
              aiRequestedMapInFinalContext = true;
              console.log('[StreamingMultiHop] AI调用map工具，自动将地图包含到最终上下文');

              yield {
                type: 'tool_result',
                round,
                opIndex,
                tool: 'map',
                result: { count: items.length },
                tokens: estimateTokens(mapText)
              };
            } else if (op.tool === 'grep' && op.args) {
              // 传统文本搜索，支持多关键词OR查询（用|分隔）
              const q = String(op.args.query || '').trim();
              const limit = Math.min(Number(op.args.limit) || 20, 100);
              const ctxChars = Math.min(Number(op.args.context) || 2000, 4000); // 默认提升到2000字符
              const caseInsensitive = !!op.args.caseInsensitive;
              const chunks = window.data?.enrichedChunks || [];
              const hits = [];

              if (q) {
                // 支持OR逻辑：将 "方程|公式|k-ε" 拆分为多个关键词
                const keywords = q.includes('|') ? q.split('|').map(k => k.trim()).filter(k => k) : [q];
                console.log(`[StreamingMultiHop] GREP搜索关键词: [${keywords.join(', ')}]`);

                // 1) 整篇文档
                const docText = String(docContentInfo.translation || docContentInfo.ocr || '');
                if (docText) {
                  const hay = caseInsensitive ? docText.toLowerCase() : docText;

                  for (const keyword of keywords) {
                    const needle = caseInsensitive ? keyword.toLowerCase() : keyword;
                    let from = 0;
                    while (from < hay.length) {
                      const pos = hay.indexOf(needle, from);
                      if (pos < 0) break;
                      const end = pos + keyword.length;
                      const s = Math.max(0, pos - ctxChars);
                      const e = Math.min(docText.length, end + ctxChars);
                      const snippet = docText.slice(s, e);
                      hits.push({
                        preview: snippet,
                        matchOffset: pos,
                        matchLength: keyword.length,
                        matchedKeyword: keyword  // 记录匹配的关键词
                      });
                      from = end;
                      if (hits.length >= limit) break;
                    }
                    if (hits.length >= limit) break;
                  }
                }

                // 2) chunks 级（补充）
                if (hits.length < limit && Array.isArray(chunks) && chunks.length > 0) {
                  for (const keyword of keywords) {
                    const needle = caseInsensitive ? keyword.toLowerCase() : keyword;
                    for (const chunk of chunks) {
                      const text = String(chunk.text || '');
                      if (!text) continue;
                      const hay = caseInsensitive ? text.toLowerCase() : text;
                      const pos = hay.indexOf(needle);
                      if (pos >= 0) {
                        const end = pos + keyword.length;
                        const s = Math.max(0, pos - ctxChars);
                        const e = Math.min(text.length, end + ctxChars);
                        const snippet = text.slice(s, e);
                        hits.push({
                          chunkId: chunk.chunkId,
                          belongsToGroup: chunk.belongsToGroup,
                          preview: snippet,
                          matchOffset: pos,
                          matchLength: keyword.length,
                          matchedKeyword: keyword
                        });
                        if (hits.length >= limit) break;
                      }
                    }
                    if (hits.length >= limit) break;
                  }
                }
              }

              if (hits.length > 0) {
                // 添加grep搜索到的片段（精确匹配的上下文）
                console.log(`[StreamingMultiHop] GREP命中 ${hits.length} 个片段，准备添加到contextParts`);
                hits.forEach((h, idx) => {
                  const src = h.belongsToGroup ? `chunk-${h.chunkId}, 来自${h.belongsToGroup}` : '全文';
                  const contextItem = `【GREP片段${idx + 1}】(${src})\n${h.preview}`;
                  contextParts.push(contextItem);
                  console.log(`[StreamingMultiHop] 添加GREP片段${idx + 1}，长度: ${contextItem.length}字符`);
                });

                // 提取所属意群信息，供AI判断
                const groupIds = new Set();
                hits.forEach(h => {
                  if (h.belongsToGroup) {
                    groupIds.add(h.belongsToGroup);
                    interestedGroups.add(h.belongsToGroup); // 标记AI感兴趣的意群
                  }
                });

                if (groupIds.size > 0) {
                  console.log(`[StreamingMultiHop] GREP搜索命中 ${hits.length} 个片段，所属意群: [${Array.from(groupIds).join(', ')}]`);
                } else {
                  console.log(`[StreamingMultiHop] GREP搜索命中 ${hits.length} 个片段（来自全文，无所属意群）`);
                }
              } else {
                console.log(`[StreamingMultiHop] GREP搜索"${q}"无结果`);
              }

              // 记录搜索结果（包括无结果的情况）
              searchHistory.push({ tool: 'grep', query: q, resultCount: hits.length });

              const groupIds = new Set();
              hits.forEach(h => { if (h.belongsToGroup) groupIds.add(h.belongsToGroup); });

              // 计算返回内容的token数
              const returnedText = hits.map(h => h.preview).join('\n');
              const contentTokens = estimateTokens(returnedText);

              yield {
                type: 'tool_result',
                round,
                opIndex,
                tool: 'grep',
                result: hits.map(h => ({
                  preview: h.preview.substring(0, 500),
                  belongsToGroup: h.belongsToGroup,
                  chunkId: h.chunkId
                })),
                suggestedGroups: Array.from(groupIds), // 提示AI可以fetch这些意群
                tokens: contentTokens
              };
            } else if (op.tool === 'regex_search' && op.args) {
              // 正则表达式搜索
              if (!window.AdvancedSearchTools) {
                throw new Error('AdvancedSearchTools 模块未加载');
              }

              const pattern = String(op.args.pattern || '');
              const limit = Math.min(Number(op.args.limit) || 10, 50);
              const ctxChars = Math.min(Number(op.args.context) || 1500, 4000);
              const caseInsensitive = op.args.caseInsensitive !== false;

              const docText = String(docContentInfo.translation || docContentInfo.ocr || '');
              const chunks = window.data?.enrichedChunks || [];

              if (!docText && chunks.length === 0) {
                throw new Error('没有可搜索的文本内容');
              }

              try {
                const results = window.AdvancedSearchTools.regexSearch(
                  pattern,
                  docText,
                  { limit, context: ctxChars, caseInsensitive }
                );

                if (results.length > 0) {
                  // 添加正则搜索结果到上下文
                  results.forEach((r, idx) => {
                    contextParts.push(`【正则搜索片段${idx + 1}】(匹配: "${r.match}")\n${r.preview}`);
                  });

                  // 尝试关联到chunks和意群
                  const groupIds = new Set();
                  results.forEach(r => {
                    // 查找包含此匹配的chunk
                    const matchingChunk = chunks.find(chunk =>
                      chunk.text && chunk.text.includes(r.match)
                    );
                    if (matchingChunk?.belongsToGroup) {
                      groupIds.add(matchingChunk.belongsToGroup);
                      interestedGroups.add(matchingChunk.belongsToGroup);
                    }
                  });

                  console.log(`[StreamingMultiHop] 正则搜索命中 ${results.length} 个片段`);

                  const returnedText = results.map(r => r.preview).join('\n');
                  const contentTokens = estimateTokens(returnedText);

                  yield {
                    type: 'tool_result',
                    round,
                    opIndex,
                    tool: 'regex_search',
                    result: results.map(r => ({
                      match: r.match,
                      preview: r.preview.substring(0, 500),
                      groups: r.groups
                    })),
                    suggestedGroups: Array.from(groupIds),
                    tokens: contentTokens
                  };
                } else {
                  yield {
                    type: 'tool_result',
                    round,
                    opIndex,
                    tool: 'regex_search',
                    result: []
                  };
                }
              } catch (regexError) {
                throw new Error(`正则表达式错误: ${regexError.message}`);
              }

              // 记录搜索历史
              searchHistory.push({ tool: 'regex_search', query: pattern, resultCount: results.length || 0 });

            } else if (op.tool === 'boolean_search' && op.args) {
              // 布尔逻辑搜索
              if (!window.AdvancedSearchTools) {
                throw new Error('AdvancedSearchTools 模块未加载');
              }

              const query = String(op.args.query || '');
              const limit = Math.min(Number(op.args.limit) || 10, 50);
              const ctxChars = Math.min(Number(op.args.context) || 1500, 4000);
              const caseInsensitive = op.args.caseInsensitive !== false;

              const docText = String(docContentInfo.translation || docContentInfo.ocr || '');
              const chunks = window.data?.enrichedChunks || [];

              if (!docText && chunks.length === 0) {
                throw new Error('没有可搜索的文本内容');
              }

              try {
                const results = window.AdvancedSearchTools.booleanSearch(
                  query,
                  docText,
                  { limit, context: ctxChars, caseInsensitive }
                );

                if (results.length > 0) {
                  // 添加布尔搜索结果到上下文
                  results.forEach((r, idx) => {
                    const terms = r.matchedTerms.join(', ');
                    contextParts.push(`【布尔搜索片段${idx + 1}】(匹配词: ${terms}, 相关度: ${r.relevanceScore})\n${r.preview}`);
                  });

                  // 尝试关联到chunks和意群
                  const groupIds = new Set();
                  results.forEach(r => {
                    const matchingChunk = chunks.find(chunk =>
                      chunk.text && r.matchedTerms.some(term => chunk.text.includes(term))
                    );
                    if (matchingChunk?.belongsToGroup) {
                      groupIds.add(matchingChunk.belongsToGroup);
                      interestedGroups.add(matchingChunk.belongsToGroup);
                    }
                  });

                  console.log(`[StreamingMultiHop] 布尔搜索命中 ${results.length} 个片段`);

                  const returnedText = results.map(r => r.preview).join('\n');
                  const contentTokens = estimateTokens(returnedText);

                  yield {
                    type: 'tool_result',
                    round,
                    opIndex,
                    tool: 'boolean_search',
                    result: results.map(r => ({
                      preview: r.preview.substring(0, 500),
                      matchedTerms: r.matchedTerms,
                      relevanceScore: r.relevanceScore
                    })),
                    suggestedGroups: Array.from(groupIds),
                    tokens: contentTokens
                  };
                } else {
                  yield {
                    type: 'tool_result',
                    round,
                    opIndex,
                    tool: 'boolean_search',
                    result: []
                  };
                }
              } catch (boolError) {
                throw new Error(`布尔查询错误: ${boolError.message}`);
              }

              // 记录搜索历史
              searchHistory.push({ tool: 'boolean_search', query, resultCount: results.length || 0 });
            }

          } catch (toolError) {
            yield {
              type: 'tool_error',
              round,
              opIndex,
              tool: op.tool,
              error: toolError.message
            };
          }
        }

        // 第一轮结束后，清理不相关的预加载内容
        // 保护机制：
        // 1. 只有当找到足够多（>=3）的感兴趣意群时才清理，避免在"大海捞针"场景中误删
        // 2. 如果第一轮没有进行任何搜索，不清理（可能AI还在探索阶段）
        const hasSearch = searchHistory.some(h => h.tool === 'vector_search' || h.tool === 'keyword_search' || h.tool === 'grep');
        console.log(`[StreamingMultiHop] 第${round + 1}轮结束，hasSearch=${hasSearch}, interestedGroups.size=${interestedGroups.size}, contextParts.length=${contextParts.length}`);

        if (round === 0 && preloadedInFirstRound && interestedGroups.size >= 3 && hasSearch) {
          // 清理fetched：只保留AI感兴趣的意群
          for (const [groupId] of fetched.entries()) {
            if (!interestedGroups.has(groupId)) {
              fetched.delete(groupId);
            }
          }

          // 清理detail：只保留AI感兴趣的意群
          const filteredDetail = detail.filter(d => interestedGroups.has(d.groupId));
          detail.length = 0;
          detail.push(...filteredDetail);

          // 清理contextParts：只保留搜索片段和AI感兴趣的意群
          const filteredContextParts = contextParts.filter(part => {
            // 保留搜索片段
            if (part.startsWith('【向量搜索片段') ||
                part.startsWith('【关键词搜索片段') ||
                part.startsWith('【GREP片段') ||
                part.startsWith('【正则搜索片段') ||
                part.startsWith('【布尔搜索片段')) {
              return true;
            }
            // 保留AI感兴趣的意群
            for (const groupId of interestedGroups) {
              if (part.startsWith(`【${groupId}`)) {
                return true;
              }
            }
            return false;
          });
          contextParts.length = 0;
          contextParts.push(...filteredContextParts);

          const removedCount = groups.length - interestedGroups.size;
          if (removedCount > 0) {
            yield {
              type: 'info',
              message: `已清理 ${removedCount} 个不相关意群，保留 ${interestedGroups.size} 个AI感兴趣的内容`
            };
          }
        }

        // 检查是否final：优先尊重AI的final判断
        const hadContextThisRound = contextParts.length > 0 || detail.length > 0;
        console.log(`[StreamingMultiHop] 第${round + 1}轮结束检查：contextParts=${contextParts.length}, detail=${detail.length}, final=${plan.final}`);

        // 优先判断：AI明确说final=true，直接结束
        if (plan.final === true) {
          yield {
            type: 'round_end',
            round,
            final: true,
            message: 'AI判断内容已充分，取材完成'
          };
          break;
        }

        // 次要判断：AI说final=false，但已经到最后一轮了，强制结束
        if (round === maxRounds - 1 && hadContextThisRound) {
          yield {
            type: 'round_end',
            round,
            final: true,
            message: '已达最大轮次，使用已获取内容'
          };
          break;
        }

        // 继续下一轮
        yield {
          type: 'round_end',
          round,
          final: false,
          message: '继续下一轮取材...'
        };
      }

      // 4. 汇总上下文 - 智能分层策略
      // 先构建AI请求的上下文组件（地图和意群列表）
      let mapOverview = '';
      let groupListOverview = '';

      // 1. 地图概览（如果AI请求）
      if (aiRequestedMapInFinalContext && window._multiHopLastMapText) {
        mapOverview = `【📋 文档整体结构地图】\n${window._multiHopLastMapText}\n\n`;
        console.log(`[StreamingMultiHop] AI请求包含地图，已添加地图概览 (${window._multiHopLastMapText.length}字)`);
      }

      // 2. 意群简要列表（如果AI请求）
      if (aiRequestedGroupListInFinalContext && groups && groups.length > 0) {
        const simplifiedList = groups.map(g => {
          const charCount = g.charCount || 0;
          const summary = g.summary || '无摘要';
          const keywords = (g.keywords && g.keywords.length > 0) ? ` [${g.keywords.slice(0, 3).join('、')}]` : '';
          return `【${g.groupId}】${charCount}字${keywords} - ${summary}`;
        }).join('\n');
        groupListOverview = `【📑 所有意群简要列表】(共${groups.length}个意群)\n${simplifiedList}\n\n`;
        console.log(`[StreamingMultiHop] AI请求包含意群列表，已添加 ${groups.length} 个意群的简要信息`);
      }

      // 检查是否有任何有用内容：搜索片段 OR fetch的意群 OR 地图 OR 意群列表
      const hasAnyContent = contextParts.length > 0 || mapOverview || groupListOverview;

      if (!hasAnyContent) {
        yield { type: 'warning', message: '未获取到任何上下文，使用后备策略' };
        const fallback = buildFallbackSemanticContext(userQuestion, groups);
        if (fallback) {
          yield {
            type: 'fallback',
            reason: 'empty-context',
            context: fallback.context
          };
          return fallback;
        }
        return null;
      }

      // 分层组织：地图概要(可选) + 搜索片段(最精确) + 重点意群(digest) + 背景意群(summary)
      const searchFragments = [];  // 搜索到的chunk完整文本
      const summaryParts = [];      // summary粒度的意群
      const detailParts = [];       // digest/full粒度的意群

      // 分类contextParts
      contextParts.forEach(part => {
        if (part.startsWith('【向量搜索片段') ||
            part.startsWith('【关键词搜索片段') ||
            part.startsWith('【GREP片段') ||
            part.startsWith('【正则搜索片段') ||
            part.startsWith('【布尔搜索片段')) {
          searchFragments.push(part);
        }
      });

      // 分类detail中的意群
      const granularityCount = { full: 0, digest: 0, summary: 0 };
      detail.forEach(d => {
        const data = fetched.get(d.groupId);
        const part = `【${d.groupId} - ${d.granularity}】\n${data.text}`;

        granularityCount[d.granularity] = (granularityCount[d.granularity] || 0) + 1;

        if (d.granularity === 'summary') {
          summaryParts.push(part);
        } else {
          detailParts.push(part);
        }
      });

      // 构建分层上下文 - AI自主控制的组件顺序
      let selectedContext = '';
      const layers = [];

      // 1. 地图概览（AI请求时）
      if (mapOverview) {
        layers.push(mapOverview);
      }

      // 2. 意群简要列表（AI请求时，提供全局视角）
      if (groupListOverview) {
        layers.push(groupListOverview);
      }

      // 3. 搜索片段（最精确的检索结果）
      if (searchFragments.length > 0) {
        layers.push(`【🎯 搜索片段】(${searchFragments.length}个精确匹配的chunk，最优先使用)\n${searchFragments.join('\n\n')}`);
      }

      // 4. 重点意群（AI fetch的详细内容）
      if (detailParts.length > 0) {
        layers.push(`【📖 重点意群】(${detailParts.length}个详细内容，提供上下文)\n${detailParts.join('\n\n')}`);
      }

      // 5. 背景意群（summary粒度）
      if (summaryParts.length > 0) {
        layers.push(`【📋 背景意群】(${summaryParts.length}个简要摘要，提供全局视角)\n${summaryParts.join('\n\n')}`);
      }

      selectedContext = layers.join('\n\n---\n\n');

      // 统计最终给AI的总token数
      const finalContextTokens = estimateTokens(selectedContext);

      const stats = {
        totalGroups: detail.length,
        searchFragments: searchFragments.length,
        focusGroups: detailParts.length,
        backgroundGroups: summaryParts.length,
        hasMap: aiRequestedMapInFinalContext,
        hasGroupList: aiRequestedGroupListInFinalContext,
        finalContextTokens  // 最终上下文的token数
      };

      if (searchFragments.length > 0 || detailParts.length > 0) {
        const msg = [];
        if (searchFragments.length > 0) msg.push(`${searchFragments.length}个搜索片段`);
        if (detailParts.length > 0) {
          const parts = [];
          if (granularityCount.full > 0) parts.push(`${granularityCount.full}个full`);
          if (granularityCount.digest > 0) parts.push(`${granularityCount.digest}个digest`);
          msg.push(`${detailParts.length}个重点意群(${parts.join('+') || 'mixed'})`);
        }
        if (summaryParts.length > 0) msg.push(`${summaryParts.length}个背景意群(summary)`);

        yield {
          type: 'info',
          message: `三层上下文：${msg.join(' + ')}`
        };
      }

      yield {
        type: 'complete',
        context: selectedContext,
        summary: {
          groups: detail.map(d => d.groupId),
          granularity: 'mixed',
          detail,
          contextLength: selectedContext.length,
          stats
        }
      };

      return {
        groups: detail.map(d => d.groupId),
        granularity: 'mixed',
        detail,
        context: selectedContext,
        stats
      };

    } catch (error) {
      yield {
        type: 'error',
        phase: 'unknown',
        message: error.message,
        stack: error.stack
      };
      return null;
    }
  }

  // 后备策略（同步版本）
  function buildFallbackSemanticContext(userQuestion, groups) {
    try {
      if (!Array.isArray(groups) || groups.length === 0) return null;

      let picks = [];
      try {
        if (window.SemanticGrouper && typeof window.SemanticGrouper.quickMatch === 'function') {
          picks = window.SemanticGrouper.quickMatch(String(userQuestion || ''), groups) || [];
        }
      } catch (_) {}

      if (!picks || picks.length === 0) {
        picks = groups.slice(0, Math.min(3, groups.length));
      }

      const unique = new Set();
      const detail = [];
      const parts = [];

      picks.forEach(g => {
        if (!g || unique.size >= 3 || unique.has(g.groupId)) return;
        unique.add(g.groupId);

        let fetched = null;
        try {
          if (window.SemanticTools && typeof window.SemanticTools.fetchGroupText === 'function') {
            fetched = window.SemanticTools.fetchGroupText(g.groupId, 'digest');
          }
        } catch (_) {}

        const text = (fetched && fetched.text) || g.digest || g.summary || g.fullText || '';
        if (!text) return;

        const gran = (fetched && fetched.granularity) || 'digest';
        parts.push(`【${g.groupId}】\n关键词: ${(g.keywords || []).join('、')}\n内容(${gran}):\n${text}`);
        detail.push({ groupId: g.groupId, granularity: gran });
      });

      if (parts.length === 0) return null;

      return {
        groups: Array.from(unique),
        granularity: 'mixed',
        detail,
        context: parts.join('\n\n')
      };
    } catch (e) {
      console.warn('[buildFallbackSemanticContext] 失败:', e);
      return null;
    }
  }

  // 导出
  window.streamingMultiHopRetrieve = streamingMultiHopRetrieve;

  console.log('[StreamingMultiHop] 流式多轮取材已加载');

})(window);

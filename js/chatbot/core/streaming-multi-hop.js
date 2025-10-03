// js/chatbot/core/streaming-multi-hop.js
// 流式多轮取材 - 实时进度反馈
(function(window) {
  'use strict';

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
      if (groups.length === 0) {
        yield { type: 'error', message: '意群数据为空' };
        return null;
      }

      // 1. 分析问题，获取候选意群
      yield {
        type: 'status',
        phase: 'analyze',
        message: '正在分析问题...'
      };

      const candidates = groups;


      // 2. 多轮取材循环
      const fetched = new Map();
      const detail = [];
      let contextParts = [];
      const gist = (window.data && window.data.semanticDocGist) ? window.data.semanticDocGist : '';
      const searchHistory = []; // 记录搜索历史

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

      if (userSet && userSet.preloadFirstRound === true && groups.length <= 50) {
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

        const sys = `你是检索规划助手。根据用户问题选择最合适的工具组合，目标是用最少的操作获取最精确的内容。

## 工具定义（JSON格式）

### 搜索工具（返回chunk内容，由你决定是否需要完整意群）
- {"tool":"grep","args":{"query":"具体短语","limit":20,"context":2000,"caseInsensitive":true}}
  用途：精确文本搜索（最快、最准）
  返回：包含该短语的原文片段（前后2000字上下文）
  **支持OR逻辑**：query可用 | 分隔多个关键词，如 "方程|公式|equation"
  **你可以调整limit**：需要更多结果就增大limit，只需少量结果就减小limit

- {"tool":"vector_search","args":{"query":"语义描述","limit":15}}
  用途：语义相似搜索（理解同义、相关概念）
  返回：语义最相关的chunks（每个1500-3000字）
  **你可以调整limit**：概念性问题可用limit=10-15，精确查找可用limit=5
  前提：需要向量模型已启用

- {"tool":"keyword_search","args":{"keywords":["词1","词2"],"limit":8}}
  用途：多关键词加权搜索（向量未启用时的后备）
  返回：包含关键词的chunks（BM25评分）
  **你可以调整limit**：关键词明确可用limit=5，模糊查找可用limit=10

### 获取详细内容工具
- {"tool":"fetch","args":{"groupId":"group-1"}}
  用途：获取指定意群详细内容（包含完整论述、公式、数据、图表）
  返回：完整文本（最多8000字）+ 结构信息
  **使用时机**：当搜索到的chunk片段信息不足，需要看到完整上下文时

- {"tool":"map","args":{"limit":50,"includeStructure":true}}
  用途：获取文档整体结构
  返回：意群地图（ID、字数、关键词、摘要、章节/图表/公式）
${preloadedNotice}

## 智能决策流程

**第一步：分析问题，选择合适的搜索工具和limit**
1. 具体实体（人名/公司名/术语/数字）？
   → grep，limit根据预期结果数调整（通常5-10）
   示例："雷曼公司的破产时间" → grep("雷曼公司", limit=5)

2. 概念性/语义问题？
   → vector_search，limit=10-15
   示例："次贷危机的成因" → vector_search("次贷危机 原因", limit=10)

3. 宏观浏览？
   → map获取结构，再根据需要fetch相关意群
   示例："这篇论文的主要内容" → map → fetch [相关意群]

**第二步：判断是否需要fetch意群完整内容**
- 搜索工具会返回：chunk内容 + suggestedGroups（所属意群列表）
- 如果chunk片段**已包含足够信息**回答问题 → 不需要fetch，直接final=true
- 如果chunk片段**信息不足**（如缺少公式细节、数据表、完整论述） → fetch相关意群
- **优先精准而非全面**：只fetch真正需要的意群，不要全部fetch

**核心原则：提供充分、详细、准确的上下文**
- 你的目标是为最终AI提供**足够回答用户问题的完整上下文**
- 不要因为担心token浪费而过早结束检索
- 宁可多获取一些内容，也不要让最终AI因为信息不足而无法回答
- 【已获取内容】为空时，**绝不能**返回空操作，必须至少执行一次检索

**第三步：控制结果数量，避免噪音**
- 优先用**小limit**（5-8个），如果结果不足再增加
- 精确问题：grep limit=5, vector limit=5-8
- 概念问题：vector limit=10-15, keyword limit=8-10
- 避免一次性返回过多结果造成token浪费

**第四步：地图信息的智能使用**
- 【候选意群地图】提供了文档结构概览（如果执行过map工具）
- **你可以根据任务类型自主决定是否需要地图信息辅助回答**：
  * 宏观任务（如"总结主要内容"、"思维导图"）：地图很有用，可直接引用地图结构
  * 微观任务（如"雷曼公司何时破产"）：地图意义不大，依赖具体检索结果
  * 混合/长难任务（如"谁做了什么经历"）：地图可提供流程框架，再用fetch补充细节
- **你的决策方式**：在final=true时，【已获取内容】中包含的信息应该足够最终AI回答
  * 如果认为地图有助于宏观理解，可以确保地图已在【候选意群地图】中（map工具已执行）
  * 如果地图无关紧要，只需确保检索到的chunks/groups足够即可

**第五步：并发与结束**
- 可以在同一轮并发执行多个操作
- 获取到足够内容后立即final=true
- 检查【搜索历史】避免重复搜索
- **只有当【已获取内容】真正充足时**，才返回{"operations":[],"final":true}
- **如果【已获取内容】为空或不足**，必须继续检索，不能直接final=true

## 示例决策

示例1（精确查找，chunk足够）：
问题："雷曼公司何时破产"
→ {"operations":[{"tool":"grep","args":{"query":"雷曼","limit":5}}],"final":true}
→ 返回3个chunk，包含"2008年9月15日申请破产"
→ chunk内容已足够，无需fetch意群

示例2（需要完整上下文）：
问题："详细说明公式7的推导过程"
→ {"operations":[{"tool":"grep","args":{"query":"公式7","limit":5}}],"final":false}
→ 返回2个chunk，suggestedGroups=[group-5, group-8]
→ chunk只有公式片段，缺少完整推导
→ {"operations":[{"tool":"fetch","args":{"groupId":"group-5"}}],"final":true}

示例3（宏观理解）：
问题："生成思维导图"或"文档讲了什么"或"总结主要内容"
→ {"operations":[{"tool":"map","args":{"limit":50,"includeStructure":true}}],"final":false}
→ 获取意群地图，查看结构
→ {"operations":[{"tool":"fetch","args":{"groupId":"group-1"}},{"tool":"fetch","args":{"groupId":"group-5"}}...],"final":true}
→ fetch主要意群的完整内容

## 限制与原则
- 每轮最多5个操作
- 搜索limit不要超过20（避免噪音）
- 只fetch真正需要的意群（2-5个为宜）
- 优先chunk片段，确实不足才fetch意群

返回格式要求：
- **必须**严格返回JSON格式，不要输出任何解释文字
- **禁止**输出中文解释、思考过程、或任何非JSON内容
- 格式：{"operations":[...], "final": true/false, "includeMapInFinalContext": true/false, "includeGroupListInFinalContext": true/false}

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
- 示例1（继续检索）：{"operations":[{"tool":"fetch","args":{"groupId":"group-1"}}],"final":false}
- 示例2（完成，仅fetch内容）：{"operations":[],"final":true}
- 示例3（完成，需要地图+列表）：{"operations":[],"final":true,"includeMapInFinalContext":true,"includeGroupListInFinalContext":true}
- 示例4（完成，仅需意群列表背景）：{"operations":[],"final":true,"includeGroupListInFinalContext":true}`;

        const content = `文档总览:\n${gist}\n\n用户问题:\n${String(userQuestion || '')}${searchHistoryText}\n\n${listText ? '【候选意群地图】：\n' + listText + '\n\n' : ''}【已获取内容】：\n${fetchedSummary}`;

        // 调用LLM规划
        yield {
          type: 'status',
          phase: 'planning',
          round,
          message: 'LLM规划中...'
        };

        const apiKey = config.apiKey;
        const plannerOutput = await window.ChatbotCore.singleChunkSummary(sys, content, config, apiKey);

        // 解析计划
        let plan;
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
              final: plan.final
            }
          };

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

        } catch (e) {
          console.error('[streamingMultiHop] 解析计划失败:', e.message);
          console.error('[streamingMultiHop] LLM原始输出:', plannerOutput);

          yield {
            type: 'error',
            phase: 'parse_plan',
            message: `解析计划失败: ${e.message}`,
            raw: plannerOutput
          };

          // 如果已经获取到内容，直接使用，不要丢弃
          if (fetched.size > 0) {
            yield {
              type: 'warning',
              message: `第 ${round + 1} 轮规划失败，但已获取 ${fetched.size} 个意群，使用已有内容`
            };
            break; // 结束循环，使用已fetch的内容
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
          break;
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
            if (op.tool === 'vector_search' && op.args) {
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
                    suggestedGroups: Array.from(groupIds) // 提示AI可以fetch这些意群
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
                    suggestedGroups: Array.from(groupIds) // 提示AI可以fetch这些意群
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
                      }
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
                    }
                  };
                }
              }
            } else if (op.tool === 'map') {
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
                result: { count: items.length }
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
                suggestedGroups: Array.from(groupIds) // 提示AI可以fetch这些意群
              };
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
            if (part.startsWith('【向量搜索片段') || part.startsWith('【关键词搜索片段') || part.startsWith('【GREP片段')) {
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

        // 检查是否final：若本轮已得到可用上下文（搜索片段或已fetch的意群），且规划未声明final，也可直接结束
        const hadContextThisRound = contextParts.length > 0 || detail.length > 0;
        console.log(`[StreamingMultiHop] 第${round + 1}轮结束检查：contextParts=${contextParts.length}, detail=${detail.length}, final=${plan.final}`);

        if (plan.final === true || hadContextThisRound) {
          yield {
            type: 'round_end',
            round,
            final: true,
            message: '取材完成'
          };
          break;
        } else {
          yield {
            type: 'round_end',
            round,
            final: false,
            message: '继续下一轮取材...'
          };
        }
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
        if (part.startsWith('【向量搜索片段') || part.startsWith('【关键词搜索片段') || part.startsWith('【GREP片段')) {
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

      const stats = {
        totalGroups: detail.length,
        searchFragments: searchFragments.length,
        focusGroups: detailParts.length,
        backgroundGroups: summaryParts.length,
        hasMap: aiRequestedMapInFinalContext,
        hasGroupList: aiRequestedGroupListInFinalContext
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

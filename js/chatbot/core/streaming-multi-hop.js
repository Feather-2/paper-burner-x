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
    const maxRounds = Number(options.maxRounds ?? userSet.maxRounds) > 0 ? Number(options.maxRounds ?? userSet.maxRounds) : 3;

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

      for (let round = 0; round < maxRounds; round++) {
        yield {
          type: 'round_start',
          round,
          maxRounds,
          message: `第 ${round + 1}/${maxRounds} 轮取材...`
        };

        // 构建Prompt - 展示完整的意群地图
        const listText = candidates.map(g => {
          const struct = g.structure || {};
          const parts = [`【${g.groupId}】 ${g.charCount || 0}字`];

          // 关键词
          if (g.keywords && g.keywords.length > 0) {
            parts.push(`关键词: ${g.keywords.join('、')}`);
          }

          // 结构化信息
          if (struct.figures && struct.figures.length > 0) {
            parts.push(`包含图: ${struct.figures.join('; ')}`);
          }
          if (struct.tables && struct.tables.length > 0) {
            parts.push(`包含表: ${struct.tables.join('; ')}`);
          }
          if (struct.sections && struct.sections.length > 0) {
            parts.push(`章节: ${struct.sections.join('; ')}`);
          }
          if (struct.keyPoints && struct.keyPoints.length > 0) {
            parts.push(`要点: ${struct.keyPoints.join('; ')}`);
          }

          // 完整摘要（不截断）
          if (g.summary) {
            parts.push(`摘要: ${g.summary}`);
          }

          return parts.join('\n');
        }).join('\n\n');
        const fetchedList = Array.from(fetched.keys()).join(', ') || '无';

        const sys = `你是检索规划助手。你可以调用以下工具，按需多轮取材：

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
不要输出解释文字。`;

        const content = `文档总览:\n${gist}\n\n用户问题:\n${String(userQuestion || '')}\n\n候选意群:\n${listText}\n\n已获取意群: ${fetchedList}`;

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
          const cleaned = plannerOutput
            .replace(/```jsonc?|```tool|```/gi,'')
            .replace(/[\u0000-\u001f]/g, ' ')
            .trim();

          if (!cleaned) {
            yield { type: 'warning', message: '规划输出为空，使用后备策略' };
            break;
          }

          try {
            plan = JSON.parse(cleaned);
          } catch (parseErr) {
            let normalized = cleaned
              .replace(/"\s+([\w-]+)"\s*:/g, '"$1":')
              .replace(/"\s+final"/gi, '"final"')
              .replace(/"operations"\s*"/i, '"operations":')
              .replace(/"\s+([\w-]+)"\s+"/g, '"$1":')
              .replace(/,\s*}/g, '}')
              .replace(/,\s*]/g, ']')
              .replace(/\s+/g, ' ')
              .trim();
            plan = JSON.parse(normalized);
          }

          yield {
            type: 'plan',
            round,
            data: {
              operations: plan.operations || [],
              final: plan.final
            }
          };

        } catch (e) {
          yield {
            type: 'error',
            phase: 'parse_plan',
            message: `解析计划失败: ${e.message}`,
            raw: plannerOutput
          };

          // 使用后备策略
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
        if (ops.length === 0) {
          yield { type: 'warning', message: '规划无操作，使用后备策略' };
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
              const limit = Math.min(Number(op.args.limit) || 5, 12);

              if (window.SemanticVectorSearch && window.EmbeddingClient?.config?.enabled) {
                // 获取enrichedChunks
                const chunks = window.data?.enrichedChunks || [];
                const res = await window.SemanticVectorSearch.search(query, chunks, {
                  topK: limit,
                  threshold: 0.3
                });

                if (Array.isArray(res) && res.length) {
                  yield {
                    type: 'tool_result',
                    round,
                    opIndex,
                    tool: 'vector_search',
                    result: res.slice(0, 5).map(r => ({
                      chunkId: r.chunkId,
                      belongsToGroup: r.belongsToGroup,
                      text: r.text, // 返回完整chunk文本
                      score: r.score
                    }))
                  };
                }
              }

            } else if (op.tool === 'keyword_search' && op.args) {
              // 关键词精确匹配
              const keywords = Array.isArray(op.args.keywords) ? op.args.keywords : [String(op.args.keywords || '')];
              const limit = Math.min(Number(op.args.limit) || 3, 12);

              if (window.SemanticBM25Search) {
                // 使用BM25进行关键词搜索chunks
                const chunks = window.data?.enrichedChunks || [];
                const query = keywords.join(' ');
                const res = window.SemanticBM25Search.searchChunks(query, chunks, {
                  topK: limit,
                  threshold: 0.1
                });

                if (Array.isArray(res) && res.length) {
                  yield {
                    type: 'tool_result',
                    round,
                    opIndex,
                    tool: 'keyword_search',
                    result: res.slice(0, 5).map(r => ({
                      chunkId: r.chunkId,
                      belongsToGroup: r.belongsToGroup,
                      text: r.text, // 返回完整chunk文本
                      matchedKeywords: keywords.filter(kw => r.text.includes(kw))
                    }))
                  };
                }
              }

            } else if (op.tool === 'fetch_group' && op.args && typeof window.SemanticTools?.fetchGroupText === 'function') {
              const id = op.args.groupId;
              const gran = (op.args.granularity || 'digest');

              if (!fetched.has(id)) {
                const res = window.SemanticTools.fetchGroupText(id, gran);

                if (res && res.text) {
                  fetched.set(id, { granularity: res.granularity, text: res.text });
                  detail.push({ groupId: id, granularity: res.granularity });
                  contextParts.push(`【${id} - ${res.granularity}】\n${res.text}`);

                  yield {
                    type: 'tool_result',
                    round,
                    opIndex,
                    tool: 'fetch_group',
                    result: {
                      groupId: id,
                      granularity: res.granularity,
                      preview: res.text.slice(0, 200)
                    }
                  };
                }
              } else {
                yield {
                  type: 'tool_skip',
                  round,
                  opIndex,
                  tool: 'fetch_group',
                  reason: 'already_fetched',
                  groupId: id
                };
              }
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

        // 检查是否final
        if (plan.final === true) {
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

      // 4. 汇总上下文
      if (contextParts.length === 0) {
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

      const selectedContext = contextParts.join('\n\n');

      yield {
        type: 'complete',
        context: selectedContext,
        summary: {
          groups: detail.map(d => d.groupId),
          granularity: 'mixed',
          detail,
          contextLength: selectedContext.length
        }
      };

      return {
        groups: detail.map(d => d.groupId),
        granularity: 'mixed',
        detail,
        context: selectedContext
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

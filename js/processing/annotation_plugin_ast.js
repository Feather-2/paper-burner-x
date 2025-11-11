// js/processing/annotation_plugin_ast.js
// AST-based annotation plugin for markdown-it
// 基于 AST 的注释插件，比字符串替换更精准、更高效

(function(global) {
    'use strict';

    /**
     * 创建 AST 注释插件
     * @param {Array} annotations - 注释数组 [{text, id, ...}, ...]
     * @param {Object} options - 配置选项
     * @returns {Function} markdown-it 插件函数
     */
    function createAnnotationPlugin(annotations, options = {}) {
        const config = {
            debug: false,
            contentIdentifier: 'default',
            skipCodeBlocks: true,
            skipMathBlocks: true,
            ...options
        };

        // 构建注释索引（优化性能）
        const annotationMap = new Map();
        if (Array.isArray(annotations)) {
            annotations.forEach(ann => {
                if (ann && ann.text) {
                    const key = ann.text.toLowerCase();
                    if (!annotationMap.has(key)) {
                        annotationMap.set(key, []);
                    }
                    annotationMap.get(key).push(ann);
                }
            });
        }

        return function annotationPluginImpl(md) {
            if (config.debug) {
                console.log('[AnnotationPluginAST] Loaded with', annotationMap.size, 'annotations');
            }

            // 在 inline 处理后注入注释
            md.core.ruler.after('inline', 'annotations', function(state) {
                if (annotationMap.size === 0) {
                    return; // 没有注释，跳过
                }

                const tokens = state.tokens;

                for (let i = 0; i < tokens.length; i++) {
                    const token = tokens[i];

                    // 只处理包含 inline 内容的 token
                    if (token.type === 'inline' && token.children) {
                        processInlineTokens(token.children, config);
                    }
                }
            });
        };

        /**
         * 处理 inline tokens
         */
        function processInlineTokens(children, config) {
            const newChildren = [];

            for (let i = 0; i < children.length; i++) {
                const child = children[i];

                // 只处理文本节点
                if (child.type === 'text') {
                    // 检查上下文
                    const context = getTokenContext(children, i);

                    if (shouldSkipToken(child, context, config)) {
                        newChildren.push(child);
                        continue;
                    }

                    // 尝试注入注释
                    const annotatedTokens = injectAnnotations(child, config);
                    newChildren.push(...annotatedTokens);
                } else {
                    newChildren.push(child);
                }
            }

            // 替换原始 children
            children.length = 0;
            children.push(...newChildren);
        }

        /**
         * 获取 token 的上下文信息
         */
        function getTokenContext(siblings, index) {
            const context = {
                inCode: false,
                inMath: false,
                prevToken: index > 0 ? siblings[index - 1] : null,
                nextToken: index < siblings.length - 1 ? siblings[index + 1] : null
            };

            // 检查是否在代码中
            if (context.prevToken) {
                if (context.prevToken.type === 'code_inline' ||
                    context.prevToken.markup === '`') {
                    context.inCode = true;
                }
            }

            // 检查是否在公式中
            if (context.prevToken && context.prevToken.type === 'math_inline') {
                context.inMath = true;
            }

            return context;
        }

        /**
         * 判断是否应该跳过该 token
         */
        function shouldSkipToken(token, context, config) {
            // 跳过空文本
            if (!token.content || !token.content.trim()) {
                return true;
            }

            // 跳过代码块
            if (config.skipCodeBlocks && context.inCode) {
                return true;
            }

            // 跳过公式
            if (config.skipMathBlocks && context.inMath) {
                return true;
            }

            // 跳过纯数字/标点
            if (/^[\d\s\.,;:!?\-()]+$/.test(token.content)) {
                return true;
            }

            return false;
        }

        /**
         * 在文本 token 中注入注释
         * @returns {Array} 拆分后的 token 数组
         */
        function injectAnnotations(textToken, config) {
            const text = textToken.content;
            const matches = [];

            // 查找所有匹配的注释
            annotationMap.forEach((anns, key) => {
                anns.forEach(ann => {
                    const searchText = ann.text;
                    let index = 0;

                    while ((index = text.indexOf(searchText, index)) !== -1) {
                        matches.push({
                            start: index,
                            end: index + searchText.length,
                            annotation: ann,
                            text: searchText
                        });
                        index += searchText.length;
                    }
                });
            });

            // 如果没有匹配，返回原 token
            if (matches.length === 0) {
                return [textToken];
            }

            // 按位置排序并去重
            matches.sort((a, b) => a.start - b.start);
            const dedupedMatches = deduplicateMatches(matches);

            // 拆分 token
            return splitTokenWithAnnotations(textToken, dedupedMatches, config);
        }

        /**
         * 去除重叠的注释匹配
         */
        function deduplicateMatches(matches) {
            const result = [];
            let lastEnd = -1;

            for (const match of matches) {
                if (match.start >= lastEnd) {
                    result.push(match);
                    lastEnd = match.end;
                }
            }

            return result;
        }

        /**
         * 拆分 token 并插入注释标记
         */
        function splitTokenWithAnnotations(textToken, matches, config) {
            const result = [];
            let lastIndex = 0;
            const text = textToken.content;

            matches.forEach(match => {
                // 添加注释前的文本
                if (match.start > lastIndex) {
                    const beforeToken = createTextToken(text.substring(lastIndex, match.start));
                    result.push(beforeToken);
                }

                // 添加注释标记的 HTML token
                const annToken = createAnnotationToken(match.text, match.annotation, config);
                result.push(annToken);

                lastIndex = match.end;
            });

            // 添加最后的文本
            if (lastIndex < text.length) {
                const afterToken = createTextToken(text.substring(lastIndex));
                result.push(afterToken);
            }

            return result;
        }

        /**
         * 创建文本 token
         */
        function createTextToken(content) {
            return {
                type: 'text',
                content: content,
                level: 0
            };
        }

        /**
         * 创建注释 HTML token
         */
        function createAnnotationToken(text, annotation, config) {
            // 转义 HTML
            const escapedText = escapeHtml(text);

            // 构建属性
            const attrs = {
                'data-annotation-text': escapedText,
                'data-content-id': config.contentIdentifier,
                'class': 'annotation-highlight'
            };

            if (annotation.id) {
                attrs['data-annotation-id'] = annotation.id;
            }

            // 构建 HTML
            const attrString = Object.entries(attrs)
                .map(([key, val]) => `${key}="${escapeHtml(String(val))}"`)
                .join(' ');

            const html = `<span ${attrString}>${escapedText}</span>`;

            return {
                type: 'html_inline',
                content: html,
                level: 0
            };
        }

        /**
         * HTML 转义
         */
        function escapeHtml(text) {
            const htmlEscapes = {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            };
            return String(text).replace(/[&<>"']/g, (match) => htmlEscapes[match]);
        }
    }

    // 导出到全局
    global.createAnnotationPluginAST = createAnnotationPlugin;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createAnnotationPlugin;
    }

})(window);

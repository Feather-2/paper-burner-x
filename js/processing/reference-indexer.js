// js/processing/reference-indexer.js
// 参考文献索引器 - 建立文献与原文的关联

(function(global) {
    'use strict';

    /**
     * 参考文献索引器类
     */
    class ReferenceIndexer {
        constructor() {
            this.indices = new Map(); // documentId -> references with positions
        }

        /**
         * 为文档建立文献索引
         * @param {string} documentId - 文档ID
         * @param {string} markdown - Markdown文本
         * @param {Array} references - 文献数组
         * @returns {Array} 带有位置信息的文献数组
         */
        buildIndex(documentId, markdown, references) {
            if (!markdown || !references || references.length === 0) {
                return references;
            }

            const indexedReferences = references.map(ref => {
                const position = this.findReferenceInText(markdown, ref);
                return {
                    ...ref,
                    position: position
                };
            });

            this.indices.set(documentId, indexedReferences);
            return indexedReferences;
        }

        /**
         * 在文本中查找文献的位置
         * @param {string} markdown - Markdown文本
         * @param {Object} reference - 文献对象
         * @returns {Object|null} { lineStart, lineEnd, charStart, charEnd }
         */
        findReferenceInText(markdown, reference) {
            const lines = markdown.split('\n');

            // 如果文献有原始行号信息，直接使用
            if (reference.lineStart !== undefined && reference.lineEnd !== undefined) {
                const charStart = this.getCharPosition(lines, reference.lineStart);
                const charEnd = this.getCharPosition(lines, reference.lineEnd + 1);

                return {
                    lineStart: reference.lineStart,
                    lineEnd: reference.lineEnd,
                    charStart: charStart,
                    charEnd: charEnd
                };
            }

            // 否则，通过原始文本匹配
            if (reference.rawText) {
                const rawText = reference.rawText.trim();
                const position = this.findTextPosition(markdown, rawText);
                if (position) {
                    return position;
                }
            }

            // 通过DOI查找
            if (reference.doi) {
                const position = this.findTextPosition(markdown, reference.doi);
                if (position) {
                    return position;
                }
            }

            // 通过标题查找
            if (reference.title) {
                const position = this.findTextPosition(markdown, reference.title);
                if (position) {
                    return position;
                }
            }

            return null;
        }

        /**
         * 在文本中查找指定字符串的位置
         * @param {string} text - 文本
         * @param {string} searchText - 搜索文本
         * @returns {Object|null} { lineStart, lineEnd, charStart, charEnd }
         */
        findTextPosition(text, searchText) {
            const index = text.indexOf(searchText);
            if (index === -1) {
                return null;
            }

            const lines = text.split('\n');
            let currentPos = 0;

            for (let i = 0; i < lines.length; i++) {
                const lineLength = lines[i].length + 1; // +1 for newline

                if (currentPos + lineLength > index) {
                    // 找到了起始行
                    const charStart = index;
                    const charEnd = index + searchText.length;

                    // 计算结束行
                    let lineEnd = i;
                    let tempPos = currentPos;
                    for (let j = i; j < lines.length; j++) {
                        tempPos += lines[j].length + 1;
                        if (tempPos >= charEnd) {
                            lineEnd = j;
                            break;
                        }
                    }

                    return {
                        lineStart: i,
                        lineEnd: lineEnd,
                        charStart: charStart,
                        charEnd: charEnd
                    };
                }

                currentPos += lineLength;
            }

            return null;
        }

        /**
         * 获取指定行号的字符位置
         * @param {Array} lines - 文本行数组
         * @param {number} lineNumber - 行号
         * @returns {number} 字符位置
         */
        getCharPosition(lines, lineNumber) {
            let pos = 0;
            for (let i = 0; i < Math.min(lineNumber, lines.length); i++) {
                pos += lines[i].length + 1; // +1 for newline
            }
            return pos;
        }

        /**
         * 获取文献在原文中的位置
         * @param {string} documentId - 文档ID
         * @param {number} referenceIndex - 文献索引
         * @returns {Object|null} 位置信息
         */
        getReferencePosition(documentId, referenceIndex) {
            const refs = this.indices.get(documentId);
            if (!refs || !refs[referenceIndex]) {
                return null;
            }

            return refs[referenceIndex].position;
        }

        /**
         * 滚动到文献在原文中的位置
         * @param {string} documentId - 文档ID
         * @param {number} referenceIndex - 文献索引
         * @param {HTMLElement} targetElement - 目标元素（显示原文的容器）
         */
        scrollToReference(documentId, referenceIndex, targetElement = null) {
            const position = this.getReferencePosition(documentId, referenceIndex);
            if (!position) {
                console.warn('[ReferenceIndexer] Position not found for reference', referenceIndex);
                return false;
            }

            // 查找或创建目标元素
            const container = targetElement || this.findMarkdownContainer();
            if (!container) {
                console.warn('[ReferenceIndexer] Markdown container not found');
                return false;
            }

            // 高亮文献位置
            this.highlightReference(container, position);

            // 滚动到位置
            const element = this.findElementAtPosition(container, position);
            if (element) {
                element.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center'
                });

                // 添加闪烁动画
                this.addFlashAnimation(element);
                return true;
            }

            return false;
        }

        /**
         * 查找Markdown容器元素
         */
        findMarkdownContainer() {
            // 首先检查当前可见的标签页
            const currentTab = window.currentVisibleTabId;
            if (currentTab === 'ocr') {
                const ocrContainer = document.getElementById('ocr-content-wrapper');
                if (ocrContainer) return ocrContainer;
            } else if (currentTab === 'translation') {
                const transContainer = document.getElementById('translation-content-wrapper');
                if (transContainer) return transContainer;
            }

            // 尝试多种可能的容器ID（包括实际使用的）
            const possibleIds = [
                'ocr-content-wrapper',
                'translation-content-wrapper',
                'markdown-content',
                'ocrResult',
                'translation-result',
                'document-viewer'
            ];

            for (const id of possibleIds) {
                const element = document.getElementById(id);
                if (element) {
                    return element;
                }
            }

            // 尝试通过类名查找
            const possibleClasses = [
                'content-wrapper',
                'markdown-body',
                'markdown-content',
                'document-content'
            ];

            for (const className of possibleClasses) {
                const element = document.querySelector('.' + className);
                if (element) {
                    return element;
                }
            }

            return null;
        }

        /**
         * 在元素中查找指定位置的元素
         * @param {HTMLElement} container - 容器元素
         * @param {Object} position - 位置信息
         * @returns {HTMLElement|null}
         */
        findElementAtPosition(container, position) {
            // 简化实现：通过文本内容查找
            const walker = document.createTreeWalker(
                container,
                NodeFilter.SHOW_TEXT,
                null,
                false
            );

            let currentPos = 0;
            let node;

            while (node = walker.nextNode()) {
                const nodeLength = node.textContent.length;

                if (currentPos + nodeLength >= position.charStart) {
                    // 找到包含目标位置的节点
                    return node.parentElement;
                }

                currentPos += nodeLength;
            }

            return null;
        }

        /**
         * 高亮文献位置
         * @param {HTMLElement} container - 容器元素
         * @param {Object} position - 位置信息
         */
        highlightReference(container, position) {
            // 移除之前的高亮
            const oldHighlights = container.querySelectorAll('.reference-highlight');
            oldHighlights.forEach(el => {
                el.classList.remove('reference-highlight');
            });

            // 查找并高亮目标元素
            const element = this.findElementAtPosition(container, position);
            if (element) {
                element.classList.add('reference-highlight');

                // 3秒后移除高亮
                setTimeout(() => {
                    element.classList.remove('reference-highlight');
                }, 3000);
            }
        }

        /**
         * 添加闪烁动画
         * @param {HTMLElement} element - 目标元素
         */
        addFlashAnimation(element) {
            element.style.transition = 'background-color 0.5s ease';
            const originalBg = element.style.backgroundColor;

            // 闪烁3次
            let count = 0;
            const interval = setInterval(() => {
                element.style.backgroundColor = count % 2 === 0 ? '#fff3cd' : originalBg;
                count++;

                if (count >= 6) {
                    clearInterval(interval);
                    element.style.backgroundColor = originalBg;
                }
            }, 300);
        }

        /**
         * 在文档中标记文献引用（为引用添加链接）
         * @param {string} markdown - Markdown文本
         * @param {Array} references - 文献数组
         * @returns {string} 标记后的Markdown
         */
        markReferenceCitations(markdown, references) {
            if (!markdown || !references || references.length === 0) {
                return markdown;
            }

            let markedMarkdown = markdown;

            // 查找引用标记，如 [1], [2, 3], [1-5] 等
            const citationPattern = /\[(\d+(?:\s*[-–,]\s*\d+)*)\]/g;

            markedMarkdown = markedMarkdown.replace(citationPattern, (match, numbers) => {
                // 解析引用编号
                const refNumbers = this.parseReferenceNumbers(numbers);

                // 检查是否都是有效的引用
                const validRefs = refNumbers.filter(num => num > 0 && num <= references.length);

                if (validRefs.length > 0) {
                    // 生成带链接的标记
                    const refLinks = validRefs.map(num =>
                        `<a href="#ref-${num}" class="reference-citation" data-ref-index="${num - 1}">[${num}]</a>`
                    ).join('');

                    return refLinks;
                }

                return match;
            });

            return markedMarkdown;
        }

        /**
         * 解析引用编号
         * @param {string} numbers - 编号字符串，如 "1", "2-5", "1,3,5"
         * @returns {Array} 编号数组
         */
        parseReferenceNumbers(numbers) {
            const result = [];

            // 分割逗号
            const parts = numbers.split(/\s*,\s*/);

            parts.forEach(part => {
                // 检查是否是范围（如 2-5）
                const rangeMatch = part.match(/(\d+)\s*[-–]\s*(\d+)/);
                if (rangeMatch) {
                    const start = parseInt(rangeMatch[1]);
                    const end = parseInt(rangeMatch[2]);
                    for (let i = start; i <= end; i++) {
                        result.push(i);
                    }
                } else {
                    const num = parseInt(part);
                    if (!isNaN(num)) {
                        result.push(num);
                    }
                }
            });

            return result;
        }

        /**
         * 为引用链接绑定点击事件
         * @param {string} documentId - 文档ID
         * @param {HTMLElement} container - 容器元素
         */
        bindCitationLinks(documentId, container = null) {
            const targetContainer = container || document;

            targetContainer.querySelectorAll('.reference-citation').forEach(link => {
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    const refIndex = parseInt(link.dataset.refIndex);

                    // 方式1: 滚动到文献列表中的对应项
                    this.scrollToReferenceInList(refIndex);

                    // 方式2: 如果在管理器中，高亮对应行
                    this.highlightReferenceInManager(refIndex);
                });
            });
        }

        /**
         * 滚动到文献列表中的项
         * @param {number} refIndex - 文献索引
         */
        scrollToReferenceInList(refIndex) {
            const refElement = document.querySelector(`[data-ref-id="ref-${refIndex + 1}"]`);
            if (refElement) {
                refElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                this.addFlashAnimation(refElement);
            }
        }

        /**
         * 在管理器中高亮文献
         * @param {number} refIndex - 文献索引
         */
        highlightReferenceInManager(refIndex) {
            const row = document.querySelector(`tr[data-index="${refIndex}"]`);
            if (row) {
                // 移除之前的高亮
                document.querySelectorAll('.ref-row-highlight').forEach(r => {
                    r.classList.remove('ref-row-highlight');
                });

                row.classList.add('ref-row-highlight');

                // 3秒后移除高亮
                setTimeout(() => {
                    row.classList.remove('ref-row-highlight');
                }, 3000);
            }
        }

        /**
         * 清空索引
         */
        clearIndex(documentId) {
            if (documentId) {
                this.indices.delete(documentId);
            } else {
                this.indices.clear();
            }
        }
    }

    // 创建全局实例
    const indexer = new ReferenceIndexer();

    // 导出API
    global.ReferenceIndexer = indexer;

    // 添加CSS样式
    const style = document.createElement('style');
    style.textContent = `
        .reference-citation {
            color: #2196F3;
            text-decoration: none;
            font-weight: 500;
            padding: 0 2px;
            border-radius: 2px;
            transition: background-color 0.2s;
        }

        .reference-citation:hover {
            background-color: #e3f2fd;
            text-decoration: underline;
        }

        .reference-highlight {
            background-color: #fff3cd !important;
            border-left: 3px solid #ffc107;
            padding-left: 8px;
            transition: all 0.3s ease;
        }

        .ref-row-highlight {
            background-color: #fff3cd !important;
            animation: pulse 0.5s ease 3;
        }

        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.7; }
        }
    `;
    document.head.appendChild(style);

    console.log('[ReferenceIndexer] Reference indexer loaded.');

})(window);




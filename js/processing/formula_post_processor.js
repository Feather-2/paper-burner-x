// js/processing/formula_post_processor.js
// 后处理：扫描 HTML 中的纯文本公式并渲染

(function(global) {
    'use strict';

    /**
     * 修复公式中的常见 LaTeX 错误
     * @param {string} formula - 原始公式
     * @param {boolean} isDisplay - 是否为块级公式
     * @returns {string} - 修复后的公式
     */
    function fixFormulaErrors(formula, isDisplay) {
        let fixed = formula;

        // 修复 1: 移除行内公式中的 \tag{...}
        // \tag 只能在块级公式 (displayMode) 中使用
        if (!isDisplay && /\\tag\{[^}]*\}/.test(fixed)) {
            console.log('[FormulaPostProcessor] 移除行内公式中的 \\tag');
            fixed = fixed.replace(/\\tag\{[^}]*\}/g, '');
        }

        // 修复 2: 修复 \;^\circ 语法错误
        // \;^\circ → \,^{\circ} 或 ^{\circ}
        if (/\\;\s*\^\\circ/.test(fixed)) {
            console.log('[FormulaPostProcessor] 修复 \\;^\\circ → \\,^{\\circ}');
            fixed = fixed.replace(/\\;\s*\^\\circ/g, '\\,^{\\circ}');
        }

        // 修复 2b: 修复其他 \;^ 的情况
        if (/\\;\s*\^([^{])/.test(fixed)) {
            console.log('[FormulaPostProcessor] 修复 \\;^x → \\,^{x}');
            fixed = fixed.replace(/\\;\s*\^([^{])/g, (match, char) => `\\,^{${char}}`);
        }

        // 修复 3: 修复双花括号 {{...}} → {...}
        // 双花括号可能导致 "internal group" 错误
        if (/\{\{/.test(fixed)) {
            console.log('[FormulaPostProcessor] 修复双花括号 {{...}} → {...}');
            // 递归移除双花括号，直到没有为止
            while (/\{\{/.test(fixed)) {
                fixed = fixed.replace(/\{\{([^}]*)\}\}/g, '{$1}');
            }
        }

        // 修复 4: 修复 \mathrm{\;^\circ C} 的情况
        if (/\\mathrm\{[^}]*\\;[^}]*\^\s*\\circ[^}]*\}/.test(fixed)) {
            console.log('[FormulaPostProcessor] 修复 \\mathrm{\\;^\\circ C}');
            // \mathrm{\;^\circ C} → \,^{\circ}\mathrm{C}
            fixed = fixed.replace(/\\mathrm\{\s*\\;\s*\^\s*\\circ\s+([^}]+)\}/g, '\\,^{\\circ}\\mathrm{$1}');
        }

        // 修复 5: 确保上标总是用花括号包围（除非是单个字符）
        // ^xy → ^{xy} (如果 y 不是空格或特殊符号)
        fixed = fixed.replace(/\^([a-zA-Z]{2,})/g, '^{$1}');

        return fixed.trim();
    }

    /**
     * 扫描元素中的所有文本节点，找到未渲染的公式并渲染
     * @param {HTMLElement} rootElement - 要扫描的根元素
     */
    function processFormulasInElement(rootElement) {
        if (!rootElement) return;

        const startTime = performance.now();
        let processedCount = 0;
        let removedCount = 0;

        // 先清理错误的 katex-fallback 元素（不完整的公式）
        const fallbackElements = rootElement.querySelectorAll('.katex-fallback');
        fallbackElements.forEach(el => {
            const text = el.textContent.trim();

            // 检测不完整的环境标记
            if (/^\\begin\{(aligned|array|matrix|cases|split|gather)\}$/.test(text) ||
                /^\\end\{(aligned|array|matrix|cases|split|gather)\}$/.test(text)) {
                console.log('[FormulaPostProcessor] 删除不完整的公式块:', text);
                el.remove();
                removedCount++;
                return;
            }

            // 检测常见的 LaTeX 错误并尝试修正
            const errorTitle = el.getAttribute('title') || '';
            const errorMatch = errorTitle.match(/Undefined control sequence: (\\[A-Za-z]+)/);
            const fontMetricsError = errorTitle.includes('Font metrics not found');

            if (errorMatch || fontMetricsError) {
                const wrongCmd = errorMatch ? errorMatch[1] : '';
                let fixedText = text;
                let fixed = false;

                // 修复字体嵌套问题（如 \texttt{\textbf{M}} ）
                if (fontMetricsError) {
                    // 移除嵌套的字体命令，只保留外层
                    fixedText = text
                        // \texttt{\textbf{X}} → \texttt{X}
                        .replace(/\\texttt\s*\{\s*\\text(bf|it|rm)\s*\{([^}]+)\}\s*\}/g, '\\texttt{$2}')
                        // \textbf{\texttt{X}} → \textbf{X}
                        .replace(/\\text(bf|it|rm)\s*\{\s*\\texttt\s*\{([^}]+)\}\s*\}/g, '\\text$1{$2}')
                        // 任意嵌套字体 → 保留外层
                        .replace(/\\(text(tt|bf|it|rm|sf)|math(tt|bf|it|rm|sf|cal|bb))\s*\{\s*\\(text(tt|bf|it|rm|sf)|math(tt|bf|it|rm|sf|cal|bb))\s*\{([^}]+)\}\s*\}/g, '\\$1{$6}');

                    if (fixedText !== text) {
                        fixed = true;
                        console.log('[FormulaPostProcessor] 修正字体嵌套:', text.substring(0, 50), '→', fixedText.substring(0, 50));
                    }
                }

                // 常见错误映射
                if (!fixed && errorMatch) {
                const fixes = {
                    // 向量和重音符号（大写→小写）
                    '\\Vec': '\\vec',
                    '\\Hat': '\\hat',
                    '\\Bar': '\\bar',
                    '\\Tilde': '\\tilde',
                    '\\Dot': '\\dot',
                    '\\Ddot': '\\ddot',
                    '\\Check': '\\check',
                    '\\Acute': '\\acute',
                    '\\Grave': '\\grave',
                    '\\Breve': '\\breve',
                    '\\Overline': '\\overline',
                    '\\Underline': '\\underline',
                    '\\Widehat': '\\widehat',
                    '\\Widetilde': '\\widetilde',
                    '\\Overbrace': '\\overbrace',
                    '\\Underbrace': '\\underbrace',

                    // 字体命令（大写→小写）
                    '\\Mat': '\\mathrm',
                    '\\Bf': '\\mathbf',
                    '\\It': '\\mathit',
                    '\\Cal': '\\mathcal',
                    '\\Scr': '\\mathscr',
                    '\\Frak': '\\mathfrak',
                    '\\Bb': '\\mathbb',

                    // 小写希腊字母（大写→小写）
                    '\\Alpha': '\\alpha',
                    '\\Beta': '\\beta',
                    '\\Epsilon': '\\epsilon',
                    '\\Zeta': '\\zeta',
                    '\\Eta': '\\eta',
                    '\\Iota': '\\iota',
                    '\\Kappa': '\\kappa',
                    '\\Mu': '\\mu',
                    '\\Nu': '\\nu',
                    '\\Omicron': '\\omicron',
                    '\\Rho': '\\rho',
                    '\\Tau': '\\tau',
                    '\\Chi': '\\chi',

                    // 数学运算符（大写→小写）
                    '\\Sum': '\\sum',
                    '\\Prod': '\\prod',
                    '\\Int': '\\int',
                    '\\Lim': '\\lim',
                    '\\Inf': '\\inf',
                    '\\Sup': '\\sup',
                    '\\Max': '\\max',
                    '\\Min': '\\min',
                    '\\Sin': '\\sin',
                    '\\Cos': '\\cos',
                    '\\Tan': '\\tan',
                    '\\Log': '\\log',
                    '\\Ln': '\\ln',
                    '\\Exp': '\\exp',

                    // 其他常见错误
                    '\\limit': '\\lim',
                    '\\Frac': '\\frac',
                    '\\Sqrt': '\\sqrt',
                    '\\Text': '\\text',
                    '\\Left': '\\left',
                    '\\Right': '\\right',
                    '\\Big': '\\big',
                    '\\Bigg': '\\bigg',
                };

                // 尝试修正
                for (const [wrong, correct] of Object.entries(fixes)) {
                    if (text.includes(wrong)) {
                        fixedText = text.replace(new RegExp(wrong.replace('\\', '\\\\'), 'g'), correct);
                        fixed = true;
                        break;
                    }
                }
                } // 结束 if (!fixed && errorMatch)

                if (fixed) {
                    console.log('[FormulaPostProcessor] 修正公式错误:', wrongCmd, '→', fixedText.substring(0, 50));
                    try {
                        // 尝试重新渲染
                        const isBlock = el.classList.contains('katex-block');
                        const span = document.createElement('span');
                        span.className = isBlock ? 'katex-block' : 'katex-inline';

                        if (typeof katex !== 'undefined') {
                            katex.render(fixedText, span, {
                                throwOnError: false,
                                displayMode: isBlock
                            });
                            el.replaceWith(span);
                            processedCount++;
                        }
                    } catch (err) {
                        console.warn('[FormulaPostProcessor] 修正后仍无法渲染:', err.message);
                    }
                }
            }
        });

        // 递归处理所有文本节点
        function processNode(node) {
            // 跳过已经渲染过的 KaTeX 元素
            if (node.classList && (node.classList.contains('katex') || node.classList.contains('katex-inline') || node.classList.contains('katex-block'))) {
                return;
            }

            // 跳过 script、style、code 等标签
            if (node.tagName && /^(SCRIPT|STYLE|CODE|PRE)$/.test(node.tagName)) {
                return;
            }

            // 处理文本节点
            if (node.nodeType === Node.TEXT_NODE) {
                const text = node.textContent;

                // 检查是否包含公式标记
                if (text.includes('$')) {
                    processTextNode(node);
                }
            }
            // 递归处理子节点
            else if (node.childNodes) {
                // 转换为数组避免在遍历时修改 DOM 导致问题
                Array.from(node.childNodes).forEach(processNode);
            }
        }

        /**
         * 处理单个文本节点，将其中的公式替换为渲染后的 HTML
         */
        function processTextNode(textNode) {
            const text = textNode.textContent;

            // 匹配所有公式：$...$ 和 $$...$$
            const formulaRegex = /\$\$([^\$]+?)\$\$|\$([^\$\n]+?)\$/g;

            if (!formulaRegex.test(text)) return;

            // 重置正则
            formulaRegex.lastIndex = 0;

            const fragments = [];
            let lastIndex = 0;
            let match;

            while ((match = formulaRegex.exec(text)) !== null) {
                // 添加公式前的文本
                if (match.index > lastIndex) {
                    fragments.push(document.createTextNode(text.substring(lastIndex, match.index)));
                }

                // 渲染公式
                let formula = match[1] || match[2]; // $$...$$ 或 $...$
                const isDisplay = !!match[1];

                // 预处理：修复常见的 LaTeX 错误
                formula = fixFormulaErrors(formula, isDisplay);

                try {
                    // 使用 KaTeX 渲染
                    const span = document.createElement('span');
                    span.className = isDisplay ? 'katex-block' : 'katex-inline';

                    if (typeof katex !== 'undefined') {
                        katex.render(formula, span, {
                            throwOnError: false,
                            displayMode: isDisplay
                        });
                        fragments.push(span);
                        processedCount++;
                    } else {
                        // KaTeX 不可用，保留原文
                        fragments.push(document.createTextNode(match[0]));
                    }
                } catch (error) {
                    console.warn('[FormulaPostProcessor] 渲染公式失败:', formula, error);
                    // 渲染失败，保留原文
                    fragments.push(document.createTextNode(match[0]));
                }

                lastIndex = formulaRegex.lastIndex;
            }

            // 添加剩余文本
            if (lastIndex < text.length) {
                fragments.push(document.createTextNode(text.substring(lastIndex)));
            }

            // 替换原文本节点
            if (fragments.length > 0) {
                const parent = textNode.parentNode;
                if (parent) {
                    fragments.forEach(fragment => {
                        parent.insertBefore(fragment, textNode);
                    });
                    parent.removeChild(textNode);
                }
            }
        }

        // 开始处理
        processNode(rootElement);

        const duration = performance.now() - startTime;
        console.log(`[FormulaPostProcessor] 处理完成: 渲染 ${processedCount} 个公式, 删除 ${removedCount} 个错误块, 耗时 ${duration.toFixed(2)}ms`);

        return { processedCount, removedCount };
    }

    // 导出到全局
    global.FormulaPostProcessor = {
        processFormulasInElement: processFormulasInElement,
        version: '1.0.0'
    };

    console.log('[FormulaPostProcessor] Formula post processor loaded.');

})(window);

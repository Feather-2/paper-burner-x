/**
 * LaTeX to OMML (Office Math Markup Language) Converter
 * 用于在 PPTX 中嵌入原生可编辑的数学公式
 */

class MathConverter {
    constructor() {
        // MathML to OMML 转换的 XSLT（简化版本，覆盖常用情况）
        this.initialized = false;
    }

    /**
     * 将 LaTeX 转换为 MathML
     * 使用 KaTeX 的 MathML 输出
     */
    latexToMathML(latex) {
        if (!latex) return null;
        
        try {
            // KaTeX 支持输出 MathML
            if (typeof katex !== 'undefined') {
                const html = katex.renderToString(latex, {
                    output: 'mathml',
                    throwOnError: false,
                    displayMode: true,
                });
                // 提取 <math> 标签
                const match = html.match(/<math[^>]*>[\s\S]*<\/math>/i);
                return match ? match[0] : null;
            }
        } catch (e) {
            console.warn('[MathConverter] KaTeX MathML error:', e);
        }
        return null;
    }

    /**
     * 将 MathML 转换为 OMML
     * OMML 是 Office 的原生数学公式格式
     */
    mathMLToOMML(mathml) {
        if (!mathml) return null;

        try {
            // 解析 MathML
            const parser = new DOMParser();
            const doc = parser.parseFromString(mathml, 'text/xml');
            const mathNode = doc.querySelector('math');
            
            if (!mathNode) return null;

            // 转换为 OMML
            return this._convertMathToOMML(mathNode);
        } catch (e) {
            console.warn('[MathConverter] MathML to OMML error:', e);
            return null;
        }
    }

    /**
     * 直接将 LaTeX 转换为 OMML
     */
    latexToOMML(latex) {
        const mathml = this.latexToMathML(latex);
        if (!mathml) {
            // Fallback: 直接生成简单的 OMML
            return this._latexToOMMLDirect(latex);
        }
        return this.mathMLToOMML(mathml);
    }

    /**
     * 递归转换 MathML 节点到 OMML
     */
    _convertMathToOMML(mathNode) {
        const omml = [];
        omml.push('<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">');
        
        this._processChildren(mathNode, omml);
        
        omml.push('</m:oMath>');
        return omml.join('');
    }

    _processChildren(node, omml) {
        for (const child of node.childNodes) {
            this._processNode(child, omml);
        }
    }

    _processNode(node, omml) {
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent.trim();
            if (text) {
                omml.push(`<m:r><m:t>${this._escapeXml(text)}</m:t></m:r>`);
            }
            return;
        }

        if (node.nodeType !== Node.ELEMENT_NODE) return;

        const tagName = node.localName || node.tagName.replace(/^[^:]+:/, '');

        switch (tagName) {
            case 'math':
            case 'mrow':
            case 'mstyle':
            case 'semantics':
                this._processChildren(node, omml);
                break;

            case 'mi': // 标识符（变量）
            case 'mn': // 数字
            case 'mo': // 运算符
            case 'mtext': // 文本
                const text = node.textContent;
                if (tagName === 'mi' && text.length === 1) {
                    // 单字母变量用斜体
                    omml.push(`<m:r><m:rPr><m:sty m:val="i"/></m:rPr><m:t>${this._escapeXml(text)}</m:t></m:r>`);
                } else {
                    omml.push(`<m:r><m:t>${this._escapeXml(text)}</m:t></m:r>`);
                }
                break;

            case 'msup': // 上标
                omml.push('<m:sSup>');
                omml.push('<m:e>');
                this._processNode(node.children[0], omml);
                omml.push('</m:e>');
                omml.push('<m:sup>');
                this._processNode(node.children[1], omml);
                omml.push('</m:sup>');
                omml.push('</m:sSup>');
                break;

            case 'msub': // 下标
                omml.push('<m:sSub>');
                omml.push('<m:e>');
                this._processNode(node.children[0], omml);
                omml.push('</m:e>');
                omml.push('<m:sub>');
                this._processNode(node.children[1], omml);
                omml.push('</m:sub>');
                omml.push('</m:sSub>');
                break;

            case 'msubsup': // 上下标
                omml.push('<m:sSubSup>');
                omml.push('<m:e>');
                this._processNode(node.children[0], omml);
                omml.push('</m:e>');
                omml.push('<m:sub>');
                this._processNode(node.children[1], omml);
                omml.push('</m:sub>');
                omml.push('<m:sup>');
                this._processNode(node.children[2], omml);
                omml.push('</m:sup>');
                omml.push('</m:sSubSup>');
                break;

            case 'mfrac': // 分数
                omml.push('<m:f>');
                omml.push('<m:num>');
                this._processNode(node.children[0], omml);
                omml.push('</m:num>');
                omml.push('<m:den>');
                this._processNode(node.children[1], omml);
                omml.push('</m:den>');
                omml.push('</m:f>');
                break;

            case 'msqrt': // 平方根
                omml.push('<m:rad>');
                omml.push('<m:radPr><m:degHide m:val="1"/></m:radPr>');
                omml.push('<m:deg/>');
                omml.push('<m:e>');
                this._processChildren(node, omml);
                omml.push('</m:e>');
                omml.push('</m:rad>');
                break;

            case 'mroot': // n次根
                omml.push('<m:rad>');
                omml.push('<m:deg>');
                this._processNode(node.children[1], omml);
                omml.push('</m:deg>');
                omml.push('<m:e>');
                this._processNode(node.children[0], omml);
                omml.push('</m:e>');
                omml.push('</m:rad>');
                break;

            case 'mover': // 上方符号（如向量箭头）
                omml.push('<m:acc>');
                omml.push('<m:accPr><m:chr m:val="̂"/></m:accPr>'); // 默认用 hat
                omml.push('<m:e>');
                this._processNode(node.children[0], omml);
                omml.push('</m:e>');
                omml.push('</m:acc>');
                break;

            case 'munder': // 下方符号
                omml.push('<m:groupChr>');
                omml.push('<m:groupChrPr><m:pos m:val="bot"/></m:groupChrPr>');
                omml.push('<m:e>');
                this._processNode(node.children[0], omml);
                omml.push('</m:e>');
                omml.push('</m:groupChr>');
                break;

            case 'mtable': // 矩阵/表格
                omml.push('<m:m>');
                for (const row of node.children) {
                    if (row.localName === 'mtr' || row.tagName?.includes('mtr')) {
                        omml.push('<m:mr>');
                        for (const cell of row.children) {
                            omml.push('<m:e>');
                            this._processChildren(cell, omml);
                            omml.push('</m:e>');
                        }
                        omml.push('</m:mr>');
                    }
                }
                omml.push('</m:m>');
                break;

            case 'mfenced': // 括号
                const open = node.getAttribute('open') || '(';
                const close = node.getAttribute('close') || ')';
                omml.push('<m:d>');
                omml.push(`<m:dPr><m:begChr m:val="${this._escapeXml(open)}"/><m:endChr m:val="${this._escapeXml(close)}"/></m:dPr>`);
                omml.push('<m:e>');
                this._processChildren(node, omml);
                omml.push('</m:e>');
                omml.push('</m:d>');
                break;

            case 'mspace': // 空格
                omml.push('<m:r><m:t> </m:t></m:r>');
                break;

            case 'annotation':
            case 'annotation-xml':
                // 跳过注释
                break;

            default:
                // 未知标签，尝试处理子节点
                this._processChildren(node, omml);
                break;
        }
    }

    /**
     * 直接从 LaTeX 生成简单的 OMML（不经过 MathML）
     * 用于 KaTeX 不可用时的 fallback
     */
    _latexToOMMLDirect(latex) {
        if (!latex) return null;

        const omml = ['<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">'];
        
        // 简单的 LaTeX 解析
        let remaining = latex.trim();
        
        // 处理常见的 LaTeX 命令
        remaining = remaining
            .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, (_, num, den) => {
                return `<m:f><m:num><m:r><m:t>${this._escapeXml(num)}</m:t></m:r></m:num><m:den><m:r><m:t>${this._escapeXml(den)}</m:t></m:r></m:den></m:f>`;
            })
            .replace(/\\sqrt\{([^}]+)\}/g, (_, content) => {
                return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e><m:r><m:t>${this._escapeXml(content)}</m:t></m:r></m:e></m:rad>`;
            })
            .replace(/\^{([^}]+)}/g, (_, sup) => `<m:sSup><m:e></m:e><m:sup><m:r><m:t>${this._escapeXml(sup)}</m:t></m:r></m:sup></m:sSup>`)
            .replace(/_{([^}]+)}/g, (_, sub) => `<m:sSub><m:e></m:e><m:sub><m:r><m:t>${this._escapeXml(sub)}</m:t></m:r></m:sub></m:sSub>`)
            .replace(/\\alpha/g, 'α')
            .replace(/\\beta/g, 'β')
            .replace(/\\gamma/g, 'γ')
            .replace(/\\delta/g, 'δ')
            .replace(/\\epsilon/g, 'ε')
            .replace(/\\theta/g, 'θ')
            .replace(/\\lambda/g, 'λ')
            .replace(/\\mu/g, 'μ')
            .replace(/\\pi/g, 'π')
            .replace(/\\sigma/g, 'σ')
            .replace(/\\omega/g, 'ω')
            .replace(/\\infty/g, '∞')
            .replace(/\\sum/g, '∑')
            .replace(/\\prod/g, '∏')
            .replace(/\\int/g, '∫')
            .replace(/\\partial/g, '∂')
            .replace(/\\nabla/g, '∇')
            .replace(/\\pm/g, '±')
            .replace(/\\times/g, '×')
            .replace(/\\div/g, '÷')
            .replace(/\\leq/g, '≤')
            .replace(/\\geq/g, '≥')
            .replace(/\\neq/g, '≠')
            .replace(/\\approx/g, '≈')
            .replace(/\\cdot/g, '·')
            .replace(/\\ldots/g, '…')
            .replace(/\\rightarrow/g, '→')
            .replace(/\\leftarrow/g, '←')
            .replace(/\\Rightarrow/g, '⇒')
            .replace(/\\Leftarrow/g, '⇐');

        // 如果还有未处理的文本，直接添加
        if (!remaining.includes('<m:')) {
            omml.push(`<m:r><m:t>${this._escapeXml(remaining)}</m:t></m:r>`);
        } else {
            omml.push(remaining);
        }

        omml.push('</m:oMath>');
        return omml.join('');
    }

    _escapeXml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    /**
     * 生成 PPTX 中的公式段落 XML
     * 这个 XML 片段可以嵌入到 slide 的 <a:p> 中
     */
    generateOMLParagraph(latex, options = {}) {
        const omml = this.latexToOMML(latex);
        if (!omml) return null;

        const fontSize = options.fontSize || 2400; // EMUs (24pt = 2400)
        const color = options.color || '000000';

        // 包装成 PowerPoint 段落格式
        return `
            <a:p>
                <a:pPr algn="${options.align || 'ctr'}"/>
                <a14:m xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main">
                    <m:oMathPara xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
                        <m:oMathParaPr>
                            <m:jc m:val="${options.align || 'center'}"/>
                        </m:oMathParaPr>
                        ${omml}
                    </m:oMathPara>
                </a14:m>
            </a:p>
        `.replace(/\s+/g, ' ').trim();
    }
}

// 导出
if (typeof window !== 'undefined') {
    window.MathConverter = MathConverter;
}
if (typeof module !== 'undefined') {
    module.exports = MathConverter;
}

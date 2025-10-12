/**
 * DOCX MathML to OMML 转换器模块
 * 将 MathML 格式转换为 Word 的 OMML (Office Math Markup Language) 格式
 */

(function(window) {
  'use strict';

  /**
   * MathML 到 OMML 转换器类
   * 支持常见的数学元素，包括上下标、分数、根式等
   */
  class MathMlToOmmlConverter {
    /**
     * 转换 MathML 元素为 OMML
     * @param {Element} mathEl - MathML math 元素
     * @returns {string} OMML XML 字符串
     */
    convert(mathEl) {
      if (!mathEl) return '';
      try {
        const inner = this.convertChildren(mathEl.childNodes);
        if (!inner || !inner.trim()) return '';
        // 验证生成的 OMML 不包含非法字符
        const sanitized = this.sanitizeOmml(inner);
        if (!sanitized) return '';
        return `<m:oMath>${sanitized}</m:oMath>`;
      } catch (error) {
        console.warn('MathML to OMML conversion failed:', error);
        return '';
      }
    }

    /**
     * 清理 OMML 内容，移除非法字符
     * @param {string} omml - OMML 字符串
     * @returns {string} 清理后的 OMML
     */
    sanitizeOmml(omml) {
      if (!omml) return '';
      // 移除控制字符，但保留换行符和制表符
      return String(omml).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F]/g, '');
    }

    /**
     * 转换子节点列表
     * @param {NodeList} nodeList - 子节点列表
     * @returns {string} 转换后的 OMML
     */
    convertChildren(nodeList) {
      let result = '';
      try {
        Array.from(nodeList || []).forEach(node => {
          const converted = this.convertNode(node);
          if (converted) result += converted;
        });
      } catch (error) {
        console.warn('Error converting MathML children:', error);
      }
      return result;
    }

    /**
     * 转换单个节点
     * @param {Node} node - DOM 节点
     * @returns {string} 转换后的 OMML
     */
    convertNode(node) {
      if (!node) return '';
      try {
        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent;
          if (!text || !text.trim()) return '';
          return this.createTextRun(text.trim());
        }
        if (node.nodeType !== Node.ELEMENT_NODE) {
          return '';
        }
        const tag = node.tagName.toLowerCase();
        const childNodes = node.childNodes;

        // 为所有可能访问 childNodes 的情况添加边界检查
        switch (tag) {
          case 'math':
            return this.convertChildren(childNodes);
          case 'mrow':
          case 'semantics':
            return this.convertChildren(childNodes);
          case 'annotation':
            return '';
          case 'mi':
          case 'mn':
          case 'mo':
          case 'mtext':
            return this.createTextRun(node.textContent || '');
          case 'msup':
            if (childNodes.length < 2) return this.convertChildren(childNodes);
            return `<m:sSup>${this.wrapWith('m:e', this.convertNode(childNodes[0]))}${this.wrapWith('m:sup', this.convertNode(childNodes[1]))}</m:sSup>`;
          case 'msub':
            if (childNodes.length < 2) return this.convertChildren(childNodes);
            return `<m:sSub>${this.wrapWith('m:e', this.convertNode(childNodes[0]))}${this.wrapWith('m:sub', this.convertNode(childNodes[1]))}</m:sSub>`;
          case 'msubsup':
            if (childNodes.length < 3) return this.convertChildren(childNodes);
            return `<m:sSubSup>${this.wrapWith('m:e', this.convertNode(childNodes[0]))}${this.wrapWith('m:sub', this.convertNode(childNodes[1]))}${this.wrapWith('m:sup', this.convertNode(childNodes[2]))}</m:sSubSup>`;
          case 'mfrac':
            if (childNodes.length < 2) return this.convertChildren(childNodes);
            return `<m:f>${this.wrapWith('m:num', this.convertNode(childNodes[0]))}${this.wrapWith('m:den', this.convertNode(childNodes[1]))}</m:f>`;
          case 'msqrt':
            return `<m:rad><m:deg><m:degHide/></m:deg>${this.wrapWith('m:e', this.convertChildren(childNodes))}</m:rad>`;
          case 'mroot':
            if (childNodes.length < 2) return this.convertChildren(childNodes);
            return `<m:rad>${this.wrapWith('m:deg', this.convertNode(childNodes[1]))}${this.wrapWith('m:e', this.convertNode(childNodes[0]))}</m:rad>`;
          case 'mfenced':
            return `${this.createTextRun('(')}${this.convertChildren(childNodes)}${this.createTextRun(')')}`;
          case 'mover':
            if (childNodes.length < 2) return this.convertChildren(childNodes);
            return `<m:sSup>${this.wrapWith('m:e', this.convertNode(childNodes[0]))}${this.wrapWith('m:sup', this.convertNode(childNodes[1]))}</m:sSup>`;
          case 'munder':
            if (childNodes.length < 2) return this.convertChildren(childNodes);
            return `<m:sSub>${this.wrapWith('m:e', this.convertNode(childNodes[0]))}${this.wrapWith('m:sub', this.convertNode(childNodes[1]))}</m:sSub>`;
          case 'munderover':
            if (childNodes.length < 3) return this.convertChildren(childNodes);
            return `<m:sSubSup>${this.wrapWith('m:e', this.convertNode(childNodes[0]))}${this.wrapWith('m:sub', this.convertNode(childNodes[1]))}${this.wrapWith('m:sup', this.convertNode(childNodes[2]))}</m:sSubSup>`;
          default:
            return this.convertChildren(childNodes);
        }
      } catch (error) {
        console.warn('Error converting MathML node:', error);
        return '';
      }
    }

    /**
     * 用标签包裹内容
     * @param {string} tag - 标签名
     * @param {string} content - 内容
     * @returns {string} 包裹后的 XML
     */
    wrapWith(tag, content) {
      if (!content || !content.trim()) {
        // 空内容时返回空格占位，防止生成空标签
        return `<${tag}>${this.createTextRun(' ')}</${tag}>`;
      }
      return `<${tag}>${content}</${tag}>`;
    }

    /**
     * 创建文本运行
     * @param {string} text - 文本内容
     * @returns {string} OMML 文本运行 XML
     */
    createTextRun(text) {
      const normalized = text ? text.replace(/\s+/g, ' ').trim() : '';
      if (!normalized) {
        // 返回一个空格，而不是空字符串
        return '<m:r><m:t xml:space="preserve"> </m:t></m:r>';
      }
      // 使用全局的 escapeXml 函数
      const escapeXml = window.PBXDocxXmlUtils?.escapeXml || function(str) {
        if (!str) return '';
        let result = String(str);
        result = result.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F]/g, '');
        return result.replace(/[&<>"']/g, function(ch) {
          switch (ch) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            case "'": return '&#39;';
            default: return ch;
          }
        });
      };
      return `<m:r><m:t xml:space="preserve">${escapeXml(normalized)}</m:t></m:r>`;
    }
  }

  // 导出到全局
  window.PBXMathMlToOmmlConverter = MathMlToOmmlConverter;

})(window);

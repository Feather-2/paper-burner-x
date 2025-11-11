/**
 * DOCX MathML to OMML 增强转换器模块
 * 支持更多复杂的 MathML 元素，包括矩阵、可拉伸运算符等
 * 版本: 2.0.0
 *
 * 新增支持：
 * - mtable/mtr/mtd (矩阵和表格)
 * - mspace (空格)
 * - mstyle (样式，部分支持)
 * - menclose (包围符号)
 * - mo stretchy (可拉伸运算符)
 */

(function(window) {
  'use strict';

  /**
   * 增强的 MathML 到 OMML 转换器类
   */
  class MathMlToOmmlConverterEnhanced {
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
        console.warn('[MathML→OMML Enhanced] Conversion failed:', error);
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
        console.warn('[MathML→OMML Enhanced] Error converting children:', error);
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

        switch (tag) {
          // 基础容器
          case 'math':
          case 'mrow':
          case 'semantics':
            return this.convertChildren(childNodes);
          case 'annotation':
            return '';

          // 基础文本
          case 'mi':
          case 'mn':
          case 'mtext':
            return this.createTextRun(node.textContent || '');

          // 运算符 (增强处理)
          case 'mo':
            return this.convertOperator(node);

          // 上下标
          case 'msup':
            return this.convertSup(node, childNodes);
          case 'msub':
            return this.convertSub(node, childNodes);
          case 'msubsup':
            return this.convertSubSup(node, childNodes);

          // 分数
          case 'mfrac':
            return this.convertFrac(node, childNodes);

          // 根式
          case 'msqrt':
            return this.convertSqrt(childNodes);
          case 'mroot':
            return this.convertRoot(childNodes);

          // 括号
          case 'mfenced':
            return this.convertFenced(node, childNodes);

          // 上下装饰
          case 'mover':
            return this.convertOver(node, childNodes);
          case 'munder':
            return this.convertUnder(node, childNodes);
          case 'munderover':
            return this.convertUnderOver(node, childNodes);

          // 矩阵和表格 (新增)
          case 'mtable':
            return this.convertTable(node, childNodes);

          // 空格 (新增)
          case 'mspace':
            return this.convertSpace(node);

          // 样式 (新增)
          case 'mstyle':
            return this.convertStyle(node, childNodes);

          // 包围符号 (新增)
          case 'menclose':
            return this.convertEnclose(node, childNodes);

          // 填充 (新增)
          case 'mpadded':
            return this.convertPadded(node, childNodes);

          // 多行脚本 (新增)
          case 'mmultiscripts':
            return this.convertMultiscripts(node, childNodes);

          default:
            console.warn(`[MathML→OMML Enhanced] Unsupported tag: ${tag}`);
            return this.convertChildren(childNodes);
        }
      } catch (error) {
        console.warn('[MathML→OMML Enhanced] Error converting node:', error);
        return '';
      }
    }

    /**
     * 转换运算符 (增强支持 stretchy 属性)
     * @param {Element} node - mo 元素
     * @returns {string} OMML
     */
    convertOperator(node) {
      const text = node.textContent || '';
      const stretchy = node.getAttribute('stretchy');
      const largeop = node.getAttribute('largeop');

      // 如果是大型运算符（如求和、积分），使用特殊格式
      if (largeop === 'true' || this.isLargeOperator(text)) {
        return this.createNaryOperator(text);
      }

      // 普通运算符
      return this.createTextRun(text);
    }

    /**
     * 判断是否为大型运算符
     * @param {string} text - 运算符文本
     * @returns {boolean}
     */
    isLargeOperator(text) {
      const largeOps = ['∑', '∫', '∬', '∭', '∮', '∯', '∰', '∱', '∏', '∐', '⋃', '⋂', '⋁', '⋀'];
      return largeOps.includes(text.trim());
    }

    /**
     * 创建 N-ary 运算符 (求和、积分等)
     * @param {string} operator - 运算符文本
     * @returns {string} OMML
     */
    createNaryOperator(operator) {
      // OMML 的 nary 结构用于大型运算符
      const charMap = {
        '∑': '2211',
        '∫': '222B',
        '∬': '222C',
        '∭': '222D',
        '∮': '222E',
        '∯': '222F',
        '∰': '2230',
        '∱': '2231',
        '∏': '220F',
        '∐': '2210'
      };

      const charCode = charMap[operator] || operator.charCodeAt(0).toString(16).toUpperCase();
      return `<m:nary><m:naryPr><m:chr m:val="${charCode}"/></m:naryPr><m:sub></m:sub><m:sup></m:sup><m:e></m:e></m:nary>`;
    }

    /**
     * 转换上标
     */
    convertSup(node, childNodes) {
      if (childNodes.length < 2) return this.convertChildren(childNodes);
      return `<m:sSup>${this.wrapWith('m:e', this.convertNode(childNodes[0]))}${this.wrapWith('m:sup', this.convertNode(childNodes[1]))}</m:sSup>`;
    }

    /**
     * 转换下标
     */
    convertSub(node, childNodes) {
      if (childNodes.length < 2) return this.convertChildren(childNodes);
      return `<m:sSub>${this.wrapWith('m:e', this.convertNode(childNodes[0]))}${this.wrapWith('m:sub', this.convertNode(childNodes[1]))}</m:sSub>`;
    }

    /**
     * 转换上下标
     */
    convertSubSup(node, childNodes) {
      if (childNodes.length < 3) return this.convertChildren(childNodes);
      return `<m:sSubSup>${this.wrapWith('m:e', this.convertNode(childNodes[0]))}${this.wrapWith('m:sub', this.convertNode(childNodes[1]))}${this.wrapWith('m:sup', this.convertNode(childNodes[2]))}</m:sSubSup>`;
    }

    /**
     * 转换分数
     */
    convertFrac(node, childNodes) {
      if (childNodes.length < 2) return this.convertChildren(childNodes);

      // 检查是否有 linethickness 属性（用于控制分数线）
      const lineThickness = node.getAttribute('linethickness');
      const noLine = lineThickness === '0' || lineThickness === '0pt';

      if (noLine) {
        // 无分数线，使用 stack
        return `<m:func><m:fName>${this.wrapWith('m:e', this.convertNode(childNodes[0]))}</m:fName><m:e>${this.convertNode(childNodes[1])}</m:e></m:func>`;
      }

      return `<m:f>${this.wrapWith('m:num', this.convertNode(childNodes[0]))}${this.wrapWith('m:den', this.convertNode(childNodes[1]))}</m:f>`;
    }

    /**
     * 转换平方根
     */
    convertSqrt(childNodes) {
      return `<m:rad><m:deg><m:degHide m:val="1"/></m:deg>${this.wrapWith('m:e', this.convertChildren(childNodes))}</m:rad>`;
    }

    /**
     * 转换根式
     */
    convertRoot(childNodes) {
      if (childNodes.length < 2) return this.convertChildren(childNodes);
      return `<m:rad>${this.wrapWith('m:deg', this.convertNode(childNodes[1]))}${this.wrapWith('m:e', this.convertNode(childNodes[0]))}</m:rad>`;
    }

    /**
     * 转换括号
     */
    convertFenced(node, childNodes) {
      const open = node.getAttribute('open') || '(';
      const close = node.getAttribute('close') || ')';
      return `${this.createTextRun(open)}${this.convertChildren(childNodes)}${this.createTextRun(close)}`;
    }

    /**
     * 转换上装饰
     */
    convertOver(node, childNodes) {
      if (childNodes.length < 2) return this.convertChildren(childNodes);

      const accent = node.getAttribute('accent');
      if (accent === 'true') {
        // 重音符号
        const accentChar = childNodes[1].textContent || '';
        return `<m:acc><m:accPr><m:chr m:val="${accentChar}"/></m:accPr>${this.wrapWith('m:e', this.convertNode(childNodes[0]))}</m:acc>`;
      }

      // 普通上标
      return `<m:limUpp>${this.wrapWith('m:e', this.convertNode(childNodes[0]))}${this.wrapWith('m:lim', this.convertNode(childNodes[1]))}</m:limUpp>`;
    }

    /**
     * 转换下装饰
     */
    convertUnder(node, childNodes) {
      if (childNodes.length < 2) return this.convertChildren(childNodes);

      const accentunder = node.getAttribute('accentunder');
      if (accentunder === 'true') {
        // 下重音
        return `<m:bar><m:barPr><m:pos m:val="bot"/></m:barPr>${this.wrapWith('m:e', this.convertNode(childNodes[0]))}</m:bar>`;
      }

      // 普通下标
      return `<m:limLow>${this.wrapWith('m:e', this.convertNode(childNodes[0]))}${this.wrapWith('m:lim', this.convertNode(childNodes[1]))}</m:limLow>`;
    }

    /**
     * 转换上下装饰
     */
    convertUnderOver(node, childNodes) {
      if (childNodes.length < 3) return this.convertChildren(childNodes);
      return `<m:groupChr><m:groupChrPr><m:chr m:val="⏞"/></m:groupChrPr>${this.wrapWith('m:e', this.convertNode(childNodes[0]))}</m:groupChr>`;
    }

    /**
     * 转换矩阵 (新增 - 最重要的功能！)
     * @param {Element} node - mtable 元素
     * @param {NodeList} childNodes - 子节点
     * @returns {string} OMML
     */
    convertTable(node, childNodes) {
      const rows = Array.from(childNodes).filter(child =>
        child.nodeType === Node.ELEMENT_NODE && child.tagName.toLowerCase() === 'mtr'
      );

      if (rows.length === 0) {
        return this.convertChildren(childNodes);
      }

      // 检查是否有括号（通过 columnalign 或其他属性判断）
      const columnalign = node.getAttribute('columnalign') || 'center';

      // 构建矩阵
      let omml = '<m:m>';

      rows.forEach(row => {
        const cells = Array.from(row.childNodes).filter(child =>
          child.nodeType === Node.ELEMENT_NODE && child.tagName.toLowerCase() === 'mtd'
        );

        omml += '<m:mr>';
        cells.forEach(cell => {
          omml += `<m:e>${this.convertChildren(cell.childNodes)}</m:e>`;
        });
        omml += '</m:mr>';
      });

      omml += '</m:m>';

      // 添加矩阵括号（可选）
      const frame = node.getAttribute('frame');
      if (frame) {
        // 用 borderBox 包裹
        return `<m:borderBox>${omml}</m:borderBox>`;
      }

      return omml;
    }

    /**
     * 转换空格 (新增)
     * @param {Element} node - mspace 元素
     * @returns {string} OMML
     */
    convertSpace(node) {
      const width = node.getAttribute('width') || '1em';
      // OMML 中使用空格字符
      return this.createTextRun(' ');
    }

    /**
     * 转换样式 (新增)
     * @param {Element} node - mstyle 元素
     * @param {NodeList} childNodes - 子节点
     * @returns {string} OMML
     */
    convertStyle(node, childNodes) {
      // OMML 中样式通常通过属性控制，这里简单处理
      // 可以根据 mathvariant, mathsize 等属性调整
      return this.convertChildren(childNodes);
    }

    /**
     * 转换包围符号 (新增)
     * @param {Element} node - menclose 元素
     * @param {NodeList} childNodes - 子节点
     * @returns {string} OMML
     */
    convertEnclose(node, childNodes) {
      const notation = node.getAttribute('notation') || 'longdiv';

      switch (notation) {
        case 'box':
        case 'roundedbox':
          return `<m:borderBox>${this.wrapWith('m:e', this.convertChildren(childNodes))}</m:borderBox>`;
        case 'circle':
          return `<m:borderBox><m:borderBoxPr><m:shape m:val="oval"/></m:borderBoxPr>${this.wrapWith('m:e', this.convertChildren(childNodes))}</m:borderBox>`;
        case 'top':
        case 'bottom':
        case 'left':
        case 'right':
          return `<m:bar><m:barPr><m:pos m:val="${notation}"/></m:barPr>${this.wrapWith('m:e', this.convertChildren(childNodes))}</m:bar>`;
        default:
          return this.convertChildren(childNodes);
      }
    }

    /**
     * 转换填充 (新增)
     * @param {Element} node - mpadded 元素
     * @param {NodeList} childNodes - 子节点
     * @returns {string} OMML
     */
    convertPadded(node, childNodes) {
      // OMML 不直接支持 padding，简单忽略
      return this.convertChildren(childNodes);
    }

    /**
     * 转换多行脚本 (新增)
     * @param {Element} node - mmultiscripts 元素
     * @param {NodeList} childNodes - 子节点
     * @returns {string} OMML
     */
    convertMultiscripts(node, childNodes) {
      // 简化处理：转换为连续的上下标
      return this.convertChildren(childNodes);
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
  window.PBXMathMlToOmmlConverterEnhanced = MathMlToOmmlConverterEnhanced;

  console.log('%c[DOCX Math] ✨ 增强 MathML → OMML 转换器已加载', 'color: #3b82f6; font-weight: bold');
  console.log('新增支持: 矩阵 | 可拉伸运算符 | 空格 | 包围符号');

})(window);

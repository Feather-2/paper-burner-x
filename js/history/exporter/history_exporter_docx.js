(function(window) {
  const DEFAULT_BRAND_LINK = 'https://github.com/Feather-2/paper-burner-x';


async function exportAsDocx(payload, options = {}, helpers = {}) {
    const JSZipRef = window.JSZip;
    if (typeof JSZipRef !== 'function') {
      throw new Error('JSZip 组件未加载，无法导出 DOCX');
    }

    const builder = new DocxDocumentBuilder(payload, options, helpers);
    const docxResult = builder.build();

    // 验证生成的 XML 是否有效
    if (options.validateXml !== false) {
      try {
        validateXmlStructure(docxResult.documentXml);
        console.log('✓ Document XML validation passed');

        // 额外检查：搜索未转义的 &
        const unescapedAmpMatch = docxResult.documentXml.match(/<w:t[^>]*>[^<]*&(?!amp;|lt;|gt;|quot;|apos;|#)[^<]*<\/w:t>/);
        if (unescapedAmpMatch) {
          console.error('❌ WARNING: Found unescaped & in final XML:', unescapedAmpMatch[0]);
        } else {
          console.log('✓ No unescaped & in final XML');
        }
      } catch (error) {
        console.error('✗ Document XML validation failed:', error);
        if (options.debug) {
          // 在调试模式下，将有问题的 XML 保存到控制台
          console.log('Generated XML (first 5000 chars):', docxResult.documentXml.substring(0, 5000));
        }
        // 不抛出错误，允许继续导出，但警告用户
        console.warn('⚠ 继续导出，但文件可能无法正常打开');
      }
    }

    // 额外验证其他 XML 文件
    try {
      const contentTypesXml = buildContentTypesXml(docxResult.mediaExtensions);
      const relsXml = buildDocumentRelsXml(docxResult.relationships);
      validateBasicXml(contentTypesXml, '[Content_Types].xml');
      validateBasicXml(relsXml, 'document.xml.rels');
      console.log('✓ All XML files validation passed');
    } catch (error) {
      console.error('✗ XML file validation failed:', error);
    }

    const zip = new JSZipRef();
    const now = new Date();
    const iso = now.toISOString();

    zip.file('[Content_Types].xml', buildContentTypesXml(docxResult.mediaExtensions));
    zip.folder('_rels').file('.rels', buildPackageRelsXml());

    const docProps = zip.folder('docProps');
    docProps.file('core.xml', buildCorePropsXml(payload, iso));
    docProps.file('app.xml', buildAppPropsXml());

    const wordFolder = zip.folder('word');
    wordFolder.file('document.xml', docxResult.documentXml);
    wordFolder.file('styles.xml', buildStylesXml());
    if (docxResult.footerXml && docxResult.footerFileName) {
      wordFolder.file(docxResult.footerFileName, docxResult.footerXml);
    }
    wordFolder.folder('_rels').file('document.xml.rels', buildDocumentRelsXml(docxResult.relationships));

    if (docxResult.mediaFiles.length > 0) {
      const mediaFolder = wordFolder.folder('media');
      docxResult.mediaFiles.forEach(function(file) {
        mediaFolder.file(file.fileName, file.data, { base64: true });
      });
    }

    const docxBlob = await zip.generateAsync({ type: 'blob' });
    const resolveFileNameFn = typeof helpers.resolveFileName === 'function' ? helpers.resolveFileName : resolveFileName;
    const fileName = resolveFileNameFn(payload, 'docx', options);
    if (options.returnBlob) {
      return {
        fileName,
        blob: docxBlob
      };
    }
    if (typeof saveAs !== 'function') {
      throw new Error('文件保存组件不可用');
    }
    saveAs(docxBlob, fileName);
  }



const HEADING_OUTLINE_LEVELS = {
    Heading1: 0,
    Heading2: 1,
    Heading3: 2,
    Heading4: 3,
    Heading5: 4,
    Heading6: 5
  };

  class DocxDocumentBuilder {
    constructor(payload, options = {}, helpers = {}) {
      this.helpers = Object.assign({ BRAND_LINK: DEFAULT_BRAND_LINK }, helpers || {});
      this.brandLink = this.helpers.BRAND_LINK || DEFAULT_BRAND_LINK;
      this.payload = payload;
      this.options = Object.assign({}, options);
      this.relationships = [];
      this.mediaFiles = [];
      this.mediaExtensions = new Set();
      this.relIdCounter = 1;
      this.imageCounter = 1;
      this.drawingCounter = 1;
      // 优先使用专业的 mathml2omml 库，否则使用增强转换器，最后回退到基础版本
      if (window.mml2omml) {
        this.mathConverter = {
          convert: function(mathEl) {
            if (!mathEl) return '';
            try {
              // 克隆元素以避免修改原始 DOM
              const cloned = mathEl.cloneNode(true);

              // 清理不支持的元素：移除 <annotation> 元素（语义标注）
              const annotations = cloned.querySelectorAll('annotation, annotation-xml');
              annotations.forEach(ann => ann.remove());

              // 清理不支持的元素：展开 <mpadded> 元素（保留内容，移除包装器）
              const mpaddeds = cloned.querySelectorAll('mpadded');
              mpaddeds.forEach(mpad => {
                // 将子元素移到父元素中
                const parent = mpad.parentNode;
                if (parent) {
                  while (mpad.firstChild) {
                    parent.insertBefore(mpad.firstChild, mpad);
                  }
                  parent.removeChild(mpad);
                }
              });

              // 序列化 MathML 元素为字符串
              const serializer = new XMLSerializer();
              const mathmlString = serializer.serializeToString(cloned);

              // 调用 mathml2omml
              const omml = window.mml2omml(mathmlString);
              return omml;
            } catch (error) {
              console.warn('[DOCX] mathml2omml 转换失败:', error);
              return '';
            }
          }
        };
        console.log('🚀 使用专业 mathml2omml 库（已启用 MathML 清理）');
      } else if (window.PBXMathMlToOmmlConverterEnhanced) {
        this.mathConverter = new window.PBXMathMlToOmmlConverterEnhanced();
        console.log('✨ 使用增强 MathML → OMML 转换器（支持矩阵、复杂运算符）');
      } else {
        this.mathConverter = new MathMlToOmmlConverter();
        console.log('ℹ️ 使用基础 MathML → OMML 转换器');
      }
      this.footerInfo = null;
      const initialImages = Array.isArray(payload && payload.images)
        ? payload.images
        : (payload && payload.data && Array.isArray(payload.data.images) ? payload.data.images : []);
      this.imageLookup = this.buildImageLookup(initialImages);

      const parser = new DOMParser();
      const wrapped = `<div>${payload.bodyHtml || ''}</div>`;
      this.dom = parser.parseFromString(wrapped, 'text/html');
      this.stripTableFormulas();
    }

    buildImageLookup(images = []) {
      const map = new Map();
      images.forEach((img, idx) => {
        if (!img || !img.data) return;
        const rawMime = img.mimeType || img.type || 'image/png';
        const safeMime = /^image\//i.test(rawMime) ? rawMime : `image/${String(rawMime || 'png').replace(/^image\//i, '')}`;
        const dataUri = img.data.startsWith('data:') ? img.data : `data:${safeMime};base64,${img.data}`;

        const baseKeys = new Set();
        if (img.name) baseKeys.add(String(img.name));
        if (img.id) baseKeys.add(String(img.id));
        if (img.originalName) baseKeys.add(String(img.originalName));
        if (img.fileName) baseKeys.add(String(img.fileName));
        if (img.path) baseKeys.add(String(img.path));
        baseKeys.add(`img-${idx}.jpeg.png`);
        baseKeys.add(`img-${idx + 1}.jpeg.png`);

        const variants = new Set();
        baseKeys.forEach(key => {
          if (!key) return;
          const trimmed = key.trim();
          if (!trimmed) return;
          variants.add(trimmed);
          variants.add(trimmed.replace(/^\.\/?/, '')); // remove leading ./
          variants.add(trimmed.replace(/^\.?\//, ''));
          variants.add(trimmed.replace(/^images\//i, ''));
          variants.add(trimmed.replace(/^\.\/images\//i, ''));
          variants.add(trimmed.replace(/^[.\/]+/, ''));
          const decoded = safeDecodeURIComponent(trimmed);
          if (decoded && decoded !== trimmed) {
            variants.add(decoded);
            variants.add(decoded.replace(/^images\//i, ''));
          }
          const lastSegment = trimmed.split(/[\\\/]/).pop();
          if (lastSegment) variants.add(lastSegment);
          variants.add(trimmed.toLowerCase());
          variants.add(trimmed.toUpperCase());
          variants.add(`images/${trimmed}`);
        });

        Array.from(variants).forEach(key => {
          if (!key) return;
          let normalized = key.trim();
          if (!normalized) return;
          if (!/\.(png|jpe?g|gif|webp)$/i.test(normalized)) {
            variants.add(`${normalized}.png`);
            variants.add(`${normalized}.jpg`);
            variants.add(`${normalized}.jpeg`);
          }
        });

        variants.forEach(key => {
          if (!key) return;
          const normalized = this.normalizeImageKey(key);
          if (!normalized) return;
          if (!map.has(normalized)) {
            map.set(normalized, dataUri);
          }
        });
      });
      return map;
    }

    normalizeImageKey(key) {
      if (!key) return '';
      const cleaned = String(key).trim();
      if (!cleaned) return '';
      const withoutQuery = cleaned.split('#')[0].split('?')[0];
      return withoutQuery.replace(/^\.\/?/, '').replace(/^\.\/images\//i, '').replace(/^images\//i, '').toLowerCase();
    }

    resolveImageData(src) {
      if (!src) return null;
      const trimmed = String(src).trim();
      if (!trimmed) return null;
      if (trimmed.startsWith('data:image')) {
        return trimmed;
      }
      const candidates = new Set();
      const decoded = safeDecodeURIComponent(trimmed);
      candidates.add(trimmed);
      if (decoded && decoded !== trimmed) candidates.add(decoded);

      const stripProtocols = value => value.replace(/^https?:\/\//i, '').replace(/^file:\/\//i, '');
      Array.from(candidates).forEach(value => {
        if (!value) return;
        const withoutProtocol = stripProtocols(value);
        candidates.add(withoutProtocol);
        candidates.add(withoutProtocol.replace(/^\.\/?/, ''));
        const last = withoutProtocol.split(/[\\\/]/).pop();
        if (last) candidates.add(last);
      });

      for (const candidate of candidates) {
        const normalized = this.normalizeImageKey(candidate);
        if (normalized && this.imageLookup.has(normalized)) {
          return this.imageLookup.get(normalized);
        }
      }
      return null;
    }

    build() {
      const bodyNodes = Array.from(this.dom.body.childNodes || []);
      const bodyParts = [];
      const rootContext = { maxWidthTwip: 9360 };

      // 添加错误计数器用于调试
      let conversionErrors = 0;
      const maxErrors = 100; // 限制错误数量，防止过多错误

      bodyNodes.forEach((node, index) => {
        try {
          const converted = this.convertBlock(node, rootContext);

          // 检查转换结果是否包含非法字符
          if (this.options.strictValidation) {
            for (const part of converted) {
              if (part && typeof part === 'string') {
                const illegalMatch = part.match(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F]/);
                if (illegalMatch) {
                  console.warn(`Illegal character found in block ${index}:`, illegalMatch[0].charCodeAt(0).toString(16));
                }
              }
            }
          }

          bodyParts.push(...converted);
        } catch (error) {
          conversionErrors++;
          if (conversionErrors <= maxErrors) {
            console.warn(`Error converting block ${index}:`, error, node);
          }
          // 发生错误时，添加一个空段落占位
          bodyParts.push('<w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>');
        }
      });

      if (conversionErrors > 0) {
        console.warn(`Total conversion errors: ${conversionErrors}`);
      }

      const footerInfo = this.ensureFooter();
      bodyParts.push(this.buildSectionProperties({ footerRelId: footerInfo && footerInfo.id }));

      const introParagraphs = this.buildIntroCardParagraphs();
      const bodyXml = introParagraphs.join('') + bodyParts.join('');
      const documentXml = this.wrapDocument(bodyXml);

      // 最终检查
      if (this.options.debug) {
        console.log(`Generated document size: ${documentXml.length} characters`);
        console.log(`Media files: ${this.mediaFiles.length}`);
        console.log(`Relationships: ${this.relationships.length}`);
      }

      return {
        documentXml,
        relationships: this.relationships,
        mediaFiles: this.mediaFiles,
        mediaExtensions: Array.from(this.mediaExtensions),
        footerXml: footerInfo && footerInfo.xml,
        footerFileName: footerInfo && footerInfo.fileName
      };
    }

    stripTableFormulas() {
      if (!this.dom) return;
      const tables = Array.from(this.dom.querySelectorAll('table'));
      if (!tables.length) return;
      tables.forEach(table => {
        const handled = new Set();
        const displayNodes = Array.from(table.querySelectorAll('.katex-display'));
        displayNodes.forEach(node => {
          handled.add(node);
          const mathEl = node.querySelector('math');
          const fallback = this.formatFormulaFallbackText(this.getFormulaFallbackText(node, mathEl));
          const textNode = this.dom.createTextNode(fallback || '');
          node.replaceWith(textNode);
        });
        const inlineNodes = Array.from(table.querySelectorAll('.katex'));
        inlineNodes.forEach(node => {
          if (handled.has(node) || node.closest('.katex-display')) return;
          const mathEl = node.querySelector('math');
          const fallback = this.formatFormulaFallbackText(this.getFormulaFallbackText(node, mathEl));
          const textNode = this.dom.createTextNode(fallback || '');
          node.replaceWith(textNode);
        });
      });
    }

    wrapDocument(bodyXml) {
      // 清理和验证 bodyXml
      const cleanedBody = this.sanitizeXmlContent(bodyXml);
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
${cleanedBody}
  </w:body>
</w:document>`;
    }

    sanitizeXmlContent(xmlStr) {
      if (!xmlStr) return '';

      console.log('🔧 sanitizeXmlContent called, input length:', xmlStr.length);

      let cleaned = String(xmlStr);

      // 调试：检查输入
      const hasUnescapedAmp = cleaned.match(/<w:t[^>]*>[^<]*&(?!amp;|lt;|gt;|quot;|apos;|#)[^<]*<\/w:t>/);
      if (hasUnescapedAmp) {
        console.warn('🔧 sanitizeXmlContent found unescaped & in <w:t>:', hasUnescapedAmp[0]);
      } else {
        console.log('✓ No unescaped & found in initial check');
      }

      // 移除 XML 非法控制字符
      cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F]/g, '');

      // 首先，最重要的：修复所有未转义的 & 符号
      // 使用临时占位符避免重复转义
      const AMP_PLACEHOLDER = '\u0001AMP\u0001';  // 使用不可能出现的字符作为占位符
      const LT_PLACEHOLDER = '\u0002LT\u0002';
      const GT_PLACEHOLDER = '\u0003GT\u0003';
      const QUOT_PLACEHOLDER = '\u0004QUOT\u0004';
      const APOS_PLACEHOLDER = '\u0005APOS\u0005';

      // 1. 保护已经正确转义的实体
      cleaned = cleaned.replace(/&amp;/g, AMP_PLACEHOLDER);
      cleaned = cleaned.replace(/&lt;/g, LT_PLACEHOLDER);
      cleaned = cleaned.replace(/&gt;/g, GT_PLACEHOLDER);
      cleaned = cleaned.replace(/&quot;/g, QUOT_PLACEHOLDER);
      cleaned = cleaned.replace(/&apos;/g, APOS_PLACEHOLDER);
      cleaned = cleaned.replace(/&#([0-9]+);/g, '\u0006NUM$1\u0006');
      cleaned = cleaned.replace(/&#x([0-9a-fA-F]+);/g, '\u0007HEX$1\u0007');

      // 2. 现在转义所有剩余的 & 符号（这些都是未转义的）
      cleaned = cleaned.replace(/&/g, '&amp;');

      // 3. 还原之前保护的实体
      cleaned = cleaned.replace(new RegExp(AMP_PLACEHOLDER, 'g'), '&amp;');
      cleaned = cleaned.replace(new RegExp(LT_PLACEHOLDER, 'g'), '&lt;');
      cleaned = cleaned.replace(new RegExp(GT_PLACEHOLDER, 'g'), '&gt;');
      cleaned = cleaned.replace(new RegExp(QUOT_PLACEHOLDER, 'g'), '&quot;');
      cleaned = cleaned.replace(new RegExp(APOS_PLACEHOLDER, 'g'), '&apos;');
      cleaned = cleaned.replace(/\u0006NUM([0-9]+)\u0006/g, '&#$1;');
      cleaned = cleaned.replace(/\u0007HEX([0-9a-fA-F]+)\u0007/g, '&#x$1;');

      // 调试：检查输出
      if (this.options.debug && hasUnescapedAmp) {
        const stillHasUnescaped = cleaned.match(/<w:t[^>]*>[^<]*&(?!amp;|lt;|gt;|quot;|apos;|#)[^<]*<\/w:t>/);
        if (stillHasUnescaped) {
          console.error('❌ sanitizeXmlContent FAILED to fix &:', stillHasUnescaped[0]);
        } else {
          console.log('✅ sanitizeXmlContent successfully fixed unescaped &');
        }
      }

      // 4. 移除可能的空 OMML 标签对
      cleaned = cleaned.replace(/<m:oMath>\s*<\/m:oMath>/g, '');
      cleaned = cleaned.replace(/<m:oMathPara>\s*<\/m:oMathPara>/g, '');

      // 5. 移除空的运行标签
      cleaned = cleaned.replace(/<w:r>\s*<\/w:r>/g, '');
      cleaned = cleaned.replace(/<w:r><w:rPr[^>]*\/><\/w:r>/g, '');

      // 6. 移除空的文本标签
      cleaned = cleaned.replace(/<w:t[^>]*>\s*<\/w:t>/g, '');

      // 7. 移除完全空的段落中的空 run（但保留段落本身）
      cleaned = cleaned.replace(/(<w:p[^>]*>)(<w:pPr[^>]*>.*?<\/w:pPr>)?<w:r><w:t[^>]*><\/w:t><\/w:r>(<\/w:p>)/g, '$1$2$3');

      return cleaned;
    }

    buildIntroCardParagraphs() {
      const info = collectIntroCardInfo(this.payload, this.helpers);
      const paragraphs = [];

      const sourceTitle = info.sourceTitle ? sanitizeCardLine(info.sourceTitle) : '';
      const modeLabel = info.modeLabel ? sanitizeCardLine(info.modeLabel) : '';
      const exportedAt = info.exportedAt ? sanitizeCardLine(info.exportedAt) : '';
      const recordId = info.recordId ? sanitizeCardLine(info.recordId) : '';

      const detailSegments = [];
      if (sourceTitle) {
        detailSegments.push(`原始文件：${sourceTitle}`);
      }
      if (modeLabel) {
        detailSegments.push(`导出模式：${modeLabel}`);
      }
      if (exportedAt) {
        detailSegments.push(`导出时间：${exportedAt}`);
      }
      if (recordId) {
        detailSegments.push(`记录 ID：${recordId}`);
      }

      let lineThree = detailSegments.shift() || (exportedAt ? `导出时间：${exportedAt}` : '');
      let lineFour = detailSegments.shift() || '';
      if (detailSegments.length) {
        const rest = detailSegments.join('  ·  ');
        if (lineFour) {
          lineFour += `  ·  ${rest}`;
        } else {
          lineFour = rest;
        }
      }
      lineThree = sanitizeCardLine((lineThree || '').trim());
      lineFour = sanitizeCardLine((lineFour || '').trim());

      if (!lineFour) {
        if (exportedAt && (!lineThree || !lineThree.includes('导出时间'))) {
          lineFour = `导出时间：${exportedAt}`;
        } else if (modeLabel && (!lineThree || !lineThree.includes('导出模式'))) {
          lineFour = `导出模式：${modeLabel}`;
        } else if (sourceTitle && (!lineThree || !lineThree.includes('原始文件'))) {
          lineFour = `原始文件：${sourceTitle}`;
        } else {
          lineFour = '未提供信息';
        }
      }

      if (!lineThree) {
        lineThree = lineFour;
      }

      if (lineFour === lineThree) {
        if (modeLabel && !lineThree.includes('导出模式')) {
          lineFour = `导出模式：${modeLabel}`;
        } else if (exportedAt && !lineThree.includes('导出时间')) {
          lineFour = `导出时间：${exportedAt}`;
        } else if (sourceTitle && !lineThree.includes('原始文件')) {
          lineFour = `原始文件：${sourceTitle}`;
        } else {
          lineFour = '未提供信息';
        }
      }

      lineThree = sanitizeCardLine(lineThree) || '未提供信息';
      lineFour = sanitizeCardLine(lineFour) || lineThree || '未提供信息';

      const cardLines = [];
      const titleText = sanitizeCardLine(info.title || (this.payload.data && this.payload.data.name) || 'PaperBurner X 文档');
      cardLines.push(this.createTextRun(titleText, { bold: true, fontSize: 44 }));
      cardLines.push('<w:br/>');
      if (this.options.includeBranding !== false) {
        cardLines.push(this.createHyperlinkRun('by Paper Burner X', this.brandLink, { italic: true }));
        cardLines.push('<w:br/>');
      }
      cardLines.push(this.createTextRun(lineThree, {}));
      if (lineFour && lineFour !== lineThree) {
        cardLines.push('<w:br/>');
        cardLines.push(this.createTextRun(lineFour, {}));
      }

      const cardParagraph = this.createParagraphFromRuns(cardLines.join(''), {
        align: 'center',
        shading: { fill: 'F8FAFF' },
        border: { color: 'CBD5F5', size: 24, space: 80, val: 'single' },
        spacingBefore: 360,
        spacingAfter: 240,
        indentLeft: 1440,
        indentRight: 1440
      });
      paragraphs.push(cardParagraph);

      paragraphs.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
      return paragraphs;
    }

    ensureFooter() {
      if (this.options.includeBranding === false) {
        this.footerInfo = null;
        return null;
      }
      if (this.footerInfo) return this.footerInfo;
      const fileName = 'footer1.xml';
      const relId = this.createRelationship('http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer', fileName);
      const footerParagraph = this.createParagraphFromRuns(
        this.createTextRun('by Paper Burner X', { italic: true, fontSize: 18 }),
        { align: 'center', spacingAfter: 0 }
      );
      const footerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
${footerParagraph}
</w:ftr>`;
      this.footerInfo = { id: relId, xml: footerXml, fileName };
      return this.footerInfo;
    }

    buildSectionProperties(options = {}) {
      const footerRelId = options && options.footerRelId ? options.footerRelId : null;
      const footerReference = footerRelId ? `
        <w:footerReference w:type="default" r:id="${footerRelId}"/>` : '';
      return `<w:sectPr>
        <w:pgSz w:w="12240" w:h="15840"/>
        <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
        ${footerReference}
      </w:sectPr>`;
    }

    convertBlock(node, context) {
      if (!node) return [];
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.replace(/\s+/g, ' ').trim();
        if (!text) return [];
        return [this.createParagraphFromRuns(this.createTextRun(text, {}))];
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return [];

      const el = node;
      const tag = el.tagName.toLowerCase();

      if (tag === 'style' || tag === 'script') return [];

      const classList = el.classList || { contains: () => false };

      if (classList.contains('align-flex')) {
        return this.renderAlignFlex(el, context);
      }
      if (classList.contains('block-toolbar') || classList.contains('align-actions') || classList.contains('align-edit-panel') || classList.contains('splitter') || classList.contains('chunk-controls') || classList.contains('chunk-loading') || classList.contains('block-loading')) {
        return [];
      }
      if (classList.contains('block-outer') || classList.contains('chunk-pair') || classList.contains('chunk-compare-container')) {
        return this.convertChildren(el.childNodes, context);
      }
      if (classList.contains('chunk-header')) {
        const blocks = [];
        const titleEl = el.querySelector('h4');
        if (titleEl && titleEl.textContent.trim()) {
          blocks.push(this.createParagraphFromRuns(this.createTextRun(titleEl.textContent.trim(), { bold: true }), { style: 'Heading2' }));
        }
        const statsEl = el.querySelector('.chunk-stats');
        if (statsEl) {
          const statsText = statsEl.textContent.replace(/\s+/g, ' ').trim();
          if (statsText) {
            blocks.push(this.createParagraphFromRuns(this.createTextRun(statsText, { italic: true }), { style: 'Heading3' }));
          }
        }
        return blocks;
      }

      if (classList.contains('katex-display') || classList.contains('katex-block')) {
        return [this.createBlockFormula(el, context)];
      }

      switch (tag) {
        case 'p':
          return [this.createParagraph(el, { maxWidthTwip: context.maxWidthTwip, inlineContext: context })];
        case 'h1':
          return [this.createParagraph(el, { style: 'Heading1', maxWidthTwip: context.maxWidthTwip, inlineContext: context })];
        case 'h2':
          return [this.createParagraph(el, { style: 'Heading2', maxWidthTwip: context.maxWidthTwip, inlineContext: context })];
        case 'h3':
          return [this.createParagraph(el, { style: 'Heading3', maxWidthTwip: context.maxWidthTwip, inlineContext: context })];
        case 'h4':
          return [this.createParagraph(el, { style: 'Heading4', maxWidthTwip: context.maxWidthTwip, inlineContext: context })];
        case 'h5':
          return [this.createParagraph(el, { style: 'Heading5', maxWidthTwip: context.maxWidthTwip, inlineContext: context })];
        case 'h6':
          return [this.createParagraph(el, { style: 'Heading6', maxWidthTwip: context.maxWidthTwip, inlineContext: context })];
        case 'ul':
          return this.convertList(el, false, context);
        case 'ol':
          return this.convertList(el, true, context);
        case 'li':
          return [this.createParagraph(el, { maxWidthTwip: context.maxWidthTwip, inlineContext: context })];
        case 'table':
          return [this.convertTable(el, context.maxWidthTwip, context)];
        case 'thead':
        case 'tbody':
        case 'tfoot':
          return this.convertChildren(el.childNodes, context);
        case 'tr':
          return [this.convertTableRow(el, context.maxWidthTwip, context)];
        case 'td':
        case 'th': {
          const widthHint = context.maxWidthTwip && context.maxWidthTwip > 0 ? Math.max(0, context.maxWidthTwip) : 2340;
          return [this.convertTableCell(el, widthHint, context)];
        }
        case 'pre':
          return [this.createParagraph(el, { codeBlock: true, maxWidthTwip: context.maxWidthTwip, inlineContext: context })];
        case 'blockquote':
          return this.convertBlockquote(el, context);
        case 'img':
          return [this.createImageParagraph(el, context)];
        case 'figure':
          return this.convertGenericContainer(el, context);
        case 'button':
        case 'svg':
        case 'path':
          return [];
        case 'hr':
          return [this.createHorizontalRule()];
        case 'div':
        case 'section':
        case 'article':
        case 'main':
        case 'header':
        case 'footer':
          return this.convertGenericContainer(el, context);
        default:
          return [this.createParagraph(el, { maxWidthTwip: context.maxWidthTwip, inlineContext: context })];
      }
    }

    convertChildren(nodeList, context = {}) {
      const blocks = [];
      Array.from(nodeList || []).forEach(node => {
        blocks.push(...this.convertBlock(node, context));
      });
      return blocks;
    }

    convertGenericContainer(el, context = {}) {
      const hasBlockChild = Array.from(el.childNodes || []).some(child => this.isBlockElement(child));
      if (!hasBlockChild) {
        return [this.createParagraph(el, { maxWidthTwip: context.maxWidthTwip, inlineContext: context })];
      }
      return this.convertChildren(el.childNodes, context);
    }

    renderAlignFlex(el, context = {}) {
      const alignBlocks = Array.from(el.children || []).filter(child => child && child.nodeType === Node.ELEMENT_NODE && child.classList.contains('align-block'));
      if (alignBlocks.length === 0) {
        return this.convertGenericContainer(el, context);
      }
      if (alignBlocks.length === 1) {
        const width = context.maxWidthTwip && context.maxWidthTwip > 0 ? context.maxWidthTwip : 9360;
        return this.renderAlignBlock(alignBlocks[0], width, context);
      }
      const leftBlock = alignBlocks[0];
      const rightBlock = alignBlocks[1];
      const pairType = this.detectAlignPairType(leftBlock, rightBlock);
      if (pairType === 'table' || pairType === 'image') {
        return [this.renderVerticalPair(leftBlock, rightBlock, context)];
      }
      return [this.renderAlignTable(alignBlocks, context)];
    }

    detectAlignPairType(leftBlock, rightBlock) {
      const hasTableClass = leftBlock.classList.contains('table-pair') || rightBlock.classList.contains('table-pair');
      const leftContent = leftBlock.querySelector('.align-content');
      const rightContent = rightBlock.querySelector('.align-content');
      const hasTableDom = (leftContent && leftContent.querySelector('table')) || (rightContent && rightContent.querySelector('table'));
      if (hasTableClass || hasTableDom) {
        return 'table';
      }
      const leftImages = leftContent ? leftContent.querySelectorAll('img').length : 0;
      const rightImages = rightContent ? rightContent.querySelectorAll('img').length : 0;
      const leftText = leftContent ? leftContent.textContent.replace(/\s+/g, '') : '';
      const rightText = rightContent ? rightContent.textContent.replace(/\s+/g, '') : '';
      const isImageOnly = (leftImages > 0 && !leftContent.querySelector('table') && leftText === '') || (rightImages > 0 && !rightContent.querySelector('table') && rightText === '');
      if (isImageOnly) {
        return 'image';
      }
      return 'text';
    }

    renderVerticalPair(leftBlock, rightBlock, context = {}) {
      const tableWidth = context.maxWidthTwip && context.maxWidthTwip > 0 ? Math.min(9360, context.maxWidthTwip) : 9360;
      const cellWidth = tableWidth;
      let leftParagraphs = this.renderAlignBlock(leftBlock, tableWidth, context).join('');
      if (!leftParagraphs.trim()) {
        leftParagraphs = this.createParagraphFromRuns(this.createTextRun('', {}));
      }
      let rightParagraphs = this.renderAlignBlock(rightBlock, tableWidth, context).join('');
      if (!rightParagraphs.trim()) {
        rightParagraphs = this.createParagraphFromRuns(this.createTextRun('', {}));
      }
      const tblBorders = `<w:tblBorders><w:top w:val="single" w:sz="4" w:color="D9D9D9"/><w:left w:val="single" w:sz="4" w:color="D9D9D9"/><w:bottom w:val="single" w:sz="4" w:color="D9D9D9"/><w:right w:val="single" w:sz="4" w:color="D9D9D9"/><w:insideH w:val="single" w:sz="4" w:color="E5E7EB"/><w:insideV w:val="single" w:sz="4" w:color="E5E7EB"/></w:tblBorders>`;
      const tblPr = `<w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="${tableWidth}" w:type="dxa"/><w:tblLayout w:type="fixed"/>${tblBorders}</w:tblPr>`;
      const grid = `<w:tblGrid><w:gridCol w:w="${cellWidth}"/></w:tblGrid>`;
      const topCell = `<w:tc><w:tcPr><w:tcW w:w="${cellWidth}" w:type="dxa"/></w:tcPr>${leftParagraphs}</w:tc>`;
      const bottomCell = `<w:tc><w:tcPr><w:tcW w:w="${cellWidth}" w:type="dxa"/></w:tcPr>${rightParagraphs}</w:tc>`;
      const topRow = `<w:tr>${topCell}</w:tr>`;
      const bottomRow = `<w:tr>${bottomCell}</w:tr>`;
      return `<w:tbl>${tblPr}${grid}${topRow}${bottomRow}</w:tbl>`;
    }

    renderAlignBlock(blockEl, availableWidthTwip, context = {}) {
      const paragraphs = [];
      const titleEl = blockEl.querySelector('.align-title span');
      if (titleEl && titleEl.textContent.trim()) {
        paragraphs.push(this.createParagraphFromRuns(this.createTextRun(titleEl.textContent.trim(), { bold: true })));
      }
      const contentEl = blockEl.querySelector('.align-content');
      if (contentEl) {
        const nextContext = Object.assign({}, context);
        if (availableWidthTwip) {
          nextContext.maxWidthTwip = availableWidthTwip;
        }
        const contentParagraphs = this.convertChildren(contentEl.childNodes, nextContext);
        if (contentParagraphs.length > 0) {
          paragraphs.push(...contentParagraphs);
        }
      }
      if (paragraphs.length === 0) {
        paragraphs.push(this.createParagraphFromRuns(this.createTextRun('', {})));
      }
      return paragraphs;
    }

    renderAlignTable(alignBlocks, context = {}) {
      const columnCount = alignBlocks.length || 1;
      const maxWidth = context.maxWidthTwip && context.maxWidthTwip > 0 ? Math.min(9360, context.maxWidthTwip) : 9360;
      const tableWidth = maxWidth;
      const cellWidth = Math.floor(tableWidth / columnCount);
      const gridCols = new Array(columnCount).fill(0).map(() => `<w:gridCol w:w="${cellWidth}"/>`).join('');
      const tblBorders = `
        <w:tblBorders>
          <w:top w:val="single" w:sz="4" w:color="D9D9D9"/>
          <w:left w:val="single" w:sz="4" w:color="D9D9D9"/>
          <w:bottom w:val="single" w:sz="4" w:color="D9D9D9"/>
          <w:right w:val="single" w:sz="4" w:color="D9D9D9"/>
          <w:insideH w:val="single" w:sz="4" w:color="E5E7EB"/>
          <w:insideV w:val="single" w:sz="4" w:color="E5E7EB"/>
        </w:tblBorders>`;
      const tblPr = `<w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="${tableWidth}" w:type="dxa"/><w:tblLayout w:type="fixed"/>${tblBorders}</w:tblPr>`;
      const rowCells = alignBlocks.map(blockEl => this.renderAlignBlockCell(blockEl, cellWidth, context)).join('');
      return `<w:tbl>${tblPr}<w:tblGrid>${gridCols}</w:tblGrid><w:tr>${rowCells}</w:tr></w:tbl>`;
    }

    renderAlignBlockCell(blockEl, cellWidth, context = {}) {
      const availableWidth = Math.max(0, cellWidth - 240);
      const paragraphs = this.renderAlignBlock(blockEl, availableWidth, context);
      const content = paragraphs.join('');
      const tcPrParts = [`<w:tcW w:w="${cellWidth}" w:type="dxa"/>`];
      if (blockEl.tagName && blockEl.tagName.toLowerCase() === 'th') {
        tcPrParts.push('<w:shd w:val="clear" w:color="auto" w:fill="F8FAFF"/>');
      }
      const tcPr = `<w:tcPr>${tcPrParts.join('')}</w:tcPr>`;
      return `<w:tc>${tcPr}${content}</w:tc>`;
    }

    convertBlockquote(el, context = {}) {
      const blocks = [];
      const childNodes = Array.from(el.childNodes || []);
      if (childNodes.length === 0) {
        blocks.push(this.createParagraphFromRuns(this.createTextRun('', {}), { indent: 720 }));
        return blocks;
      }
      childNodes.forEach(child => {
        const childBlocks = this.convertBlock(child, context);
        childBlocks.forEach(block => {
          blocks.push(this.applyIndentToParagraph(block, 720));
        });
      });
      return blocks;
    }

    applyIndentToParagraph(paragraphXml, indentTwip) {
      if (!paragraphXml) return paragraphXml;
      if (!paragraphXml.startsWith('<w:p')) return paragraphXml;
      if (paragraphXml.includes('<w:pPr>')) {
        return paragraphXml.replace('<w:pPr>', `<w:pPr><w:ind w:left="${indentTwip}"/>`);
      }
      return paragraphXml.replace('<w:p>', `<w:p><w:pPr><w:ind w:left="${indentTwip}"/><w:spacing w:after="160"/></w:pPr>`);
    }

    applyBoldToParagraph(paragraphXml) {
      if (!paragraphXml) return paragraphXml;
      let result = paragraphXml;
      // Insert bold into runs without existing rPr
      result = result.replace(/<w:r>(?!<w:rPr>)/g, '<w:r><w:rPr><w:b/></w:rPr>');
      // For runs with rPr but lacking bold, append
      result = result.replace(/<w:r><w:rPr>([\s\S]*?)<\/w:rPr>/g, function(match, inner) {
        if (inner.includes('<w:b')) {
          return match;
        }
        return `<w:r><w:rPr>${inner}<w:b/></w:rPr>`;
      });
      return result;
    }

    convertList(listEl, ordered, context = {}) {
      const items = [];
      const children = Array.from(listEl.children || []);
      children.forEach((li, index) => {
        const marker = ordered ? `${index + 1}. ` : '• ';
        const childContext = Object.assign({}, context);
        const contentRuns = this.convertInline(Array.from(li.childNodes || []), childContext);
        const markerRun = this.createTextRun(marker, { bold: false });
        const paragraph = `<w:p><w:pPr><w:ind w:left="720"/><w:spacing w:after="120"/></w:pPr>${markerRun}${contentRuns}</w:p>`;
        items.push(paragraph);
      });
      return items;
    }

    convertTable(tableEl, parentWidthTwip, context = {}) {
      const rows = [];
      const tableRows = Array.from(tableEl.rows || []);
      const columnCount = tableRows.reduce((max, tr) => Math.max(max, tr.cells ? tr.cells.length : 0), 0) || 1;
      const tableWidth = parentWidthTwip && parentWidthTwip > 0 ? Math.min(9360, parentWidthTwip) : 9360;
      const cellWidth = Math.floor(tableWidth / columnCount);
      const gridCols = new Array(columnCount).fill(0).map(() => `<w:gridCol w:w="${cellWidth}"/>`).join('');

      const rowContext = Object.assign({}, context, {
        maxWidthTwip: Math.max(0, cellWidth - 240),
        skipFormula: true
      });

      tableRows.forEach(tr => {
        rows.push(this.convertTableRow(tr, cellWidth, rowContext));
      });

      const tblBorders = `
        <w:tblBorders>
          <w:top w:val="single" w:sz="4" w:color="D9D9D9"/>
          <w:left w:val="single" w:sz="4" w:color="D9D9D9"/>
          <w:bottom w:val="single" w:sz="4" w:color="D9D9D9"/>
          <w:right w:val="single" w:sz="4" w:color="D9D9D9"/>
          <w:insideH w:val="single" w:sz="4" w:color="E5E7EB"/>
          <w:insideV w:val="single" w:sz="4" w:color="E5E7EB"/>
        </w:tblBorders>`;

      const tblPr = `<w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="${tableWidth}" w:type="dxa"/><w:tblLayout w:type="fixed"/>${tblBorders}</w:tblPr>`;
      const tblGrid = `<w:tblGrid>${gridCols}</w:tblGrid>`;
      return `<w:tbl>${tblPr}${tblGrid}${rows.join('')}</w:tbl>`;
    }

    convertTableRow(tr, cellWidth, context = {}) {
      const cellsArr = Array.from(tr.cells || []);
      let effectiveWidth = cellWidth;
      if (!effectiveWidth) {
        const tableWidth = context.maxWidthTwip && context.maxWidthTwip > 0 ? context.maxWidthTwip : 9360;
        const count = cellsArr.length || 1;
        effectiveWidth = Math.floor(tableWidth / count);
      }
      const cells = cellsArr.map(cell => this.convertTableCell(cell, effectiveWidth, context)).join('');
      return `<w:tr>${cells}</w:tr>`;
    }

    convertTableCell(cellEl, cellWidth, parentContext = {}) {
      const cellContent = [];
      const childNodes = Array.from(cellEl.childNodes || []);
      const cellContext = Object.assign({}, parentContext, {
        maxWidthTwip: Math.max(0, cellWidth - 240),
        skipFormula: true,
        formulaCache: parentContext.formulaCache || new Set()
      });
      if (childNodes.length === 0) {
        cellContent.push(this.createParagraphFromRuns(this.createTextRun('', {})));
      } else {
        childNodes.forEach(child => {
          const blocks = this.convertBlock(child, cellContext);
          if (blocks.length === 0) {
            cellContent.push(this.createParagraphFromRuns(this.createTextRun('', {})));
          } else {
            cellContent.push(...blocks);
          }
        });
      }
      const cellType = cellEl.tagName.toLowerCase();
      if (cellType === 'th') {
        for (let i = 0; i < cellContent.length; i++) {
          cellContent[i] = this.applyBoldToParagraph(cellContent[i]);
        }
      }
      const tcPrParts = [`<w:tcW w:w="${cellWidth}" w:type="dxa"/>`];
      if (cellType === 'th') {
        tcPrParts.push('<w:shd w:val="clear" w:color="auto" w:fill="F8FAFF"/>');
      }
      const tcPr = `<w:tcPr>${tcPrParts.join('')}</w:tcPr>`;
      const content = cellContent.length ? cellContent.join('') : this.createParagraphFromRuns(this.createTextRun('', {}));
      return `<w:tc>${tcPr}${content}</w:tc>`;
    }

    createParagraph(element, options = {}) {
      const inlineContext = Object.assign({}, options.inlineContext || {}, {
        maxWidthTwip: options.maxWidthTwip
      });
      if (options.codeBlock) {
        inlineContext.code = true;
      }
      const runs = this.convertInline(Array.from(element.childNodes || []), inlineContext);
      const paragraphOptions = Object.assign({}, options);
      delete paragraphOptions.inlineContext;
      return this.createParagraphFromRuns(runs, paragraphOptions);
    }

    createParagraphFromRuns(runs, options = {}) {
      const runContent = runs && runs.trim() ? runs : this.createTextRun('', {});
      const content = runContent && runContent.trim() ? runContent : '<w:r><w:t xml:space="preserve"></w:t></w:r>';
      const pPrParts = [];
      if (options.style) {
        pPrParts.push(`<w:pStyle w:val="${options.style}"/>`);
        if (Object.prototype.hasOwnProperty.call(HEADING_OUTLINE_LEVELS, options.style)) {
          const level = HEADING_OUTLINE_LEVELS[options.style];
          pPrParts.push(`<w:outlineLvl w:val="${level}"/>`);
        }
      }

      const indentLeft = Object.prototype.hasOwnProperty.call(options, 'indentLeft')
        ? options.indentLeft
        : (Object.prototype.hasOwnProperty.call(options, 'indent') ? options.indent : null);
      const indentRight = Object.prototype.hasOwnProperty.call(options, 'indentRight') ? options.indentRight : null;
      if (indentLeft != null || indentRight != null) {
        let indentAttrs = '';
        if (indentLeft != null) indentAttrs += ` w:left="${indentLeft}"`;
        if (indentRight != null) indentAttrs += ` w:right="${indentRight}"`;
        pPrParts.push(`<w:ind${indentAttrs}/>`);
      }

      if (options.align) {
        pPrParts.push(`<w:jc w:val="${options.align}"/>`);
      }
      if (options.shading) {
        const shadingVal = options.shading.val || 'clear';
        const shadingFill = options.shading.fill || 'F8FAFF';
        const shadingColor = options.shading.color || 'auto';
        pPrParts.push(`<w:shd w:val="${shadingVal}" w:color="${shadingColor}" w:fill="${shadingFill}"/>`);
      } else if (options.codeBlock) {
        pPrParts.push('<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>');
      }
      if (options.border) {
        const borderColor = options.border.color || 'CBD5F5';
        const borderSize = Number.isFinite(options.border.size) ? options.border.size : 16;
        const borderSpace = Number.isFinite(options.border.space) ? options.border.space : 80;
        const borderVal = options.border.val || 'single';
        pPrParts.push(`<w:pBdr>
          <w:top w:val="${borderVal}" w:sz="${borderSize}" w:space="${borderSpace}" w:color="${borderColor}"/>
          <w:left w:val="${borderVal}" w:sz="${borderSize}" w:space="${borderSpace}" w:color="${borderColor}"/>
          <w:bottom w:val="${borderVal}" w:sz="${borderSize}" w:space="${borderSpace}" w:color="${borderColor}"/>
          <w:right w:val="${borderVal}" w:sz="${borderSize}" w:space="${borderSpace}" w:color="${borderColor}"/>
        </w:pBdr>`);
      }
      const spacingBefore = Object.prototype.hasOwnProperty.call(options, 'spacingBefore') ? options.spacingBefore : null;
      const spacingAfter = Object.prototype.hasOwnProperty.call(options, 'spacingAfter') ? options.spacingAfter : 160;
      if (spacingBefore != null || spacingAfter != null) {
        const beforeAttr = spacingBefore != null ? ` w:before="${spacingBefore}"` : '';
        const afterAttr = spacingAfter != null ? ` w:after="${spacingAfter}"` : '';
        pPrParts.push(`<w:spacing${beforeAttr}${afterAttr}/>`);
      }
      const pPr = pPrParts.length ? `<w:pPr>${pPrParts.join('')}</w:pPr>` : '';
      return `<w:p>${pPr}${content}</w:p>`;
    }

    convertInline(nodes, context = {}) {
      let runs = '';
      Array.from(nodes || []).forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent.replace(/\s+/g, ' ');
          if (text) {
            runs += this.createTextRun(text, context);
          }
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) {
          return;
        }
        const el = node;
        const tag = el.tagName.toLowerCase();

        if (tag === 'br') {
          runs += '<w:br/>';
          return;
        }
        if (tag === 'span' && el.classList.contains('katex')) {
          runs += this.createInlineFormula(el, false, context);
          return;
        }
        if (tag === 'span' && el.classList.contains('katex-display')) {
          runs += this.createInlineFormula(el, true, context);
          return;
        }
        if (tag === 'img') {
          runs += this.createImageRun(el, context);
          return;
        }

        const nextContext = Object.assign({}, context);
        if (tag === 'strong' || tag === 'b') {
          nextContext.bold = true;
        }
        if (tag === 'em' || tag === 'i') {
          nextContext.italic = true;
        }
        if (tag === 'code') {
          nextContext.code = true;
        }
        if (tag === 'u') {
          nextContext.underline = true;
        }
        if (tag === 'sup') {
          nextContext.verticalAlign = 'superscript';
        }
        if (tag === 'sub') {
          nextContext.verticalAlign = 'subscript';
        }
        if (tag === 'span' && el.getAttribute('style')) {
          this.applyInlineStyle(el.getAttribute('style'), nextContext);
        }

        runs += this.convertInline(Array.from(el.childNodes || []), nextContext);
      });
      return runs;
    }

    applyInlineStyle(styleText, context) {
      const segments = styleText.split(';');
      segments.forEach(segment => {
        const [rawKey, rawValue] = segment.split(':');
        if (!rawKey || !rawValue) return;
        const key = rawKey.trim().toLowerCase();
        const value = rawValue.trim().toLowerCase();
        if (key === 'font-weight' && (value === 'bold' || value === '700')) {
          context.bold = true;
        }
        if (key === 'font-style' && value === 'italic') {
          context.italic = true;
        }
        if (key === 'text-decoration' && value.includes('underline')) {
          context.underline = true;
        }
        if (key === 'color') {
          const hex = this.toHexColor(value);
          if (hex) context.color = hex;
        }
      });
    }

    toHexColor(value) {
      if (!value) return null;
      if (value.startsWith('#')) {
        return value.replace('#', '').toUpperCase();
      }
      const rgbMatch = value.match(/rgb\s*\(([^)]+)\)/);
      if (rgbMatch) {
        const parts = rgbMatch[1].split(',').map(n => parseInt(n.trim(), 10));
        if (parts.length === 3 && parts.every(n => !Number.isNaN(n))) {
          return parts.map(n => n.toString(16).padStart(2, '0')).join('').toUpperCase();
        }
      }
      return null;
    }

    createTextRun(text, context = {}) {
      if (text == null) return '';
      let processed = String(text);
      // 先移除 XML 非法控制字符
      processed = processed.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F]/g, '');
      processed = processed.replace(/\r\n/g, '\n');
      if (!context.code) {
        processed = processed.replace(/\s+/g, ' ');
      }
      if (context.formulaFallback) {
        processed = processed.replace(/[\u2000-\u200B\u202F\u205F\u2060]/g, '');
        processed = dedupeRepeatedSequence(processed);
        processed = dedupeSplitRepeats(processed);
        if (context.formulaCache) {
          const key = processed;
          if (context.formulaCache.has(key)) {
            return '';
          }
          context.formulaCache.add(key);
        }
      }
      if (!/\S/.test(processed)) {
        return '';
      }
      const runProps = [];
      if (context.bold) runProps.push('<w:b/>');
      if (context.italic) runProps.push('<w:i/>');
      if (context.underline) runProps.push('<w:u w:val="single"/>');
      if (context.code) {
        runProps.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="DengXian"/>');
        runProps.push('<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>');
      }
      if (context.color) {
        const colorValue = String(context.color).replace('#', '').toUpperCase();
        if (colorValue) {
          runProps.push(`<w:color w:val="${colorValue}"/>`);
        }
      }
      if (context.verticalAlign) {
        const val = context.verticalAlign === 'superscript' ? 'superscript' : 'subscript';
        runProps.push(`<w:vertAlign w:val="${val}"/>`);
      }
      if (context.fontSize) {
        const sizeVal = parseInt(context.fontSize, 10);
        if (!Number.isNaN(sizeVal) && sizeVal > 0) {
          runProps.push(`<w:sz w:val="${sizeVal}"/>`);
          runProps.push(`<w:szCs w:val="${sizeVal}"/>`);
        }
      }

      const rPr = runProps.length ? `<w:rPr>${runProps.join('')}</w:rPr>` : '';
      const segments = processed.split(/\n/);
      const runs = segments.map((segment, index) => {
        const escapedSegment = escapeXml(segment);
        // 调试：检查是否有未转义的 &
        if (this.options.debug && segment.includes('&') && !escapedSegment.includes('&amp;')) {
          console.warn('⚠ escapeXml failed for:', segment, '→', escapedSegment);
        }
        const textXml = `<w:t xml:space="preserve">${escapedSegment}</w:t>`;
        if (index < segments.length - 1) {
          return `<w:r>${rPr}${textXml}</w:r><w:br/>`;
        }
        return `<w:r>${rPr}${textXml}</w:r>`;
      });
      return runs.join('');
    }

    createHyperlinkRun(text, url, context = {}) {
      if (!url) {
        return this.createTextRun(text, context);
      }
      const relId = this.createRelationship('http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink', url, { targetMode: 'External' });
      const hyperlinkContext = Object.assign({ underline: true, color: '1D4ED8' }, context || {});
      if (!hyperlinkContext.color) {
        hyperlinkContext.color = '1D4ED8';
      }
      if (hyperlinkContext.color) {
        hyperlinkContext.color = String(hyperlinkContext.color).replace('#', '').toUpperCase();
      }
      const runContent = this.createTextRun(text, hyperlinkContext);
      return `<w:hyperlink r:id="${relId}" w:history="1">${runContent}</w:hyperlink>`;
    }

    createImageParagraph(imgEl, context = {}) {
      const run = this.createImageRun(imgEl, context);
      return `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="160"/></w:pPr>${run}</w:p>`;
    }

    createImageRun(imgEl, context = {}) {
      const rawSrc = imgEl.getAttribute('src');
      const resolvedSrc = this.resolveImageData(rawSrc);
      if (!resolvedSrc || !resolvedSrc.startsWith('data:image')) {
        return this.createTextRun('[图片]', {});
      }
      const match = resolvedSrc.match(/^data:(image\/([a-zA-Z0-9.+\-]+));base64,(.*)$/);
      if (!match) {
        return this.createTextRun('[图片]', {});
      }
      const mimeType = match[1];
      let ext = match[2].toLowerCase();
      let base64Data = match[3];
      base64Data = base64Data.replace(/\s+/g, '');
      if (ext === 'jpg') ext = 'jpeg';

      const fileExtForFile = ext === 'jpeg' ? 'jpg' : ext;
      this.mediaExtensions.add(fileExtForFile);

      const fileName = `image${this.imageCounter}.${fileExtForFile}`;
      this.imageCounter += 1;
      const relId = this.createRelationship('http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', `media/${fileName}`);
      this.mediaFiles.push({ fileName, data: base64Data });

      const dimensions = this.extractImageDimensions(imgEl, context, resolvedSrc);
      const cx = Math.max(1, Math.round(dimensions.width * 9525));
      const cy = Math.max(1, Math.round(dimensions.height * 9525));

      const docPrId = this.drawingCounter++;

      return `<w:r>
        <w:rPr/>
        <w:drawing>
          <wp:inline distT="0" distB="0" distL="0" distR="0">
            <wp:extent cx="${cx}" cy="${cy}"/>
            <wp:effectExtent l="0" t="0" r="0" b="0"/>
            <wp:docPr id="${docPrId}" name="Picture ${docPrId}"/>
            <wp:cNvGraphicFramePr>
              <a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/>
            </wp:cNvGraphicFramePr>
            <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
              <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
                <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
                  <pic:nvPicPr>
                    <pic:cNvPr id="${docPrId}" name="Picture ${docPrId}"/>
                    <pic:cNvPicPr/>
                  </pic:nvPicPr>
                  <pic:blipFill>
                    <a:blip r:embed="${relId}"/>
                    <a:stretch><a:fillRect/></a:stretch>
                  </pic:blipFill>
                  <pic:spPr>
                    <a:xfrm>
                      <a:off x="0" y="0"/>
                      <a:ext cx="${cx}" cy="${cy}"/>
                    </a:xfrm>
                    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                  </pic:spPr>
                </pic:pic>
              </a:graphicData>
            </a:graphic>
          </wp:inline>
        </w:drawing>
      </w:r>`;
    }

    extractImageDimensions(imgEl, context = {}, dataUriOverride = null) {
      const widthAttr = imgEl.getAttribute('width');
      const heightAttr = imgEl.getAttribute('height');
      const style = imgEl.getAttribute('style') || '';
      let width = this.parsePixelValue(widthAttr) || this.parseStyleDimension(style, 'width');
      let height = this.parsePixelValue(heightAttr) || this.parseStyleDimension(style, 'height');

      const candidateSrc = dataUriOverride || (imgEl && imgEl.getAttribute('src')) || '';
      if ((!width || !height) && candidateSrc) {
        const base64Match = candidateSrc.match(/^data:image\/([a-zA-Z0-9]+);base64,(.*)$/);
        if (base64Match) {
          const ext = base64Match[1].toLowerCase();
          const base64 = base64Match[2];
          const decoded = this.decodeImageSize(base64, ext);
          if (decoded) {
            if (!width) width = decoded.width;
            if (!height) height = decoded.height;
          }
        }
      }

      const DEFAULT_WIDTH = 680; // px
      if (!width || width <= 0) width = DEFAULT_WIDTH;
      if (!height || height <= 0) height = Math.round(width * 0.75);

      const maxWidthContextPx = context.maxWidthTwip ? context.maxWidthTwip / 15 : null;
      const maxWidth = maxWidthContextPx && maxWidthContextPx > 0 ? Math.min(DEFAULT_WIDTH, maxWidthContextPx) : DEFAULT_WIDTH;
      if (width > maxWidth) {
        const scale = maxWidth / width;
        width = maxWidth;
        height = Math.max(10, Math.round(height * scale));
      }
      return { width, height };
    }

    parseStyleDimension(style, prop) {
      const regex = new RegExp(`${prop}\\s*:\\s*([^;]+)`);
      const match = style.match(regex);
      if (!match) return null;
      return this.parsePixelValue(match[1]);
    }

    parsePixelValue(value) {
      if (!value) return null;
      const str = String(value).trim();
      const num = parseFloat(str);
      if (Number.isNaN(num)) return null;
      if (str.endsWith('%')) {
        return null;
      }
      return num;
    }

    decodeImageSize(base64, ext) {
      try {
        const bytes = this.base64ToUint8Array(base64);
        if (!bytes || bytes.length < 10) return null;
        if (ext === 'png') return this.decodePng(bytes);
        if (ext === 'jpeg' || ext === 'jpg') return this.decodeJpeg(bytes);
        if (ext === 'gif') return this.decodeGif(bytes);
        return this.decodeJpeg(bytes) || this.decodePng(bytes);
      } catch (err) {
        return null;
      }
    }

    base64ToUint8Array(base64) {
      const cleaned = base64.replace(/[^A-Za-z0-9+/=]/g, '');
      const binary = atob(cleaned);
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    }

    decodePng(bytes) {
      if (bytes.length < 24) return null;
      const signature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
      for (let i = 0; i < signature.length; i++) {
        if (bytes[i] !== signature[i]) return null;
      }
      const width = this.readUInt32BE(bytes, 16);
      const height = this.readUInt32BE(bytes, 20);
      return { width, height };
    }

    decodeJpeg(bytes) {
      if (bytes[0] !== 0xFF || bytes[1] !== 0xD8) return null;
      let offset = 2;
      const length = bytes.length;
      while (offset < length) {
        if (bytes[offset] !== 0xFF) {
          offset++;
          continue;
        }
        const marker = bytes[offset + 1];
        if (!marker || marker === 0xFF) {
          offset++;
          continue;
        }
        const segmentLength = (bytes[offset + 2] << 8) | bytes[offset + 3];
        if (segmentLength <= 0) break;
        const sofMarkers = [0xC0,0xC1,0xC2,0xC3,0xC5,0xC6,0xC7,0xC9,0xCA,0xCB,0xCD,0xCE,0xCF];
        if (sofMarkers.includes(marker)) {
          const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
          const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
          return { width, height };
        }
        offset += 2 + segmentLength;
      }
      return null;
    }

    decodeGif(bytes) {
      if (bytes.length < 10) return null;
      if (bytes[0] !== 0x47 || bytes[1] !== 0x49 || bytes[2] !== 0x46) return null;
      const width = bytes[6] | (bytes[7] << 8);
      const height = bytes[8] | (bytes[9] << 8);
      return { width, height };
    }

    readUInt32BE(bytes, offset) {
      return ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
    }

    createRelationship(type, target, options = {}) {
      const id = `rId${this.relIdCounter++}`;
      const rel = { id, type, target };
      if (options && options.targetMode) {
        rel.targetMode = options.targetMode;
      }
      this.relationships.push(rel);
      return id;
    }

    getFormulaFallbackText(element, mathEl) {
      if (!element) return '';
      const texNode = element.querySelector('annotation[encoding="application/x-tex"]');
      if (texNode && texNode.textContent) {
        return this.normalizeFormulaText(texNode.textContent);
      }
      const dataOriginal = element.getAttribute('data-original-text');
      if (dataOriginal && dataOriginal.trim()) {
        return this.normalizeFormulaText(dataOriginal);
      }
      if (mathEl && mathEl.textContent) {
        return this.normalizeFormulaText(mathEl.textContent);
      }
      return this.normalizeFormulaText(element.textContent || '');
    }

    normalizeFormulaText(text) {
      if (!text) return '';
      return String(text).replace(/\s+/g, ' ').trim();
    }

    formatFormulaFallbackText(text) {
      const normalized = this.normalizeFormulaText(text);
      if (!normalized) return '';
      let result = normalized;

      const greekMap = {
        '\\alpha': 'α',
        '\\beta': 'β',
        '\\gamma': 'γ',
        '\\delta': 'δ',
        '\\epsilon': 'ε',
        '\\zeta': 'ζ',
        '\\eta': 'η',
        '\\theta': 'θ',
        '\\iota': 'ι',
        '\\kappa': 'κ',
        '\\lambda': 'λ',
        '\\mu': 'μ',
        '\\nu': 'ν',
        '\\xi': 'ξ',
        '\\pi': 'π',
        '\\rho': 'ρ',
        '\\sigma': 'σ',
        '\\tau': 'τ',
        '\\upsilon': 'υ',
        '\\phi': 'φ',
        '\\chi': 'χ',
        '\\psi': 'ψ',
        '\\omega': 'ω',
        '\\Alpha': 'Α',
        '\\Beta': 'Β',
        '\\Gamma': 'Γ',
        '\\Delta': 'Δ',
        '\\Theta': 'Θ',
        '\\Lambda': 'Λ',
        '\\Pi': 'Π',
        '\\Sigma': 'Σ',
        '\\Phi': 'Φ',
        '\\Psi': 'Ψ',
        '\\Omega': 'Ω'
      };

      Object.keys(greekMap).forEach(function(key) {
        const value = greekMap[key];
        result = result.replace(new RegExp(key + '(?![A-Za-z])', 'g'), value);
      });

      result = result.replace(/\\mathrm\{([^}]+)\}/g, '$1');
      result = result.replace(/\\text\{([^}]+)\}/g, '$1');
      result = result.replace(/\\left\s*/g, '');
      result = result.replace(/\\right\s*/g, '');
      result = result.replace(/\\pm/g, '±');
      result = result.replace(/\\times/g, '×');
      result = result.replace(/\\cdot/g, '·');
      result = result.replace(/\\leq/g, '≤');
      result = result.replace(/\\geq/g, '≥');
      result = result.replace(/\\neq/g, '≠');
      result = result.replace(/\\infty/g, '∞');
      result = result.replace(/\\degree/g, '°');
      result = result.replace(/\\%/g, '%');
      result = result.replace(/\\,/g, ' ');
      result = result.replace(/\\\s/g, ' ');
      result = result.replace(/[{}]/g, '');
      result = result.replace(/\s+/g, ' ').trim();
      return result;
    }

    renderFormulaFallback(text, context = {}, wrapAsParagraph = false) {
      const clean = this.formatFormulaFallbackText(text);
      if (!clean) return '';

      // 调试：检查公式降级文本
      if (this.options.debug && clean && clean.includes('&')) {
        console.log('📝 Formula fallback text:', text, '→', clean);
      }

      const runContext = { formulaFallback: true };
      if (context.formulaCache) {
        runContext.formulaCache = context.formulaCache;
      }
      const run = this.createTextRun(clean, runContext);

      // 调试：检查生成的 XML
      if (this.options.debug && run && run.includes('&') && !run.includes('&amp;')) {
        console.warn('⚠ Formula fallback XML contains unescaped &:', run);
      }

      if (!run) return '';
      if (wrapAsParagraph) {
        return this.createParagraphFromRuns(run);
      }
      return run;
    }

    createInlineFormula(element, isDisplay, context = {}) {
      let mathEl = null;
      try { mathEl = element.querySelector('math'); } catch (error) { mathEl = null; }
      const fallbackText = this.getFormulaFallbackText(element, mathEl);
      if (context.skipFormula) {
        return this.renderFormulaFallback(fallbackText, context);
      }
      // 若 HTML 中没有 MathML，尝试用 KaTeX 将 TeX 转为 MathML 再导出
      if (!mathEl) {
        const tex = element.getAttribute('data-original-text') || fallbackText || '';
        if (tex && typeof katex !== 'undefined') {
          try {
            const mathmlStr = katex.renderToString(tex, { displayMode: !!isDisplay, throwOnError: true, strict: 'ignore', output: 'mathml' });
            const parsed = new DOMParser().parseFromString(mathmlStr, 'text/html');
            const built = parsed.querySelector('math');
            if (built) {
              const ommlFromBuilt = this.mathConverter.convert(built);
              if (ommlFromBuilt && ommlFromBuilt.trim()) {
                return `<w:r>${ommlFromBuilt}</w:r>`;
              }
            }
          } catch (e) {
            console.warn('KaTeX conversion failed for inline formula:', e);
            // fall through to textual fallback
          }
        }
        return this.renderFormulaFallback(fallbackText, context);
      }
      try {
        const ommlCore = this.mathConverter.convert(mathEl);
        if (ommlCore && ommlCore.trim()) {
          return `<w:r>${ommlCore}</w:r>`;
        }
      } catch (err) {
        console.warn('MathML to OMML conversion failed for inline formula:', err);
        return this.renderFormulaFallback(fallbackText, context);
      }
      return this.renderFormulaFallback(fallbackText || (mathEl && mathEl.textContent) || '', context);
    }

    createBlockFormula(element, context = {}) {
      let mathEl = null;
      try { mathEl = element.querySelector('math'); } catch (_) { mathEl = null; }
      const fallbackText = this.getFormulaFallbackText(element, mathEl);
      if (context.skipFormula) {
        return this.renderFormulaFallback(fallbackText, context, true);
      }
      if (!mathEl) {
        const tex = element.getAttribute('data-original-text') || fallbackText || '';
        if (tex && typeof katex !== 'undefined') {
          try {
            const mathmlStr = katex.renderToString(tex, { displayMode: true, throwOnError: true, strict: 'ignore', output: 'mathml' });
            const parsed = new DOMParser().parseFromString(mathmlStr, 'text/html');
            const built = parsed.querySelector('math');
            if (built) {
              const ommlBuilt = this.mathConverter.convert(built);
              if (ommlBuilt && ommlBuilt.trim()) {
                return `<w:p><w:pPr><w:spacing w:after="160"/></w:pPr><m:oMathPara>${ommlBuilt}</m:oMathPara></w:p>`;
              }
            }
          } catch (e) {
            console.warn('KaTeX conversion failed for block formula:', e);
            // fall through
          }
        }
        return this.renderFormulaFallback(fallbackText, context, true);
      }
      let omml = '';
      try { omml = this.mathConverter.convert(mathEl); } catch (err) {
        console.warn('MathML to OMML conversion failed for block formula:', err);
        omml = '';
      }
      if (!omml || !omml.trim()) {
        return this.renderFormulaFallback(fallbackText || (mathEl && mathEl.textContent) || '', context, true);
      }
      return `<w:p><w:pPr><w:spacing w:after="160"/></w:pPr><m:oMathPara>${omml}</m:oMathPara></w:p>`;
    }

    createHorizontalRule() {
      return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="1" w:color="D9D9D9"/></w:pBdr><w:spacing w:after="160"/></w:pPr></w:p>';
    }

    isBlockElement(node) {
      if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
      const tag = node.tagName.toLowerCase();
      return ['p','div','section','article','main','header','footer','ul','ol','li','table','tr','td','th','blockquote','pre','figure','img','h1','h2','h3','h4','h5','h6'].includes(tag);
    }
  }

  class MathMlToOmmlConverter {
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

    sanitizeOmml(omml) {
      if (!omml) return '';
      // 移除控制字符，但保留换行符和制表符
      return String(omml).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F]/g, '');
    }

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
        console.warn('Error converting MathML node:', tag, error);
        return '';
      }
    }

    wrapWith(tag, content) {
      if (!content || !content.trim()) {
        // 空内容时返回空格占位，防止生成空标签
        return `<${tag}>${this.createTextRun(' ')}</${tag}>`;
      }
      return `<${tag}>${content}</${tag}>`;
    }

    createTextRun(text) {
      const normalized = text ? text.replace(/\s+/g, ' ').trim() : '';
      if (!normalized) {
        // 返回一个空格，而不是空字符串
        return '<m:r><m:t xml:space="preserve"> </m:t></m:r>';
      }
      return `<m:r><m:t xml:space="preserve">${escapeXml(normalized)}</m:t></m:r>`;
    }
  }







function collectIntroCardInfo(payload, helpers = {}) {
    const data = payload && payload.data ? payload.data : {};
    const getTranslation = typeof helpers.getTranslationMarkdown === 'function'
      ? helpers.getTranslationMarkdown
      : getTranslationMarkdown;
    const getOcr = typeof helpers.getOcrMarkdown === 'function'
      ? helpers.getOcrMarkdown
      : getOcrMarkdown;
    const formatTime = typeof helpers.formatDateTime === 'function'
      ? helpers.formatDateTime
      : formatDateTime;
    const translationMarkdown = getTranslation(data);
    const ocrMarkdown = getOcr(data);
    const title = selectCardTitle(translationMarkdown, ocrMarkdown, data && data.name);
    return {
      title,
      sourceTitle: data && data.name ? data.name : '',
      modeLabel: payload && payload.modeLabel ? payload.modeLabel : '',
      exportedAt: payload && payload.exportTime ? formatTime(payload.exportTime) : '',
      recordId: data && data.id ? String(data.id) : ''
    };
  }



function selectCardTitle(translationMarkdown, ocrMarkdown, fallbackName) {
    const translationTitle = extractTitleFromMarkdown(translationMarkdown);
    if (translationTitle) return translationTitle;
    const ocrTitle = extractTitleFromMarkdown(ocrMarkdown);
    if (ocrTitle) return ocrTitle;
    if (fallbackName && fallbackName.trim()) {
      return truncateForCard(fallbackName.trim(), 50);
    }
    return 'PaperBurner X 文档';
  }

  function extractTitleFromMarkdown(markdown) {
    if (!markdown) return '';
    const blocks = String(markdown).split(/\n\s*\n+/).filter(Boolean);
    const limit = Math.min(3, blocks.length);

    for (let i = 0; i < limit; i++) {
      const block = blocks[i];
      if (!block) continue;
      const trimmed = block.trim();
      if (!trimmed) continue;
      const atxMatch = trimmed.match(/^\s{0,3}(#{1,6})\s+(.+)/);
      if (atxMatch) {
        return truncateForCard(cleanMarkdownInline(atxMatch[2]), 50);
      }
      const setextMatch = trimmed.match(/^([\s\S]+?)\n(=+|-+)\s*$/);
      if (setextMatch) {
        return truncateForCard(cleanMarkdownInline(setextMatch[1]), 50);
      }
    }

    if (blocks.length) {
      return truncateForCard(cleanMarkdownInline(blocks[0]), 50);
    }
    return '';
  }

  function cleanMarkdownInline(text) {
    if (!text) return '';
    let result = String(text);
    result = result.replace(/```[\s\S]*?```/g, '');
    result = result.replace(/`([^`]+)`/g, '$1');
    result = result.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
    result = result.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    result = result.replace(/[*_~>#`]/g, '');
    result = result.replace(/\|/g, '');
    result = result.replace(/\r?\n+/g, ' ');
    result = result.replace(/\s+/g, ' ').trim();
    return result;
  }

  function sanitizeCardLine(text) {
    if (!text) return '';
    return truncateForCard(String(text).replace(/\s+/g, ' ').trim(), 60);
  }

  function truncateForCard(input, maxLength) {
    if (!input) return '';
    const units = Array.from(String(input));
    if (units.length <= maxLength) {
      return units.join('');
    }
    return units.slice(0, maxLength).join('') + '…';
  }

function getOcrMarkdown(data) {
    if (!data) return '';
    if (data.ocr && data.ocr.trim()) return data.ocr;
    if (Array.isArray(data.ocrChunks) && data.ocrChunks.length) {
      return data.ocrChunks.map(function(chunk) { return (chunk || '').trim(); }).join('\n\n');
    }
    return '';
  }

  function getTranslationMarkdown(data) {
    if (!data) return '';
    if (data.translation && data.translation.trim()) return data.translation;
    if (Array.isArray(data.translatedChunks) && data.translatedChunks.length) {
      return data.translatedChunks.map(function(chunk) { return (chunk || '').trim(); }).join('\n\n');
    }
    return '';
  }


  function safeDecodeURIComponent(value) {
    if (typeof value !== 'string') return value;
    try {
      return decodeURIComponent(value);
    } catch (_) {
      return value;
    }
  }

  function dedupeRepeatedSequence(input) {
    if (!input || typeof input !== 'string') return input;
    let s = input;
    const fullRepeat = /^(.{8,}?)\1+$/s.exec(s);
    if (fullRepeat) {
      return fullRepeat[1];
    }
    if (s.length % 2 === 0) {
      const mid = s.length / 2;
      const a = s.slice(0, mid);
      const b = s.slice(mid);
      if (a === b) return a;
    }
    if (s.length % 3 === 0) {
      const t = s.length / 3;
      const a = s.slice(0, t);
      const b = s.slice(t, 2 * t);
      const c = s.slice(2 * t);
      if (a === b && b === c) return a;
    }
    return s;
  }

  function dedupeSplitRepeats(input) {
    if (!input || typeof input !== 'string') return input;
    let s = input;
    const phrase = /\b([A-Za-z0-9\.\-±×·≤≥≠∞°%]+(?:\s+[A-Za-z0-9\.\-±×·≤≥≠∞°%]+){0,4})\b(?:\s+\1\b)+/g;
    for (let i = 0; i < 3; i++) {
      const next = s.replace(phrase, '$1');
      if (next === s) break;
      s = next;
    }
    return s;
  }

  function sanitizeFileName(name) {
    return (name || 'document').replace(/[\\/:*?"<>|]/g, '_');
  }

  function formatDateTime(date) {
    const pad = function(num) { return String(num).padStart(2, '0'); };
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function formatTimestamp(date) {
    const pad = function(num) { return String(num).padStart(2, '0'); };
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  }

  function buildContentTypesXml(mediaExtensions) {
    const defaults = [
      { ext: 'rels', type: 'application/vnd.openxmlformats-package.relationships+xml' },
      { ext: 'xml', type: 'application/xml' }
    ];

    const handled = new Set();
    (mediaExtensions || []).forEach(function(ext) {
      const lower = (ext || '').toLowerCase();
      if (!lower) return;
      if (handled.has(lower)) return;
      handled.add(lower);
      let mime = 'image/' + lower;
      if (lower === 'jpg' || lower === 'jpeg') mime = 'image/jpeg';
      if (lower === 'svg') mime = 'image/svg+xml';
      defaults.push({ ext: lower, type: mime });
    });

    const defaultXml = defaults.map(function(item) {
      return `  <Default Extension="${item.ext}" ContentType="${item.type}"/>`;
    }).join('\n');

    const overrides = [
      { part: '/word/document.xml', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml' },
      { part: '/word/styles.xml', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml' },
      { part: '/word/footer1.xml', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml' },
      { part: '/docProps/core.xml', type: 'application/vnd.openxmlformats-package.core-properties+xml' },
      { part: '/docProps/app.xml', type: 'application/vnd.openxmlformats-officedocument.extended-properties+xml' }
    ];

    const overridesXml = overrides.map(function(item) {
      return `  <Override PartName="${item.part}" ContentType="${item.type}"/>`;
    }).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
${defaultXml}
${overridesXml}
</Types>`;
  }

  function buildPackageRelsXml() {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
  }

  function buildCorePropsXml(payload, iso) {
    const title = payload && payload.data && payload.data.name ? escapeXml(payload.data.name) : 'PaperBurner X 导出';
    const creator = 'PaperBurner X';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${title}</dc:title>
  <dc:creator>${creator}</dc:creator>
  <cp:lastModifiedBy>${creator}</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified>
</cp:coreProperties>`;
  }

  function buildAppPropsXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>PaperBurner X</Application>
</Properties>`;
  }

  function buildStylesXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="DengXian" w:cs="Calibri"/>
        <w:sz w:val="21"/>
        <w:szCs w:val="21"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:spacing w:after="160"/>
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:spacing w:after="160"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="DengXian" w:cs="Calibri"/>
      <w:sz w:val="21"/>
      <w:szCs w:val="21"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:uiPriority w:val="1"/>
    <w:qFormat/>
    <w:pPr>
      <w:keepNext/>
      <w:keepLines/>
      <w:spacing w:before="240" w:after="160"/>
      <w:jc w:val="center"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="40"/>
      <w:szCs w:val="40"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:uiPriority w:val="9"/>
    <w:qFormat/>
    <w:pPr>
      <w:keepNext/>
      <w:keepLines/>
      <w:spacing w:before="240" w:after="0"/>
      <w:outlineLvl w:val="0"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="32"/>
      <w:szCs w:val="32"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:uiPriority w:val="9"/>
    <w:qFormat/>
    <w:pPr>
      <w:keepNext/>
      <w:keepLines/>
      <w:spacing w:before="200" w:after="0"/>
      <w:outlineLvl w:val="1"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="28"/>
      <w:szCs w:val="28"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:uiPriority w:val="9"/>
    <w:qFormat/>
    <w:pPr>
      <w:keepNext/>
      <w:keepLines/>
      <w:spacing w:before="160" w:after="0"/>
      <w:outlineLvl w:val="2"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="26"/>
      <w:szCs w:val="26"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading4">
    <w:name w:val="heading 4"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:uiPriority w:val="9"/>
    <w:qFormat/>
    <w:pPr>
      <w:keepNext/>
      <w:keepLines/>
      <w:spacing w:before="160" w:after="0"/>
      <w:outlineLvl w:val="3"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="24"/>
      <w:szCs w:val="24"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading5">
    <w:name w:val="heading 5"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:uiPriority w:val="9"/>
    <w:qFormat/>
    <w:pPr>
      <w:keepNext/>
      <w:keepLines/>
      <w:spacing w:before="120" w:after="0"/>
      <w:outlineLvl w:val="4"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="22"/>
      <w:szCs w:val="22"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading6">
    <w:name w:val="heading 6"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:uiPriority w:val="9"/>
    <w:qFormat/>
    <w:pPr>
      <w:keepNext/>
      <w:keepLines/>
      <w:spacing w:before="120" w:after="0"/>
      <w:outlineLvl w:val="5"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="20"/>
      <w:szCs w:val="20"/>
    </w:rPr>
  </w:style>
</w:styles>`;
  }

  function buildDocumentRelsXml(relationships) {
    const baseRels = [
      { id: 'rIdStyles', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles', target: 'styles.xml' }
    ];
    const rels = baseRels.concat(relationships || []).map(function(rel) {
      return `  <Relationship Id="${rel.id}" Type="${rel.type}" Target="${rel.target}"${rel.targetMode ? ` TargetMode="${rel.targetMode}"` : ''}/>`;
    }).join('\n');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${rels}
</Relationships>`;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function(ch) {
      switch (ch) {
        case '&': return '&amp;';
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '"': return '&quot;';
        case "'": return '&#39;';
        default: return ch;
      }
    });
  }

  function escapeXml(str) {
    if (!str) return '';
    let result = String(str);
    // 先移除或替换 XML 非法控制字符
    // XML 1.0 允许的字符: #x9 | #xA | #xD | [#x20-#xD7FF] | [#xE000-#xFFFD] | [#x10000-#x10FFFF]
    result = result.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F]/g, '');
    // 转义 XML 特殊字符
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
  }

  function escapeMarkdown(str) {
    return String(str).replace(/[\\`*_{}\[\]()#+\-.!]/g, '\\$&');
  }



function buildFileName(payload, ext) {
    const modeKey = payload.tab.replace(/[^a-z\-]/gi, '') || 'export';
    const timestamp = formatTimestamp(payload.exportTime);
    return `${payload.fileNameBase}_${modeKey}_${timestamp}.${ext}`;
  }

  function ensureFileExtension(name, ext) {
    const sanitized = sanitizeFileName(name || '');
    const base = sanitized.replace(/(\.[^.]+)?$/, '');
    const safeBase = base || 'document';
    const normalizedExt = (ext || '').toString().trim().toLowerCase() || 'txt';
    return `${safeBase}.${normalizedExt}`;
  }

  function resolveFileName(payload, ext, options = {}) {
    if (options && options.fileName) {
      const desired = options.fileName;
      const lower = desired.toLowerCase();
      const targetExt = (ext || '').toString().trim().toLowerCase();
      if (targetExt && lower.endsWith(`.${targetExt}`)) {
        return sanitizeFileName(desired);
      }
      return ensureFileExtension(desired, targetExt || 'txt');
    }
    if (payload && payload.customFileName) {
      const desired = payload.customFileName;
      const lower = desired.toLowerCase();
      const targetExt = (ext || '').toString().trim().toLowerCase();
      if (targetExt && lower.endsWith(`.${targetExt}`)) {
        return sanitizeFileName(desired);
      }
      return ensureFileExtension(desired, targetExt || 'txt');
    }
    return buildFileName(payload, ext);
  }



function sanitizeFileName(name) {
    return (name || 'document').replace(/[\\/:*?"<>|]/g, '_');
  }

  // XML 结构验证函数
  function validateXmlStructure(xmlString) {
    if (!xmlString || typeof xmlString !== 'string') {
      throw new Error('XML 内容为空或类型错误');
    }

    // 检查基本的 XML 声明
    if (!xmlString.includes('<?xml')) {
      throw new Error('缺少 XML 声明');
    }

    // 检查根元素
    if (!xmlString.includes('<w:document') || !xmlString.includes('</w:document>')) {
      throw new Error('缺少或未闭合的 document 根元素');
    }

    // 检查 body 元素
    if (!xmlString.includes('<w:body>') || !xmlString.includes('</w:body>')) {
      throw new Error('缺少或未闭合的 body 元素');
    }

    // 检查是否有未转义的特殊字符（可能破坏 XML）
    const illegalCharsRegex = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F]/;
    if (illegalCharsRegex.test(xmlString)) {
      const match = xmlString.match(illegalCharsRegex);
      const charCode = match ? match[0].charCodeAt(0) : 'unknown';
      throw new Error(`包含非法 XML 控制字符: 0x${charCode.toString(16)}`);
    }

    // 简单的标签平衡检查（检查关键标签）
    const criticalTags = ['w:document', 'w:body'];
    for (const tag of criticalTags) {
      const openCount = (xmlString.match(new RegExp(`<${tag}[> ]`, 'g')) || []).length;
      const closeCount = (xmlString.match(new RegExp(`</${tag}>`, 'g')) || []).length;

      if (openCount !== closeCount) {
        throw new Error(`标签 ${tag} 未正确闭合 (打开:${openCount}, 关闭:${closeCount})`);
      }
    }

    // 检查是否有未闭合的尖括号
    const openBrackets = (xmlString.match(/</g) || []).length;
    const closeBrackets = (xmlString.match(/>/g) || []).length;
    if (openBrackets !== closeBrackets) {
      throw new Error(`尖括号不匹配 (<: ${openBrackets}, >: ${closeBrackets})`);
    }

    return true;
  }

  // 基础 XML 验证
  function validateBasicXml(xmlString, fileName) {
    if (!xmlString || typeof xmlString !== 'string') {
      throw new Error(`${fileName}: XML 内容为空`);
    }

    if (!xmlString.includes('<?xml')) {
      throw new Error(`${fileName}: 缺少 XML 声明`);
    }

    const illegalCharsRegex = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F]/;
    if (illegalCharsRegex.test(xmlString)) {
      throw new Error(`${fileName}: 包含非法 XML 控制字符`);
    }

    return true;
  }

  function formatDateTime(date) {
    const pad = function(num) { return String(num).padStart(2, '0'); };
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function formatTimestamp(date) {
    const pad = function(num) { return String(num).padStart(2, '0'); };
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  }




  window.PBXHistoryExporterDocx = window.PBXHistoryExporterDocx || {};
  Object.assign(window.PBXHistoryExporterDocx, { exportAsDocx });
})(window);

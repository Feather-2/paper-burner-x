(function(window, document) {
  const KATEX_CDN = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css';

  const EXPORT_LABELS = {
    html: 'HTML',
    pdf: 'PDF',
    docx: 'DOCX',
    markdown: 'Markdown'
  };

  const MODE_LABELS = {
    'ocr': '仅OCR',
    'translation': '仅翻译',
    'chunk-compare': '分块对比'
  };

  const BRAND_LINK = 'https://github.com/Feather-2/paper-burner-x';
  const exportState = {
    common: {
      includeBranding: true
    },
    pdf: {
      paper: 'A4',
      marginTop: 20,
      marginBottom: 20,
      marginLeft: 15,
      marginRight: 15,
      scalePercent: 100
    },
    markdown: {
      embedImages: false
    }
  };
  let currentFormat = null;

  document.addEventListener('DOMContentLoaded', function() {
    const controls = document.getElementById('history-export-controls');
    const trigger = document.getElementById('exportTrigger');
    const panel = document.getElementById('exportPanel');
    const closeBtn = document.getElementById('exportPanelClose');
    const backdrop = document.getElementById('exportPanelBackdrop');
    const configContent = document.getElementById('exportConfigContent');
    const confirmBtn = document.getElementById('exportConfirmBtn');
    if (!controls || !trigger || !panel || !configContent || !confirmBtn) return;

    const formatButtons = Array.from(panel.querySelectorAll('.export-menu-btn'));
    trigger.setAttribute('aria-expanded', 'false');

    const ensureMargin = function(value, fallback) {
      return Number.isFinite(value) && value >= 0 ? value : fallback;
    };

    const applyPdfPreset = function(paper) {
      const pdfState = exportState.pdf;
      if (!pdfState) return;
      switch (paper) {
        case 'A3':
          pdfState.paper = 'A3';
          pdfState.marginTop = 10;
          pdfState.marginBottom = 10;
          pdfState.marginLeft = 10;
          pdfState.marginRight = 10;
          pdfState.scalePercent = 100;
          break;
        case 'A2':
          pdfState.paper = 'A2';
          pdfState.marginTop = 15;
          pdfState.marginBottom = 15;
          pdfState.marginLeft = 2;
          pdfState.marginRight = 2;
          pdfState.scalePercent = 125;
          break;
        case 'A4':
        default:
          pdfState.paper = 'A4';
          pdfState.marginTop = 20;
          pdfState.marginBottom = 20;
          pdfState.marginLeft = 15;
          pdfState.marginRight = 15;
          pdfState.scalePercent = 100;
          break;
      }
    };

    applyPdfPreset(exportState.pdf.paper || 'A4');

    const renderConfigPlaceholder = function() {
      configContent.innerHTML = '<div class="export-config-placeholder">请选择导出格式以查看设置</div>';
      confirmBtn.disabled = true;
      confirmBtn.textContent = '导出';
      formatButtons.forEach(function(button) {
        button.classList.remove('is-active');
        button.setAttribute('aria-pressed', 'false');
      });
    };

    const renderConfigForFormat = function(format) {
      const sections = [];
      sections.push(`
        <div class="export-config-section">
          <label class="export-option">
            <input type="checkbox" id="configIncludeBranding" ${exportState.common.includeBranding ? 'checked' : ''}>
            <span>附带 Paper Burner X 标识</span>
          </label>
        </div>
      `);

      if (format === 'pdf') {
        sections.push(`
          <div class="export-config-section">
            <div class="export-field">
              <span class="export-field-label">纸张大小</span>
              <select id="configPdfPaper">
                <option value="A4">A4 (210 × 297 mm)</option>
                <option value="A3">A3 (297 × 420 mm)</option>
                <option value="A2">A2 (420 × 594 mm)</option>
              </select>
            </div>
            <div class="export-field-row">
              <div class="export-field export-field-half">
                <span class="export-field-label">上边距 (mm)</span>
                <input type="number" id="configPdfMarginTop" min="0" step="1">
              </div>
              <div class="export-field export-field-half">
                <span class="export-field-label">下边距 (mm)</span>
                <input type="number" id="configPdfMarginBottom" min="0" step="1">
              </div>
            </div>
            <div class="export-field-row">
              <div class="export-field export-field-half">
                <span class="export-field-label">左边距 (mm)</span>
                <input type="number" id="configPdfMarginLeft" min="0" step="1">
              </div>
              <div class="export-field export-field-half">
                <span class="export-field-label">右边距 (mm)</span>
                <input type="number" id="configPdfMarginRight" min="0" step="1">
              </div>
            </div>
            <div class="export-field-row export-field-row-single">
              <div class="export-field export-field-half">
                <span class="export-field-label">缩放 (%)</span>
                <input type="number" id="configPdfScale" min="10" max="400" step="5">
              </div>
            </div>
            <div class="export-tip">可根据输出需要调整画布尺寸与边距。</div>
          </div>
        `);
      }

      if (format === 'markdown') {
        sections.push(`
          <div class="export-config-section">
            <label class="export-option">
              <input type="checkbox" id="configMarkdownEmbed" ${exportState.markdown.embedImages ? 'checked' : ''}>
              <span>内嵌图片 (Base64)</span>
            </label>
            <div class="export-tip">开启后图片将转换为 Base64，适合单文件分享。</div>
          </div>
        `);
      }

      if (format === 'html' || format === 'docx') {
        sections.push('<div class="export-tip">导出将保留当前视图的内容结构。</div>');
      }

      configContent.innerHTML = sections.join('');

      const brandingInput = document.getElementById('configIncludeBranding');
      if (brandingInput) {
        brandingInput.addEventListener('change', function() {
          exportState.common.includeBranding = brandingInput.checked;
        });
      }

      if (format === 'pdf') {
        const pdfState = exportState.pdf;
        const paperSelect = document.getElementById('configPdfPaper');
        if (paperSelect) {
          paperSelect.value = pdfState.paper;
          paperSelect.addEventListener('change', function() {
            const value = paperSelect.value || 'A4';
            pdfState.paper = value;
            applyPdfPreset(value);
            renderConfigForFormat('pdf');
          });
        }
        const marginInputs = {
          marginTop: document.getElementById('configPdfMarginTop'),
          marginBottom: document.getElementById('configPdfMarginBottom'),
          marginLeft: document.getElementById('configPdfMarginLeft'),
          marginRight: document.getElementById('configPdfMarginRight')
        };
        Object.keys(marginInputs).forEach(function(key) {
          const input = marginInputs[key];
          if (!input) return;
          const fallback = key === 'marginLeft' || key === 'marginRight' ? 15 : 20;
          const value = ensureMargin(pdfState[key], fallback);
          pdfState[key] = value;
          input.value = value;
          input.addEventListener('change', function() {
            const parsed = parseFloat(input.value);
            if (Number.isFinite(parsed) && parsed >= 0) {
              pdfState[key] = parsed;
            } else {
              input.value = pdfState[key];
            }
          });
        });
        const scaleInput = document.getElementById('configPdfScale');
        if (scaleInput) {
          const clamped = Math.max(10, Math.min(400, ensureMargin(pdfState.scalePercent, 100)));
          pdfState.scalePercent = clamped;
          scaleInput.value = clamped;
          scaleInput.addEventListener('change', function() {
            const parsed = parseFloat(scaleInput.value);
            if (!Number.isFinite(parsed)) {
              scaleInput.value = pdfState.scalePercent;
              return;
            }
            const normalized = Math.max(10, Math.min(400, parsed));
            pdfState.scalePercent = normalized;
            scaleInput.value = normalized;
          });
        }
      }

      if (format === 'markdown') {
        const embedCheckbox = document.getElementById('configMarkdownEmbed');
        if (embedCheckbox) {
          embedCheckbox.addEventListener('change', function() {
            exportState.markdown.embedImages = embedCheckbox.checked;
          });
        }
      }
    };

    const gatherOptionsForFormat = function(format) {
      const base = {
        includeBranding: exportState.common.includeBranding !== false
      };
      if (format === 'pdf') {
        base.pdfPaper = exportState.pdf.paper || 'A4';
        base.pdfMargins = {
          top: ensureMargin(exportState.pdf.marginTop, 20),
          bottom: ensureMargin(exportState.pdf.marginBottom, 20),
          left: ensureMargin(exportState.pdf.marginLeft, 15),
          right: ensureMargin(exportState.pdf.marginRight, 15)
        };
        base.pdfScalePercent = Math.max(10, Math.min(400, ensureMargin(exportState.pdf.scalePercent, 100)));
      }
      if (format === 'markdown') {
        base.markdownEmbedImages = !!exportState.markdown.embedImages;
      }
      return base;
    };

    const selectFormat = function(format) {
      currentFormat = format;
      formatButtons.forEach(function(button) {
        const active = button.dataset.format === format;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      renderConfigForFormat(format);
      confirmBtn.disabled = false;
      confirmBtn.textContent = `导出 ${EXPORT_LABELS[format] || ''}`;
    };

    const openPanel = function() {
      controls.classList.add('is-open');
      trigger.setAttribute('aria-expanded', 'true');
      if (currentFormat) {
        selectFormat(currentFormat);
      } else {
        renderConfigPlaceholder();
      }
    };

    const closePanel = function() {
      controls.classList.remove('is-open');
      trigger.setAttribute('aria-expanded', 'false');
    };

    trigger.addEventListener('click', function(event) {
      event.preventDefault();
      if (controls.classList.contains('is-open')) {
        closePanel();
      } else {
        openPanel();
      }
    });

    if (closeBtn) {
      closeBtn.addEventListener('click', function(event) {
        event.preventDefault();
        closePanel();
      });
    }

    if (backdrop) {
      backdrop.addEventListener('click', function() {
        closePanel();
      });
    }

    document.addEventListener('keydown', function(event) {
      if (event.key === 'Escape' && controls.classList.contains('is-open')) {
        closePanel();
      }
    });

    formatButtons.forEach(function(button) {
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', function(event) {
        event.preventDefault();
        const format = button.dataset.format;
        if (!format) return;
        selectFormat(format);
      });
    });

    confirmBtn.addEventListener('click', async function() {
      if (!currentFormat) return;
      const options = gatherOptionsForFormat(currentFormat);
      try {
        await handleExport(currentFormat, confirmBtn, options);
        closePanel();
      } catch (error) {
        console.error('[HistoryExporter] 导出失败:', error);
      }
    });

    renderConfigPlaceholder();
  });

  async function handleExport(format, triggerButton, options = {}) {
    const activeTab = window.currentVisibleTabId || 'ocr';
    const data = window.data;
    if (!data) {
      alert('历史记录数据尚未加载完成，稍后再试。');
      return;
    }

    const payload = buildExportPayload(activeTab, data);
    if (!payload) {
      alert('当前视图没有可导出的内容。');
      return;
    }

    const originalDisabled = triggerButton.disabled;
    const originalHtml = triggerButton.innerHTML;
    try {
      triggerButton.disabled = true;
      const loadingLabel = `导出${EXPORT_LABELS[format] || ''}中...`;
      triggerButton.innerHTML = `<i class="fa fa-spinner fa-spin"></i><span>${loadingLabel}</span>`;
      if (format === 'html') {
        exportAsHtml(payload, options);
      } else if (format === 'markdown') {
        exportAsMarkdown(payload, options);
      } else if (format === 'docx') {
        await exportAsDocx(payload, options);
      } else if (format === 'pdf') {
        await exportAsPdf(payload, options);
      } else {
        console.warn('[HistoryExporter] 未知导出格式:', format);
        alert('暂不支持该导出格式。');
      }
    } catch (error) {
      console.error('[HistoryExporter] 导出失败:', error);
      alert('导出失败：' + (error && error.message ? error.message : error));
    } finally {
      triggerButton.disabled = originalDisabled;
      triggerButton.innerHTML = originalHtml;
    }
  }

  function buildExportPayload(tab, data) {
    const modeLabel = MODE_LABELS[tab] || '未知模式';
    const exportTime = new Date();
    const fileNameBase = sanitizeFileName(data && data.name ? data.name.replace(/\s+/g, ' ').trim() : '历史记录');

    if (tab === 'ocr') {
      const markdown = getOcrMarkdown(data);
      if (!markdown.trim()) return null;
      const html = buildMarkdownSectionHtml(modeLabel, markdown, data.images);
      return {
        tab,
        modeLabel,
        exportTime,
        fileNameBase,
        data,
        bodyMarkdown: markdown,
        bodyHtml: html
      };
    }

    if (tab === 'translation') {
      const markdown = getTranslationMarkdown(data);
      if (!markdown.trim()) return null;
      const html = buildMarkdownSectionHtml(modeLabel, markdown, data.images);
      return {
        tab,
        modeLabel,
        exportTime,
        fileNameBase,
        data,
        bodyMarkdown: markdown,
        bodyHtml: html
      };
    }

    if (tab === 'chunk-compare') {
      const pairs = buildChunkPairs(data);
      if (!pairs.length) return null;
      const html = buildChunkCompareHtml(modeLabel, pairs, data.images);
      const markdown = buildChunkCompareMarkdown(pairs);
      return {
        tab,
        modeLabel,
        exportTime,
        fileNameBase,
        data,
        bodyMarkdown: markdown,
        bodyHtml: html
      };
    }

    return null;
  }

  function buildMarkdownSectionHtml(title, markdown, images) {
    const rendered = renderMarkdown(markdown, images);
    return [
      '<section class="export-section">',
      `  <h2>${escapeHtml(title)}</h2>`,
      '  <div class="export-markdown markdown-body">',
      rendered || '<p>（无内容）</p>',
      '  </div>',
      '</section>'
    ].join('\n');
  }

  function buildChunkPairs(data) {
    if (!data) return [];
    const ocrChunks = Array.isArray(data.ocrChunks) ? data.ocrChunks : [];
    const transChunks = Array.isArray(data.translatedChunks) ? data.translatedChunks : [];
    if (!ocrChunks.length || ocrChunks.length !== transChunks.length) return [];
    const pairs = [];
    for (let i = 0; i < ocrChunks.length; i++) {
      pairs.push({
        index: i + 1,
        ocr: ocrChunks[i] || '',
        translation: transChunks[i] || ''
      });
    }
    return pairs;
  }

  function buildChunkCompareHtml(title, pairs, images) {
    const sections = pairs.map(function(pair) {
      const originalHtml = renderMarkdown(pair.ocr, images) || '<p class="empty-text">（无内容）</p>';
      const translationHtml = renderMarkdown(pair.translation, images) || '<p class="empty-text">（无内容）</p>';
      const hasTable = /<table\b/i.test(originalHtml) || /<table\b/i.test(translationHtml);
      const hasImage = /<img\b/i.test(originalHtml) || /<img\b/i.test(translationHtml);
      let type = 'text';
      if (hasTable) {
        type = 'table';
      } else if (hasImage) {
        type = 'image';
      }
      return renderChunkCompareSection(pair.index, type, originalHtml, translationHtml);
    }).join('\n');

    return [
      '<section class="export-section export-chunk-compare">',
      `  <h2>${escapeHtml(title)}</h2>`,
      sections,
      '</section>'
    ].join('\n');
  }

  function renderChunkCompareSection(index, type, leftHtml, rightHtml) {
    const pairClass = `export-pair export-pair-${type}`;
    return [
      `<section class="export-chunk" data-chunk-index="${index}">`,
      `  <h3>区块 ${index}</h3>`,
      `  <div class="${pairClass}">`,
      renderExportSide('原文', leftHtml, 'ocr'),
      renderExportSide('译文', rightHtml, 'trans'),
      '  </div>',
      '</section>'
    ].join('\n');
  }

  function renderExportSide(title, html, role) {
    const safeTitle = escapeHtml(title || (role === 'ocr' ? '原文' : '译文'));
    const content = html && html.trim() ? html : '<p class="empty-text">（无内容）</p>';
    return [
      `    <div class="export-side export-side-${role}">`,
      `      <div class="export-side-title">${safeTitle}</div>`,
      `      <div class="export-side-content">${content}</div>`,
      '    </div>'
    ].join('\n');
  }

  function buildChunkCompareMarkdown(pairs) {
    return pairs.map(function(pair) {
      return [
        `## 区块 ${pair.index}` ,
        '',
        '### 原文',
        '',
        pair.ocr ? pair.ocr.trim() : '（无内容）',
        '',
        '### 译文',
        '',
        pair.translation ? pair.translation.trim() : '（无内容）',
        ''
      ].join('\n');
    }).join('\n');
  }

  function exportAsHtml(payload, options = {}) {
    const documentHtml = buildHtmlDocument(payload, options);
    const fileName = buildFileName(payload, 'html');
    saveBlob(documentHtml, fileName, 'text/html;charset=utf-8');
  }

  function exportAsMarkdown(payload, options = {}) {
    const markdown = buildMarkdownDocument(payload, options);
    const fileName = buildFileName(payload, 'md');
    saveBlob(markdown, fileName, 'text/markdown;charset=utf-8');
  }

  async function exportAsDocx(payload, options = {}) {
    const JSZipRef = window.JSZip;
    if (typeof JSZipRef !== 'function') {
      throw new Error('JSZip 组件未加载，无法导出 DOCX');
    }

    const builder = new DocxDocumentBuilder(payload, options);
    const docxResult = builder.build();

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
    saveAs(docxBlob, buildFileName(payload, 'docx'));
  }

  function exportAsPdf(payload, options = {}) {
    const existing = document.querySelector('.history-export-print-root');
    if (existing) existing.remove();
    const existingStyle = document.querySelector('style[data-history-export-print]');
    if (existingStyle) existingStyle.remove();

    const styleEl = document.createElement('style');
    styleEl.setAttribute('data-history-export-print', 'true');
    styleEl.textContent = `${buildExportStyles(options)}\n${buildPrintStyles(options)}`;

    const container = document.createElement('div');
    container.className = 'history-export-print-root';
    const mainHtml = buildMainContent(payload, options);
    container.innerHTML = `<div class="history-export-root">${mainHtml}</div>`;

    document.body.appendChild(styleEl);
    document.body.appendChild(container);
    document.body.classList.add('history-export-print-mode');

    const rootElement = container.querySelector('.history-export-root');
    if (rootElement && options.pdfScalePercent) {
      const scale = Math.max(0.1, Math.min(4, options.pdfScalePercent / 100));
      rootElement.style.transformOrigin = 'top left';
      rootElement.style.transform = `scale(${scale})`;
      rootElement.style.maxWidth = '100%';
      rootElement.style.width = `${100 / scale}%`;
      rootElement.style.margin = '0';
    }

    const cleanup = function() {
      document.body.classList.remove('history-export-print-mode');
      container.remove();
      styleEl.remove();
    };

    return new Promise(function(resolve) {
      window.addEventListener('afterprint', function handler() {
        window.removeEventListener('afterprint', handler);
        cleanup();
        resolve();
      }, { once: true });
      setTimeout(function() {
        try {
          window.print();
        } catch (error) {
          console.error('[HistoryExporter] 调用打印失败:', error);
          cleanup();
          resolve();
        }
      }, 100);
    });
  }

  function buildHtmlDocument(payload, options = {}) {
    const styles = buildExportStyles(options);
    const content = buildMainContent(payload, options);
    return [
      '<!DOCTYPE html>',
      '<html lang="zh">',
      '<head>',
      '  <meta charset="UTF-8">',
      `  <title>${escapeHtml(payload.fileNameBase)} - ${escapeHtml(payload.modeLabel)}导出</title>`,
      '  <meta name="viewport" content="width=device-width, initial-scale=1">',
      `  <link rel="stylesheet" href="${KATEX_CDN}">`,
      `  <style>${styles}</style>`,
      '</head>',
      '<body class="history-export-root">',
      content,
      '</body>',
      '</html>'
    ].join('\n');
  }

  function buildPrintStyles(options = {}) {
    const paper = (options.pdfPaper || 'A4').toString().toUpperCase();
    const margins = Object.assign({ top: 20, bottom: 20, left: 15, right: 15 }, options.pdfMargins || {});
    const safeMargin = function(value, fallback) {
      return Number.isFinite(value) && value >= 0 ? value : fallback;
    };
    const marginTop = safeMargin(margins.top, 20);
    const marginBottom = safeMargin(margins.bottom, 20);
    const marginLeft = safeMargin(margins.left, 15);
    const marginRight = safeMargin(margins.right, 15);
    return `
@page {
  size: ${paper} portrait;
  margin: ${marginTop}mm ${marginRight}mm ${marginBottom}mm ${marginLeft}mm;
}
body.history-export-print-mode {
  margin: 0;
  background: #ffffff !important;
  color: #0f172a;
}
body.history-export-print-mode > *:not(.history-export-print-root) {
  display: none !important;
}
body.history-export-print-mode .history-export-print-root {
  margin: 0;
}
body.history-export-print-mode .history-export-root {
  padding: 0;
  background: transparent !important;
  min-height: auto;
}
body.history-export-print-mode .history-export-root .export-wrapper {
  margin: 0 auto;
  box-shadow: none;
  border-radius: 0;
  padding: 0;
}
body.history-export-print-mode .history-export-root .export-header {
  margin-bottom: 24px;
}
body.history-export-print-mode .history-export-root .export-meta,
body.history-export-print-mode .history-export-root .export-section {
  page-break-inside: avoid;
}
`; // end print styles
  }

  function buildMainContent(payload, options = {}) {
    const segments = ['<div class="export-wrapper">'];
    const brandingNote = buildBrandingBadgeHtml(options);
    if (brandingNote) {
      segments.push(brandingNote);
    }
    segments.push(buildHeaderHtml(payload));
    segments.push(payload.bodyHtml);
    segments.push('</div>');
    return segments.join('\n');
  }

  function buildHeaderHtml(payload) {
    const { data, modeLabel, exportTime } = payload;
    const metaItems = [];
    if (data && data.name) {
      metaItems.push(`<li><span class="meta-label">原始文件</span><span class="meta-value">${escapeHtml(data.name)}</span></li>`);
    }
    metaItems.push(`<li><span class="meta-label">导出模式</span><span class="meta-value">${escapeHtml(modeLabel)}</span></li>`);
    metaItems.push(`<li><span class="meta-label">导出时间</span><span class="meta-value">${escapeHtml(formatDateTime(exportTime))}</span></li>`);
    if (data && data.id) {
      metaItems.push(`<li><span class="meta-label">记录ID</span><span class="meta-value">${escapeHtml(data.id)}</span></li>`);
    }

    return [
      '<header class="export-header">',
      `  <h1>${escapeHtml(data && data.name ? data.name : '历史记录导出')}</h1>`,
      '  <ul class="export-meta">',
      metaItems.join('\n'),
      '  </ul>',
      '</header>'
    ].join('\n');
  }

  function buildBrandingBadgeHtml(options = {}) {
    if (options.includeBranding === false) return '';
    return '<div class="export-brand-note">by <a href="' + BRAND_LINK + '" target="_blank" rel="noopener">Paper Burner X</a></div>';
  }

  function collectIntroCardInfo(payload) {
    const data = payload && payload.data ? payload.data : {};
    const translationMarkdown = getTranslationMarkdown(data);
    const ocrMarkdown = getOcrMarkdown(data);
    const title = selectCardTitle(translationMarkdown, ocrMarkdown, data && data.name);
    return {
      title,
      sourceTitle: data && data.name ? data.name : '',
      modeLabel: payload && payload.modeLabel ? payload.modeLabel : '',
      exportedAt: payload && payload.exportTime ? formatDateTime(payload.exportTime) : '',
      recordId: data && data.id ? String(data.id) : ''
    };
  }

  function embedImagesInMarkdown(markdown, images) {
    if (!markdown || !Array.isArray(images) || images.length === 0) {
      return markdown;
    }
    const map = new Map();
    images.forEach(function(img, index) {
      if (!img) return;
      const rawData = typeof img.data === 'string' ? img.data.trim() : '';
      if (!rawData) return;
      const dataUrl = rawData.startsWith('data:') ? rawData : 'data:image/png;base64,' + rawData;
      const keys = new Set();
      if (img.name) {
        const cleaned = String(img.name).trim();
        if (cleaned) {
          keys.add(cleaned);
          keys.add(cleaned.replace(/^\.\//, ''));
          keys.add('images/' + cleaned);
        }
      }
      if (img.id) {
        const id = String(img.id).trim();
        if (id) {
          keys.add(id);
          keys.add(id + '.png');
          keys.add('images/' + id);
          keys.add('images/' + id + '.png');
        }
      }
      keys.add(`img-${index}.jpeg.png`);
      keys.add(`images/img-${index}.jpeg.png`);
      keys.forEach(function(key) {
        map.set(key, dataUrl);
      });
    });

    return markdown.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function(match, alt, path) {
      if (!path) return match;
      const trimmed = path.trim();
      if (!trimmed) return match;
      const basePath = trimmed.split(/[?#]/)[0].replace(/^\.\//, '');
      const direct = map.get(basePath) || map.get(basePath.replace(/^images\//, ''));
      if (direct) {
        return `![${alt}](${direct})`;
      }
      return match;
    });
  }

  function buildMarkdownDocument(payload, options = {}) {
    const { data, modeLabel, exportTime, bodyMarkdown } = payload;
    const lines = [];
    lines.push('---');
    lines.push(`title: ${data && data.name ? escapeMarkdown(data.name) : '历史记录导出'}`);
    lines.push(`mode: ${modeLabel}`);
    lines.push(`exportedAt: ${formatDateTime(exportTime)}`);
    if (data && data.id) {
      lines.push(`recordId: ${data.id}`);
    }
    lines.push('---');
    lines.push('');
    if (options.includeBranding !== false) {
      lines.push(`> by [Paper Burner X](${BRAND_LINK})`);
      lines.push('');
    }
    lines.push(`# ${modeLabel}导出`);
    lines.push('');
    if (data && data.name) {
      lines.push(`- 原始文件: ${escapeMarkdown(data.name)}`);
    }
    lines.push(`- 导出时间: ${formatDateTime(exportTime)}`);
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push(bodyMarkdown.trim());
    lines.push('');
    let output = lines.join('\n');
    if (options.markdownEmbedImages && data && Array.isArray(data.images)) {
      output = embedImagesInMarkdown(output, data.images);
    }
    return output;
  }

  function buildExportStyles(options = {}) {
    return `
.history-export-root {
  font-family: "Noto Sans SC", "PingFang SC", "Microsoft YaHei", Helvetica, Arial, sans-serif;
  background: #f7f9fc;
  margin: 0;
  padding: 32px 16px;
  color: #0f172a;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  min-height: 100vh;
  overflow-x: hidden;
}
.history-export-root .export-wrapper {
  width: 100%;
  max-width: 860px;
  margin: 0 auto;
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 18px 45px -24px rgba(30, 64, 175, 0.35);
  padding: 40px 48px;
  overflow-x: hidden;
}
.history-export-root .export-wrapper * {
  box-sizing: border-box;
}
.export-brand-note {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 999px;
  background: rgba(59,130,246,0.12);
  border: 1px solid rgba(59,130,246,0.18);
  color: #1d4ed8;
  font-size: 0.9rem;
  font-weight: 600;
  margin-bottom: 20px;
}
.export-brand-note a {
  color: #1d4ed8;
  text-decoration: none;
}
.export-brand-note a:hover {
  text-decoration: underline;
}
.history-export-root .export-header h1 {
  margin: 0 0 16px;
  font-size: 1.8rem;
  color: #1e3a8a;
}
.history-export-root .export-meta {
  list-style: none;
  padding: 16px 20px;
  margin: 0 0 32px;
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(59,130,246,0.12), rgba(37,99,235,0.05));
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px 16px;
}
.history-export-root .export-meta li {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.history-export-root .meta-label {
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #475569;
}
.history-export-root .meta-value {
  font-size: 1rem;
  color: #0f172a;
  word-break: break-word;
}
.history-export-root .export-section {
  margin-bottom: 36px;
}
.history-export-root .export-section h2 {
  margin: 0 0 16px;
  font-size: 1.4rem;
  color: #1e293b;
}
.history-export-root .markdown-body {
  line-height: 1.7;
  font-size: 1rem;
  color: #1f2937;
}
.history-export-root .markdown-body * {
  max-width: 100%;
}
.history-export-root .markdown-body p {
  margin: 0 0 1em;
}
.history-export-root .markdown-body h1,
.history-export-root .markdown-body h2,
.history-export-root .markdown-body h3,
.history-export-root .markdown-body h4 {
  margin: 1.5em 0 0.6em;
  color: #1d4ed8;
}
.history-export-root .markdown-body code {
  background: rgba(226,232,240,0.6);
  padding: 0.2em 0.45em;
  border-radius: 6px;
  font-size: 0.9em;
  word-break: break-word;
}
.history-export-root .markdown-body pre {
  padding: 16px;
  background: #0f172a;
  color: #f8fafc;
  border-radius: 10px;
  overflow: auto;
  white-space: pre-wrap;
}
.history-export-root .markdown-body table {
  width: 100%;
  border-collapse: collapse;
  margin: 16px 0;
  table-layout: fixed;
}
.history-export-root .markdown-body th,
.history-export-root .markdown-body td {
  border: 1px solid #dbeafe;
  padding: 10px 12px;
  vertical-align: top;
  word-break: break-word;
  overflow-wrap: anywhere;
}
.history-export-root .markdown-body th {
  background: #eff6ff;
  font-weight: 600;
  color: #1d4ed8;
}
.history-export-root .markdown-body img {
  max-width: 100%;
  height: auto;
}
.history-export-root .katex-display {
  overflow-x: auto;
}
.history-export-root .chunk-section {
  margin-bottom: 24px;
}
.history-export-root .chunk-section h3 {
  margin: 0 0 12px;
  color: #1e40af;
}
.history-export-root .chunk-table {
  width: 100%;
  border-collapse: collapse;
  box-shadow: inset 0 0 0 1px rgba(96,165,250,0.3);
  table-layout: fixed;
}
.history-export-root .chunk-table th,
.history-export-root .chunk-table td {
  border: 1px solid rgba(148,163,184,0.4);
  padding: 12px;
  vertical-align: top;
  width: 50%;
  word-break: break-word;
  overflow-wrap: anywhere;
}
.history-export-root .chunk-table th {
  background: rgba(59,130,246,0.12);
  text-align: left;
}
.history-export-root .empty-text {
  color: #94a3b8;
  margin: 0;
}
.history-export-root .align-flex {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  width: 100%;
  margin-bottom: 24px;
}
.history-export-root .align-flex .align-block {
  flex: 1 1 calc(50% - 9px);
  max-width: calc(50% - 9px);
  margin-bottom: 0;
}
.history-export-root .align-flex .align-block:only-child {
  flex-basis: 100%;
  max-width: 100%;
}
.history-export-root .align-flex .align-title {
  margin-bottom: 6px;
}
.history-export-root .align-flex .align-content {
  width: 100%;
}
.history-export-root .align-flex img {
  max-width: 100%;
  height: auto;
}
.history-export-root .align-flex table {
  width: 100% !important;
  table-layout: fixed;
}
.history-export-root .align-flex.table-pair {
  flex-direction: column;
  gap: 12px;
}
.history-export-root .align-flex.table-pair .align-block {
  flex-basis: 100%;
  max-width: 100%;
}
.history-export-root .align-content table {
  width: 100% !important;
  table-layout: fixed;
}

.history-export-root .export-chunk-compare {
  margin-top: 24px;
}
.history-export-root .export-chunk {
  margin-bottom: 32px;
}
.history-export-root .export-chunk h3 {
  margin: 0 0 12px;
  font-size: 1.2rem;
  color: #1e40af;
}
.history-export-root .export-pair {
  display: flex;
  align-items: stretch;
  gap: 16px;
  padding: 16px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #ffffff;
  margin-bottom: 16px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
}
.history-export-root .export-pair.export-pair-table,
.history-export-root .export-pair.export-pair-image {
  flex-direction: column;
  gap: 12px;
  background: #f8fbff;
}
.history-export-root .export-side {
  flex: 1 1 50%;
  min-width: 0;
}
.history-export-root .export-pair.export-pair-table .export-side,
.history-export-root .export-pair.export-pair-image .export-side {
  flex-basis: 100%;
  max-width: 100%;
}
.history-export-root .export-side + .export-side {
  border-left: 1px dashed #cbd5f5;
  padding-left: 12px;
}
.history-export-root .export-pair.export-pair-table .export-side + .export-side,
.history-export-root .export-pair.export-pair-image .export-side + .export-side {
  border-left: none;
  padding-left: 0;
  border-top: 1px dashed #cbd5f5;
  padding-top: 10px;
}
.history-export-root .export-side-title {
  font-weight: 600;
  color: #1d4ed8;
  margin-bottom: 6px;
}
.history-export-root .export-side-content {
  line-height: 1.7;
}
.history-export-root .export-side-content img {
  max-width: 100%;
  height: auto;
}
.history-export-root .export-side-content table {
  width: 100% !important;
  table-layout: fixed;
  overflow-wrap: anywhere;
}
.history-export-root .export-side-content td,
.history-export-root .export-side-content th {
  word-break: break-word;
}
.history-export-root .export-side-content pre {
  overflow-x: auto;
  padding: 12px;
  background: #0f172a;
  color: #f8fafc;
  border-radius: 8px;
}
.history-export-root .export-side-content {
  overflow-x: auto;
}
.history-export-root .export-single {
  margin-bottom: 24px;
}
.history-export-root .export-single:last-child {
  margin-bottom: 0;
}
.history-export-root .align-content td,
.history-export-root .align-content th {
  word-break: break-word;
}
@media (max-width: 768px) {
  .history-export-root {
    padding: 16px;
  }
  .history-export-root .export-wrapper {
    padding: 28px;
  }
  .history-export-root .export-meta {
    grid-template-columns: 1fr;
  }
  .history-export-root .align-flex {
    gap: 12px;
  }
  .history-export-root .align-flex .align-block {
    flex-basis: 100%;
    max-width: 100%;
  }
  .history-export-root .align-flex.table-pair {
    gap: 8px;
  }
  .history-export-root .align-flex.table-pair .align-block {
    flex-basis: 100%;
    max-width: 100%;
  }
  .history-export-root .export-pair {
    flex-direction: column;
    gap: 12px;
    padding: 12px;
  }
  .history-export-root .export-side {
    flex-basis: 100%;
    max-width: 100%;
  }
  .history-export-root .export-side + .export-side {
    border-left: none;
    padding-left: 0;
    border-top: 1px dashed #cbd5f5;
    padding-top: 10px;
  }
}
`.trim();
  }

  function buildFileName(payload, ext) {
    const modeKey = payload.tab.replace(/[^a-z\-]/gi, '') || 'export';
    const timestamp = formatTimestamp(payload.exportTime);
    return `${payload.fileNameBase}_${modeKey}_${timestamp}.${ext}`;
  }

  function saveBlob(content, fileName, mimeType) {
    if (typeof saveAs !== 'function') {
      throw new Error('文件保存组件不可用');
    }
    const blob = new Blob([content], { type: mimeType });
    saveAs(blob, fileName);
  }

  function renderMarkdown(markdown, images) {
    const source = typeof markdown === 'string' ? markdown : '';
    if (!source.trim()) return '';
    if (window.MarkdownProcessor && typeof window.MarkdownProcessor.safeMarkdown === 'function' && typeof window.MarkdownProcessor.renderWithKatexFailback === 'function') {
      const safeMd = window.MarkdownProcessor.safeMarkdown(source, images);
      return window.MarkdownProcessor.renderWithKatexFailback(safeMd);
    }
    if (window.marked && typeof window.marked.parse === 'function') {
      return window.marked.parse(source);
    }
    return `<pre>${escapeHtml(source)}</pre>`;
  }

  function formatMarkdownTableCell(content) {
    if (!content || !content.trim()) return '（无内容）';
    const sanitized = content
      .replace(/\|/g, '\\|')
      .split(/\n+/)
      .map(function(line) { return line.trim(); })
      .filter(Boolean)
      .join('<br>');
    return sanitized || '（无内容）';
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
    constructor(payload, options = {}) {
      this.payload = payload;
      this.options = Object.assign({}, options);
      this.relationships = [];
      this.mediaFiles = [];
      this.mediaExtensions = new Set();
      this.relIdCounter = 1;
      this.imageCounter = 1;
      this.drawingCounter = 1;
      this.mathConverter = new MathMlToOmmlConverter();
      this.footerInfo = null;

      const parser = new DOMParser();
      const wrapped = `<div>${payload.bodyHtml || ''}</div>`;
      this.dom = parser.parseFromString(wrapped, 'text/html');
    }

    build() {
      const bodyNodes = Array.from(this.dom.body.childNodes || []);
      const bodyParts = [];
      const rootContext = { maxWidthTwip: 9360 };
      bodyNodes.forEach(node => {
        bodyParts.push(...this.convertBlock(node, rootContext));
      });

      const footerInfo = this.ensureFooter();
      bodyParts.push(this.buildSectionProperties({ footerRelId: footerInfo && footerInfo.id }));

      const introParagraphs = this.buildIntroCardParagraphs();
      const bodyXml = introParagraphs.join('') + bodyParts.join('');
      const documentXml = this.wrapDocument(bodyXml);

      return {
        documentXml,
        relationships: this.relationships,
        mediaFiles: this.mediaFiles,
        mediaExtensions: Array.from(this.mediaExtensions),
        footerXml: footerInfo && footerInfo.xml,
        footerFileName: footerInfo && footerInfo.fileName
      };
    }

    wrapDocument(bodyXml) {
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
${bodyXml}
  </w:body>
</w:document>`;
    }

    buildIntroCardParagraphs() {
      const info = collectIntroCardInfo(this.payload);
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
        cardLines.push(this.createHyperlinkRun('by Paper Burner X', BRAND_LINK, { italic: true }));
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

      if (classList.contains('katex-display')) {
        return [this.createBlockFormula(el)];
      }

      switch (tag) {
        case 'p':
          return [this.createParagraph(el, { maxWidthTwip: context.maxWidthTwip })];
        case 'h1':
          return [this.createParagraph(el, { style: 'Heading1', maxWidthTwip: context.maxWidthTwip })];
        case 'h2':
          return [this.createParagraph(el, { style: 'Heading2', maxWidthTwip: context.maxWidthTwip })];
        case 'h3':
          return [this.createParagraph(el, { style: 'Heading3', maxWidthTwip: context.maxWidthTwip })];
        case 'h4':
          return [this.createParagraph(el, { style: 'Heading4', maxWidthTwip: context.maxWidthTwip })];
        case 'h5':
          return [this.createParagraph(el, { style: 'Heading5', maxWidthTwip: context.maxWidthTwip })];
        case 'h6':
          return [this.createParagraph(el, { style: 'Heading6', maxWidthTwip: context.maxWidthTwip })];
        case 'ul':
          return this.convertList(el, false, context);
        case 'ol':
          return this.convertList(el, true, context);
        case 'li':
          return [this.createParagraph(el, { maxWidthTwip: context.maxWidthTwip })];
        case 'table':
          return [this.convertTable(el, context.maxWidthTwip)];
        case 'thead':
        case 'tbody':
        case 'tfoot':
          return this.convertChildren(el.childNodes, context);
        case 'tr':
          return [this.convertTableRow(el)];
        case 'td':
        case 'th': {
          const widthHint = context.maxWidthTwip && context.maxWidthTwip > 0 ? Math.max(0, context.maxWidthTwip) : 2340;
          return [this.convertTableCell(el, widthHint)];
        }
        case 'pre':
          return [this.createParagraph(el, { codeBlock: true, maxWidthTwip: context.maxWidthTwip })];
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
          return [this.createParagraph(el, { maxWidthTwip: context.maxWidthTwip })];
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
        return [this.createParagraph(el, { maxWidthTwip: context.maxWidthTwip })];
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

    convertTable(tableEl, parentWidthTwip) {
      const rows = [];
      const tableRows = Array.from(tableEl.rows || []);
      const columnCount = tableRows.reduce((max, tr) => Math.max(max, tr.cells ? tr.cells.length : 0), 0) || 1;
      const tableWidth = parentWidthTwip && parentWidthTwip > 0 ? Math.min(9360, parentWidthTwip) : 9360;
      const cellWidth = Math.floor(tableWidth / columnCount);
      const gridCols = new Array(columnCount).fill(0).map(() => `<w:gridCol w:w="${cellWidth}"/>`).join('');

      tableRows.forEach(tr => {
        rows.push(this.convertTableRow(tr, cellWidth));
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

    convertTableRow(tr, cellWidth) {
      const cellsArr = Array.from(tr.cells || []);
      let effectiveWidth = cellWidth;
      if (!effectiveWidth) {
        const tableWidth = 9360;
        const count = cellsArr.length || 1;
        effectiveWidth = Math.floor(tableWidth / count);
      }
      const cells = cellsArr.map(cell => this.convertTableCell(cell, effectiveWidth)).join('');
      return `<w:tr>${cells}</w:tr>`;
    }

    convertTableCell(cellEl, cellWidth) {
      const cellContent = [];
      const childNodes = Array.from(cellEl.childNodes || []);
      if (childNodes.length === 0) {
        cellContent.push(this.createParagraphFromRuns(this.createTextRun('', {})));
      } else {
        childNodes.forEach(child => {
          const blocks = this.convertBlock(child, { maxWidthTwip: Math.max(0, cellWidth - 240) });
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
      const inlineContext = { maxWidthTwip: options.maxWidthTwip };
      if (options.codeBlock) {
        inlineContext.code = true;
      }
      const runs = this.convertInline(Array.from(element.childNodes || []), inlineContext);
      return this.createParagraphFromRuns(runs, options);
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
          runs += this.createInlineFormula(el, false);
          return;
        }
        if (tag === 'span' && el.classList.contains('katex-display')) {
          runs += this.createInlineFormula(el, true);
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
      processed = processed.replace(/\r\n/g, '\n');
      if (!context.code) {
        processed = processed.replace(/\s+/g, ' ');
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
        const textXml = `<w:t xml:space="preserve">${escapeXml(segment)}</w:t>`;
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
      const src = imgEl.getAttribute('src');
      if (!src || !src.startsWith('data:image')) {
        return this.createTextRun('[图片]', {});
      }
      const match = src.match(/^data:(image\/([a-zA-Z0-9]+));base64,(.*)$/);
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

      const dimensions = this.extractImageDimensions(imgEl, context);
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

    extractImageDimensions(imgEl, context = {}) {
      const widthAttr = imgEl.getAttribute('width');
      const heightAttr = imgEl.getAttribute('height');
      const style = imgEl.getAttribute('style') || '';
      let width = this.parsePixelValue(widthAttr) || this.parseStyleDimension(style, 'width');
      let height = this.parsePixelValue(heightAttr) || this.parseStyleDimension(style, 'height');

      if ((!width || !height) && imgEl.getAttribute('src')) {
        const base64Match = imgEl.getAttribute('src').match(/^data:image\/([a-zA-Z0-9]+);base64,(.*)$/);
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

    createInlineFormula(element, isDisplay) {
      try {
        const mathEl = element.querySelector('math');
        if (!mathEl) {
          const texNode = element.querySelector('annotation[encoding="application/x-tex"]');
          const fallback = texNode ? texNode.textContent : element.getAttribute('data-original-text') || element.innerText || element.textContent || '';
          const clean = fallback.replace(/[\s]+/g, ' ').trim();
          return clean ? this.createTextRun(clean, {}) : '';
        }
        const ommlCore = this.mathConverter.convert(mathEl);
        if (ommlCore) {
          return `<w:r>${ommlCore}</w:r>`;
        }
        const texNode = element.querySelector('annotation[encoding="application/x-tex"]');
        const fallback = texNode ? texNode.textContent : mathEl.textContent || '';
        const clean = fallback.replace(/[\s]+/g, ' ').trim();
        return clean ? this.createTextRun(clean, {}) : '';
      } catch (err) {
        const texNode = element.querySelector('annotation[encoding="application/x-tex"]');
        const text = texNode ? texNode.textContent : element.innerText || element.textContent || '';
        const clean = text.replace(/[\s]+/g, ' ').trim();
        return clean ? this.createTextRun(clean, {}) : '';
      }
    }

    createBlockFormula(element) {
      const mathEl = element.querySelector('math');
      if (!mathEl) {
        const texNode = element.querySelector('annotation[encoding="application/x-tex"]');
        const fallback = texNode ? texNode.textContent : element.getAttribute('data-original-text') || element.innerText || element.textContent || '';
        const clean = fallback.replace(/[\s]+/g, ' ').trim();
        return clean ? this.createParagraphFromRuns(this.createTextRun(clean, {})) : '';
      }
      const omml = this.mathConverter.convert(mathEl);
      if (!omml) {
        const texNode = element.querySelector('annotation[encoding="application/x-tex"]');
        const fallback = texNode ? texNode.textContent : mathEl.textContent || '';
        const clean = fallback.replace(/[\s]+/g, ' ').trim();
        return clean ? this.createParagraphFromRuns(this.createTextRun(clean, {})) : '';
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
      const inner = this.convertChildren(mathEl.childNodes);
      if (!inner) return '';
      return `<m:oMath>${inner}</m:oMath>`;
    }

    convertChildren(nodeList) {
      let result = '';
      Array.from(nodeList || []).forEach(node => {
        result += this.convertNode(node);
      });
      return result;
    }

    convertNode(node) {
      if (!node) return '';
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
          return `<m:sSup>${this.wrapWith('m:e', this.convertNode(childNodes[0]))}${this.wrapWith('m:sup', this.convertNode(childNodes[1]))}</m:sSup>`;
        case 'msub':
          return `<m:sSub>${this.wrapWith('m:e', this.convertNode(childNodes[0]))}${this.wrapWith('m:sub', this.convertNode(childNodes[1]))}</m:sSub>`;
        case 'msubsup':
          return `<m:sSubSup>${this.wrapWith('m:e', this.convertNode(childNodes[0]))}${this.wrapWith('m:sub', this.convertNode(childNodes[1]))}${this.wrapWith('m:sup', this.convertNode(childNodes[2]))}</m:sSubSup>`;
        case 'mfrac':
          return `<m:f>${this.wrapWith('m:num', this.convertNode(childNodes[0]))}${this.wrapWith('m:den', this.convertNode(childNodes[1]))}</m:f>`;
        case 'msqrt':
          return `<m:rad><m:deg><m:degHide/></m:deg>${this.wrapWith('m:e', this.convertChildren(childNodes))}</m:rad>`;
        case 'mroot':
          return `<m:rad>${this.wrapWith('m:deg', this.convertNode(childNodes[1]))}${this.wrapWith('m:e', this.convertNode(childNodes[0]))}</m:rad>`;
        case 'mfenced':
          return `${this.createTextRun('(')}${this.convertChildren(childNodes)}${this.createTextRun(')')}`;
        case 'mover':
          return `<m:sSup>${this.wrapWith('m:e', this.convertNode(childNodes[0]))}${this.wrapWith('m:sup', this.convertNode(childNodes[1]))}</m:sSup>`;
        case 'munder':
          return `<m:sSub>${this.wrapWith('m:e', this.convertNode(childNodes[0]))}${this.wrapWith('m:sub', this.convertNode(childNodes[1]))}</m:sSub>`;
        case 'munderover':
          return `<m:sSubSup>${this.wrapWith('m:e', this.convertNode(childNodes[0]))}${this.wrapWith('m:sub', this.convertNode(childNodes[1]))}${this.wrapWith('m:sup', this.convertNode(childNodes[2]))}</m:sSubSup>`;
        default:
          return this.convertChildren(childNodes);
      }
    }

    wrapWith(tag, content) {
      const inner = content && content.trim() ? content : this.createTextRun(' ');
      return `<${tag}>${inner}</${tag}>`;
    }

    createTextRun(text) {
      const normalized = text.replace(/\s+/g, ' ');
      if (!normalized) return '';
      return `<m:r><m:t xml:space="preserve">${escapeXml(normalized)}</m:t></m:r>`;
    }
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
      if (lower === 'jpg') mime = 'image/jpeg';
      if (lower === 'jpeg') mime = 'image/jpeg';
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

  function escapeMarkdown(str) {
    return String(str).replace(/[\\`*_{}\[\]()#+\-.!]/g, '\\$&');
  }

})(window, document);

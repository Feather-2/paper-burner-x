(function(window, document) {
  const KATEX_CDN = 'https://gcore.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css';

  const EXPORT_LABELS = {
    original: '原格式',
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

  const PDF_PAPER_DIMENSIONS = {
    A4: { width: 210, height: 297 },
    A3: { width: 297, height: 420 },
    A2: { width: 420, height: 594 }
  };

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

    const originalDisabled = triggerButton.disabled;
    const originalHtml = triggerButton.innerHTML;
    try {
      triggerButton.disabled = true;
      const loadingLabel = `导出${EXPORT_LABELS[format] || ''}中...`;
      triggerButton.innerHTML = `<i class="fa fa-spinner fa-spin"></i><span>${loadingLabel}</span>`;
      if (format === 'original') {
        const originalAsset = buildOriginalAssetForDetail(data);
        if (!originalAsset) {
          alert('当前记录缺少原始内容，无法导出。');
          return;
        }
        const baseName = sanitizeFileName(data.name || 'document');
        const fileName = ensureFileExtension(baseName, originalAsset.extension || 'txt');
        saveAs(originalAsset.blob, fileName);
      } else {
        const payload = buildExportPayload(activeTab, data);
        if (!payload) {
          alert('当前视图没有可导出的内容。');
          return;
        }
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
      }
    } catch (error) {
      console.error('[HistoryExporter] 导出失败:', error);
      alert('导出失败：' + (error && error.message ? error.message : error));
    } finally {
      triggerButton.disabled = originalDisabled;
      triggerButton.innerHTML = originalHtml;
    }
  }

  function resolveExportImages(data) {
    if (data && Array.isArray(data.images) && data.images.length > 0) {
      return data.images;
    }
    if (Array.isArray(window.currentImagesData) && window.currentImagesData.length > 0) {
      return window.currentImagesData;
    }
    if (data && data.data && Array.isArray(data.data.images) && data.data.images.length > 0) {
      return data.data.images;
    }
    return [];
  }

  function buildExportPayload(tab, data) {
    const modeLabel = MODE_LABELS[tab] || '未知模式';
    const exportTime = new Date();
    const fileNameBase = sanitizeFileName(data && data.name ? data.name.replace(/\s+/g, ' ').trim() : '历史记录');
    const images = resolveExportImages(data);

    if (tab === 'ocr') {
      const markdown = getOcrMarkdown(data);
      if (!markdown.trim()) return null;
      const html = buildMarkdownSectionHtml(modeLabel, markdown, images);
      return {
        tab,
        modeLabel,
        exportTime,
        fileNameBase,
        data,
        images,
        bodyMarkdown: markdown,
        bodyHtml: html
      };
    }

    if (tab === 'translation') {
      const markdown = getTranslationMarkdown(data);
      if (!markdown.trim()) return null;
      const html = buildMarkdownSectionHtml(modeLabel, markdown, images);
      return {
        tab,
        modeLabel,
        exportTime,
        fileNameBase,
        data,
        images,
        bodyMarkdown: markdown,
        bodyHtml: html
      };
    }

    if (tab === 'chunk-compare') {
      const pairs = buildChunkPairs(data);
      if (!pairs.length) return null;
      const html = buildChunkCompareHtml(modeLabel, pairs, images);
      const markdown = buildChunkCompareMarkdown(pairs);
      return {
        tab,
        modeLabel,
        exportTime,
        fileNameBase,
        data,
        images,
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
    const fileName = resolveFileName(payload, 'html', options);
    if (options.returnContent) {
      return {
        fileName,
        content: documentHtml,
        mime: 'text/html;charset=utf-8'
      };
    }
    if (options.returnBlob) {
      return {
        fileName,
        blob: new Blob([documentHtml], { type: 'text/html;charset=utf-8' })
      };
    }
    saveBlob(documentHtml, fileName, 'text/html;charset=utf-8');
  }

  function exportAsMarkdown(payload, options = {}) {
    const markdown = buildMarkdownDocument(payload, options);
    const fileName = resolveFileName(payload, 'md', options);
    if (options.returnContent) {
      return {
        fileName,
        content: markdown,
        mime: 'text/markdown;charset=utf-8'
      };
    }
    if (options.returnBlob) {
      return {
        fileName,
        blob: new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
      };
    }
    saveBlob(markdown, fileName, 'text/markdown;charset=utf-8');
  }

  async function exportAsDocx(payload, options = {}) {
    const module = window.PBXHistoryExporterDocx;
    if (!module || typeof module.exportAsDocx !== 'function') {
      throw new Error('DOCX 导出模块未加载');
    }

    // 检查是否有调试参数（在 URL 中或 localStorage）
    const urlParams = new URLSearchParams(window.location.search);
    const enableDebug = urlParams.has('docx-debug') || localStorage.getItem('docx-debug') === 'true';

    // 合并选项，如果启用调试则添加调试参数
    const finalOptions = {
      ...options,
      debug: options.debug || enableDebug,
      strictValidation: options.strictValidation || enableDebug,
      validateXml: options.validateXml !== false // 默认启用
    };

    if (enableDebug) {
      console.log('🐛 DOCX 调试模式已启用');
      console.log('提示: 在控制台查看详细的导出日志');
    }

    const helpers = {
      resolveFileName,
      getOcrMarkdown,
      getTranslationMarkdown,
      formatDateTime,
      BRAND_LINK
    };

    return module.exportAsDocx(payload, finalOptions, helpers);
  }

  function getPaperDimensions(paper) {
    if (!paper) return null;
    const key = paper.toString().trim().toUpperCase();
    return PDF_PAPER_DIMENSIONS[key] || null;
  }

  function mmToPx(mm) {
    return mm * 3.7795275591;
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
      const clamped = Math.max(10, Math.min(400, options.pdfScalePercent));
      rootElement.style.fontSize = clamped + '%';
      rootElement.style.transform = '';
      rootElement.style.width = '';
    }

    if (rootElement) {
      const wrapperElement = rootElement.querySelector('.export-wrapper');
      const paperDimensions = getPaperDimensions(options.pdfPaper);
      const margins = Object.assign({ left: 15, right: 15 }, options.pdfMargins || {});
      if (wrapperElement && paperDimensions) {
        const safeLeft = Number.isFinite(margins.left) ? margins.left : 15;
        const safeRight = Number.isFinite(margins.right) ? margins.right : 15;
        const printableWidthMm = Math.max(60, paperDimensions.width - safeLeft - safeRight);
        const printableWidthPx = mmToPx(printableWidthMm);
        wrapperElement.style.maxWidth = printableWidthPx + 'px';
        wrapperElement.style.width = printableWidthPx + 'px';
      } else if (wrapperElement) {
        wrapperElement.style.maxWidth = '';
        wrapperElement.style.width = '';
      }
    }

    // 尝试在打印前对表格内的公式做一次自适应缩放，避免拥挤/遮挡
    try {
      autoscaleFormulasInContainer(rootElement);
      // 再次触发一次，确保样式应用后尺寸稳定
      setTimeout(function(){ autoscaleFormulasInContainer(rootElement); }, 30);
    } catch (e) {
      console.warn('[HistoryExporter] autoscaleFormulasInContainer failed:', e);
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
          // 打印前最后再执行一次自适应，确保分页/布局最终稳定
          try { autoscaleFormulasInContainer(rootElement); } catch {}
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
    const paperKey = (options.pdfPaper || 'A4').toString().trim().toUpperCase();
    const paperDimensions = getPaperDimensions(paperKey);
    const pageSizeValue = paperDimensions ? `${paperDimensions.width}mm ${paperDimensions.height}mm` : `${paperKey} portrait`;
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
  size: ${pageSizeValue};
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
.history-export-root .katex-block {
  margin: 16px 0;
  text-align: center;
  overflow-x: auto;
  padding: 12px 16px;
  box-sizing: border-box;
  position: relative;
}
.history-export-root .katex-block .katex-display {
  display: inline-block;
  margin: 0 auto;
  text-align: left;
  position: relative;
  /* 预留更充足的右侧空间给公式右标（如 \tag 或编号） */
  padding-right: 4.25em;
}
.history-export-root .katex-display {
  position: relative;
  padding-right: 4.25em;
  box-sizing: border-box;
}
.history-export-root .katex-display .katex-tag,
.history-export-root .katex-display .tag,
.history-export-root .katex .katex-tag,
.history-export-root .katex .tag {
  position: absolute;
  right: 0;
  top: 0;
  height: 100%;
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
  margin-left: 0.5em;
}
.history-export-root .katex-display > .katex {
  max-width: calc(100% - 4.25em);
}
.history-export-root .katex-block .katex-display .katex-tag { right: 0; }
.history-export-root .katex-inline { margin: 0 1px; }
.history-export-root .katex-fallback {
  background-color: #fff5f5;
  border: 1px dashed #f56565;
  border-radius: 6px;
  color: #c53030;
  font-family: 'Courier New', Consolas, monospace;
}
.history-export-root .katex-fallback.katex-block {
  text-align: left;
  padding: 12px 16px;
  white-space: normal;
}
.history-export-root .katex-fallback.katex-inline {
  display: inline-flex;
  align-items: center;
  padding: 0 6px;
}
.history-export-root .katex-fallback-source {
  white-space: pre-wrap;
  word-break: break-word;
}
/* 覆盖 display 方式：使用块级，使右侧编号在容器最右侧定位，避免与公式主体重叠 */
.history-export-root .katex-display,
.history-export-root .katex-block .katex-display {
  display: block;
  width: 100%;
  text-align: center;
}
.history-export-root .katex-block { page-break-inside: avoid; }
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
  -ms-overflow-style: none; /* IE/Edge */
  scrollbar-width: none;    /* Firefox */
}
.history-export-root .katex-display::-webkit-scrollbar { display: none; }
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
.history-export-root .export-side-content table .katex-display,
.history-export-root .export-side-content table .katex-inline {
  font-size: 0.95em; /* 默认略缩小，减少拥挤概率 */
}
.history-export-root td, .history-export-root th {
  line-height: 1.6; /* 表格内行距更大，避免上下覆盖 */
}
.history-export-root .katex,
.history-export-root .katex-display {
  line-height: 1.35; /* 提高 KaTeX 的行高，打印更稳 */
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

  /**
   * 对表格内的 KaTeX 公式做简单的自适应：若宽度超出单元格，则按比例缩小字体。
   * 仅用于导出/打印场景，避免公式挤压覆盖。
   */
  function autoscaleFormulasInContainer(root) {
    if (!root) return;
    const candidates = root.querySelectorAll('.export-side-content table .katex, .export-side-content table .katex-display, .export-side-content table .katex-inline');
    candidates.forEach(function(el){
      el.style.fontSize = '';
      el.style.transform = '';
      el.style.transformOrigin = '';
      el.style.lineHeight = '';
    });
    candidates.forEach(function(el){
      const cell = el.closest('td, th') || el.parentElement;
      if (!cell) return;
      const cellWidth = Math.max(0, cell.clientWidth - 8);
      const rect = el.getBoundingClientRect();
      const width = rect.width;
      if (cellWidth > 0 && width > cellWidth) {
        const currentFont = parseFloat(window.getComputedStyle(el).fontSize) || 16;
        const scale = Math.max(0.7, Math.min(1, (cellWidth / width) * 0.98));
        el.style.fontSize = (currentFont * scale).toFixed(2) + 'px';
        el.style.lineHeight = '1.35';
      }
    });
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

  function buildOriginalAssetForDetail(data) {
    if (!data) return null;
    const extension = (data.originalExtension || data.fileType || 'txt').toLowerCase();
    if (data.originalEncoding === 'text' && typeof data.originalContent === 'string') {
      const mime = guessMimeType(extension, true);
      return {
        blob: new Blob([data.originalContent], { type: `${mime};charset=utf-8` }),
        extension
      };
    }
    if (data.originalEncoding && data.originalEncoding !== 'text' && data.originalBinary) {
      const buffer = base64ToArrayBuffer(data.originalBinary);
      if (!buffer) return null;
      const mime = guessMimeType(extension, false);
      return {
        blob: new Blob([buffer], { type: mime }),
        extension
      };
    }
    return null;
  }

  function guessMimeType(ext, isText) {
    const lowercase = (ext || '').toLowerCase();
    if (isText) {
      if (lowercase === 'html' || lowercase === 'htm') return 'text/html';
      if (lowercase === 'md' || lowercase === 'markdown') return 'text/markdown';
      if (lowercase === 'yaml' || lowercase === 'yml') return 'text/yaml';
      if (lowercase === 'json') return 'application/json';
      if (lowercase === 'txt') return 'text/plain';
      return 'text/plain';
    }
    if (lowercase === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (lowercase === 'pptx') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    if (lowercase === 'epub') return 'application/epub+zip';
    if (lowercase === 'pdf') return 'application/pdf';
    return 'application/octet-stream';
  }

  function base64ToArrayBuffer(base64) {
    try {
      const binaryString = atob(base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes.buffer;
    } catch (error) {
      console.warn('[HistoryExporter] base64ToArrayBuffer failed:', error);
      return null;
    }
  }

  window.PBXHistoryExporter = window.PBXHistoryExporter || {};
  Object.assign(window.PBXHistoryExporter, {
    preparePayload: function(mode, data) {
      return buildExportPayload(mode, data);
    },
    exportAsHtml,
    exportAsMarkdown,
    exportAsDocx,
    exportAsPdf,
    resolveFileName,
    ensureFileExtension,
    sanitizeFileName,
    buildExportStyles,
    buildMainContent,
    formatTimestamp,
    katexCdn: KATEX_CDN
  });

})(window, document);

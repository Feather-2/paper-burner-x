/**
 * DOCX 导出诊断工具
 * 用于检测和诊断 DOCX 导出中可能导致文件无法打开的问题
 */

(function(window) {
  'use strict';

  /**
   * 诊断 DOCX 导出问题
   * @param {Object} payload - 导出数据
   * @param {Object} options - 导出选项
   * @returns {Object} 诊断报告
   */
  function diagnoseDOCXExport(payload, options = {}) {
    const report = {
      timestamp: new Date().toISOString(),
      issues: [],
      warnings: [],
      info: {},
      passed: true
    };

    console.log('🔍 开始 DOCX 导出诊断...');

    // 1. 检查 payload 基本结构
    if (!payload) {
      report.issues.push('payload 为空');
      report.passed = false;
    } else {
      report.info.hasBodyHtml = !!payload.bodyHtml;
      report.info.bodyHtmlLength = payload.bodyHtml ? payload.bodyHtml.length : 0;
      report.info.hasImages = Array.isArray(payload.images) && payload.images.length > 0;
      report.info.imageCount = payload.images ? payload.images.length : 0;
    }

    // 2. 检查 HTML 内容中的潜在问题
    if (payload && payload.bodyHtml) {
      const html = payload.bodyHtml;

      // 检查非法字符
      const illegalChars = html.match(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F]/g);
      if (illegalChars) {
        report.warnings.push(`HTML 中发现 ${illegalChars.length} 个非法控制字符`);
        console.warn('⚠ 非法字符位置:', illegalChars.map(c => '0x' + c.charCodeAt(0).toString(16)).join(', '));
      }

      // 检查公式数量
      const formulaCount = (html.match(/<math/g) || []).length;
      const katexCount = (html.match(/class="katex/g) || []).length;
      report.info.mathmlCount = formulaCount;
      report.info.katexCount = katexCount;
      report.info.totalFormulas = formulaCount + katexCount;

      if (report.info.totalFormulas > 50) {
        report.warnings.push(`包含大量公式 (${report.info.totalFormulas} 个)，可能影响转换性能`);
      }

      // 检查表格数量
      const tableCount = (html.match(/<table/g) || []).length;
      report.info.tableCount = tableCount;

      // 检查特殊字符
      const ampersandCount = (html.match(/&(?!amp;|lt;|gt;|quot;|apos;|#)/g) || []).length;
      if (ampersandCount > 0) {
        report.warnings.push(`发现 ${ampersandCount} 个未转义的 & 符号`);
      }

      // 检查标签平衡
      const openTags = (html.match(/<[^/][^>]*>/g) || []).length;
      const closeTags = (html.match(/<\/[^>]*>/g) || []).length;
      const selfCloseTags = (html.match(/<[^>]*\/>/g) || []).length;
      report.info.tagBalance = { open: openTags, close: closeTags, selfClose: selfCloseTags };

      if (openTags - selfCloseTags !== closeTags) {
        report.warnings.push(`HTML 标签可能不平衡 (开始:${openTags}, 结束:${closeTags}, 自闭合:${selfCloseTags})`);
      }
    }

    // 3. 尝试模拟构建过程
    try {
      console.log('🔨 模拟构建 DOCX...');
      const parser = new DOMParser();
      const wrapped = `<div>${payload.bodyHtml || ''}</div>`;
      const dom = parser.parseFromString(wrapped, 'text/html');

      if (dom.querySelector('parsererror')) {
        report.issues.push('HTML 解析失败，包含语法错误');
        report.passed = false;
      }

      const bodyNodes = Array.from(dom.body.childNodes || []);
      report.info.bodyNodeCount = bodyNodes.length;

      // 检查是否有问题节点
      let problematicNodes = 0;
      bodyNodes.forEach((node, index) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const tag = node.tagName.toLowerCase();

          // 检查是否有未知或问题标签
          if (tag === 'script' || tag === 'style') {
            report.warnings.push(`发现 ${tag} 标签，可能影响导出`);
          }

          // 检查深度嵌套
          const depth = getNodeDepth(node);
          if (depth > 20) {
            report.warnings.push(`节点 ${index} 嵌套过深 (${depth} 层)`);
            problematicNodes++;
          }
        }
      });

      report.info.problematicNodes = problematicNodes;

    } catch (error) {
      report.issues.push(`模拟构建失败: ${error.message}`);
      report.passed = false;
    }

    // 4. 生成报告
    console.log('\n📊 诊断报告:');
    console.log('═'.repeat(60));

    if (report.issues.length > 0) {
      console.error('❌ 严重问题:');
      report.issues.forEach(issue => console.error(`  • ${issue}`));
    }

    if (report.warnings.length > 0) {
      console.warn('\n⚠ 警告:');
      report.warnings.forEach(warning => console.warn(`  • ${warning}`));
    }

    console.log('\nℹ️ 信息:');
    Object.entries(report.info).forEach(([key, value]) => {
      console.log(`  • ${key}: ${JSON.stringify(value)}`);
    });

    console.log('\n' + '═'.repeat(60));
    console.log(report.passed ? '✅ 诊断通过' : '❌ 发现问题');

    return report;
  }

  /**
   * 计算节点深度
   */
  function getNodeDepth(node, depth = 0) {
    if (!node || !node.childNodes || node.childNodes.length === 0) {
      return depth;
    }

    let maxDepth = depth;
    Array.from(node.childNodes).forEach(child => {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const childDepth = getNodeDepth(child, depth + 1);
        if (childDepth > maxDepth) {
          maxDepth = childDepth;
        }
      }
    });

    return maxDepth;
  }

  /**
   * 导出 DOCX 并启用详细日志
   */
  async function exportDOCXWithDiagnostics(payload, options = {}, helpers = {}) {
    // 先运行诊断
    const report = diagnoseDOCXExport(payload, options);

    if (!report.passed) {
      const continueExport = confirm('诊断发现问题，是否继续导出？\n\n问题:\n' + report.issues.join('\n'));
      if (!continueExport) {
        throw new Error('用户取消导出');
      }
    }

    // 启用调试模式导出
    const diagnosticOptions = {
      ...options,
      debug: true,
      strictValidation: true,
      validateXml: true
    };

    console.log('\n📦 开始导出 DOCX (调试模式)...');

    try {
      await exportAsDocx(payload, diagnosticOptions, helpers);
      console.log('✅ 导出成功！');
    } catch (error) {
      console.error('❌ 导出失败:', error);
      throw error;
    }
  }

  // 暴露到全局
  window.diagnoseDOCXExport = diagnoseDOCXExport;
  window.exportDOCXWithDiagnostics = exportDOCXWithDiagnostics;

})(window);

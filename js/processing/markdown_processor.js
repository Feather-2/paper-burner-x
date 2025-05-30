// js/markdown_processor.js
(function MarkdownProcessor(global) {
    // 缓存已经渲染好的 HTML，避免重复运行 heavy marked.parse and KaTeX
    const renderCache = new Map();

    /**
     * 预处理 Markdown 文本，以安全地渲染图片、自定义语法（如上下标）并兼容 KaTeX。
     * - 将 Markdown 中的本地图片引用 (e.g., `![alt](images/img-1.jpeg.png)`) 替换为 Base64 嵌入式图片。
     * - 解析自定义的上下标语法 (e.g., `${base}^{sup}$`, `${base}_{sub}$`) 并转换为 HTML `<sup>` 和 `<sub>` 标签。
     * - 其他如 `$formula$` 和 `$$block formula$$` 的 LaTeX 标记会保留，交由后续的 `renderWithKatexFailback` 处理。
     *
     * @param {string} md -输入的 Markdown 文本。
     * @param {Array<Object>} images -一个包含图片对象的数组，每个对象应有 `name` 或 `id` (用于匹配) 和 `data` (Base64 图片数据或其前缀)。
     * @returns {string} 处理后的 Markdown 文本，其中图片被替换，自定义语法被转换。
     */
    function safeMarkdown(md, images) {
      performance.mark('safeMarkdown-start');
      if (!md) {
        performance.mark('safeMarkdown-end');
        performance.measure('safeMarkdown', 'safeMarkdown-start', 'safeMarkdown-end');
        return '';
      }
      // 构建图片名与base64的映射表，支持多种key
      let imgMap = {};
      if (Array.isArray(images)) {
        images.forEach((img, idx) => {
          let keys = [];
          if (img.name) keys.push(img.name);
          if (img.id) keys.push(img.id);
          keys.push(`img-${idx}.jpeg.png`);
          keys.push(`img-${idx+1}.jpeg.png`);
          // 兼容 images/ 前缀
          keys = keys.concat(keys.map(k => 'images/' + k));
          let src = img.data.startsWith('data:') ? img.data : 'data:image/png;base64,' + img.data;
          keys.forEach(k => imgMap[k] = src);
        });
      }
      // 替换Markdown中的本地图片引用为base64
      md = md.replace(/!\[.*?\]\((?:images\/)?(img-\d+\.jpeg\.png)\)/gi, function(_, fname) {
        if (imgMap[fname]) {
          return `![](${imgMap[fname]})`;
        } else {
          // 如果图片在映射中找不到，保留原始路径或显示alt文本
          // console.warn("Image not found in map:", fname);
          return `<span>[图片: ${fname}]</span>`; // 或者返回 match
        }
      });
      // 处理上标、下标等自定义语法
      md = md.replace(/\$\{\s*([^}]*)\s*\}\^\{([^}]*)\}\$/g, function(_, base, sup) {
        base = base.trim();
        sup = sup.trim();
        if (base) {
          return `<span>${base}<sup>${sup}</sup></span>`;
        } else {
          return `<sup>${sup}</sup>`;
        }
      });
      md = md.replace(/\$\{\s*([^}]*)\s*\}_\{([^}]*)\}\$/g, function(_, base, sub) {
        base = base.trim();
        sub = sub.trim();
        if (base) {
          return `<span>${base}<sub>${sub}</sub></span>`;
        } else {
          return `<sub>${sub}</sub>`;
        }
      });
      md = md.replace(/\$\{\s*\}\^\{([^}]*)\}\$/g, function(_, sup) {
        return `<sup>${sup.trim()}</sup>`;
      });
      md = md.replace(/\$\{\s*\}_\{([^}]*)\}\$/g, function(_, sub) {
        return `<sub>${sub.trim()}</sub>`;
      });
      md = md.replace(/\$\{\s*([^}]*)\s*\}\$/g, function(_, sup) {
        return `<sup>${sup.trim()}</sup>`;
      });
      // 其余 $...$、$$...$$ 保留，交给 KaTeX 处理
      const __safeMdResult = md;
      performance.mark('safeMarkdown-end');
      performance.measure('safeMarkdown', 'safeMarkdown-start', 'safeMarkdown-end');
      return __safeMdResult;
    }

    /**
     * 使用 KaTeX 渲染 Markdown 文本中的数学公式，并提供降级处理。
     * 它会按以下顺序处理：
     * 1. 将长度较短 (<=10字符) 的块级公式 `$$...$$` 转换为行内公式 `$...\$`。
     * 2. 尝试使用 KaTeX 渲染行内公式 `$...\$`。如果渲染失败，则将公式内容包裹在 `<code>` 标签中显示。
     * 3. 尝试使用 KaTeX 渲染剩余的（通常是多行的）块级公式 `$$...$$`。如果渲染失败，则同样包裹在 `<code>` 标签中。
     * 4. 对处理完公式的文本，使用 `marked.parse()` 将其余 Markdown 内容转换为 HTML。
     *
     * @param {string} md - 经过 `safeMarkdown` 处理的 Markdown 文本。
     * @param {Function} customRenderer - 自定义的 Markdown 渲染器函数，用于处理特殊内容。
     * @returns {string} 包含渲染后公式和其余 Markdown 内容的 HTML 字符串。
     */
    function renderWithKatexFailback(md, customRenderer) {
      performance.mark('renderKatex-start');
      // 在处理前保留原始 Markdown 作为缓存键
      const rawMd = md;
      // 如果缓存中已有结果，则直接返回
      if (renderCache.has(rawMd)) {
        performance.mark('renderKatex-end');
        performance.measure('renderWithKatex (cache)', 'renderKatex-start', 'renderKatex-end');
        return renderCache.get(rawMd);
      }
      // 1. 先把短的 $$...$$ 转为 $...$
      md = md.replace(/\$\$([^\n]+?)\$\$/g, function(_, content) {
        if (content.trim().length <= 10) {
          // 短内容（≤10字符），无论有没有等号，都转为行内公式
          return `$${content}$`;
        } else {
          // 块级公式
          try {
            return katex.renderToString(content, { displayMode: true, throwOnError: true });
          } catch (e) {
            return `<code>$$${content}$$</code>`;
          }
        }
      });
      // 2. 行内公式
      md = md.replace(/\$([^$\n]+?)\$/g, function(_, content) {
        try {
          return katex.renderToString(content, { displayMode: false, throwOnError: true });
        } catch (e) {
          return `<code>$${content}$</code>`;
        }
      });
      // 3. 剩下的块级公式（多行的）
      md = md.replace(/\$\$([\s\S]+?)\$\$/g, function(_, content) {
        try {
          return katex.renderToString(content, { displayMode: true, throwOnError: true });
        } catch (e) {
          return `<code>$$${content}$$</code>`;
        }
      });
      // 4. 其它 markdown
      // 使用传入的渲染器（如果提供），否则使用默认的 marked.parse
      const markedOptions = customRenderer ? { renderer: customRenderer } : {};
      const __rpResult = marked.parse(md, markedOptions);
      // 缓存渲染结果
      renderCache.set(rawMd, __rpResult);
      performance.mark('renderKatex-end');
      performance.measure('renderWithKatex', 'renderKatex-start', 'renderKatex-end');
      return __rpResult;
    }

    // Expose public interface
    global.MarkdownProcessor = {
        safeMarkdown: safeMarkdown,
        renderWithKatexFailback: renderWithKatexFailback
    };

})(window);
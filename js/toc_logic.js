/**
 * @namespace TocFeature
 * @description 管理页面右侧浮动的目录 (Table of Contents) 功能。
 * 包括TOC按钮的点击事件、TOC悬浮窗的显示/隐藏、
 * 以及动态生成TOC列表项。
 */
(function TocFeature(){
  const tocBtn = document.getElementById('toc-float-btn');
  const tocPopup = document.getElementById('toc-popup');
  const tocList = document.getElementById('toc-list');
  const tocCloseBtn = document.getElementById('toc-popup-close-btn');

  // 添加 TOC 模式切换按钮容器，改为标签页形式
  let tocModeSelector = document.createElement('div');
  tocModeSelector.className = 'toc-mode-selector';
  tocModeSelector.innerHTML = `
    <button class="toc-mode-btn active" data-mode="both">双语</button>
    <button class="toc-mode-btn" data-mode="ocr">原文</button>
    <button class="toc-mode-btn" data-mode="translation">译文</button>
  `;

  // 当前 TOC 显示模式：both, ocr, translation
  let currentTocMode = 'both';

  // 将模式选择器插入到 TOC 弹窗头部下方
  if (tocPopup) {
    const tocHeader = tocPopup.querySelector('#toc-popup-header');
    if (tocHeader) {
      tocHeader.parentNode.insertBefore(tocModeSelector, tocHeader.nextSibling);
    }
  }

  // 绑定模式切换按钮事件
  tocModeSelector.querySelectorAll('.toc-mode-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const mode = this.dataset.mode;
      currentTocMode = mode;

      // 更新按钮状态
      tocModeSelector.querySelectorAll('.toc-mode-btn').forEach(b => {
        b.classList.remove('active');
      });
      this.classList.add('active');

      // 重新渲染 TOC 列表
      renderTocList();
    });
  });

  /**
   * @const {Object<string, string>} tocMap
   * @description 用于TOC中标题的中文到英文的简单映射表。
   */
  const tocMap = {
    '历史详情': 'History Detail',
    'OCR内容': 'OCR Content',
    '仅OCR': 'OCR Only',
    '翻译内容': 'Translation',
    '仅翻译': 'Translation Only',
    '分块对比': 'Chunk Compare',
  };
  /**
   * @type {Array<HTMLElement>}
   * @description 存储TOC列表项对应的页面内标题DOM元素。
   */
  let tocNodes = []; // 存储目录对应的标题DOM元素

  /**
   * 判断两个文本是否相似
   * @param {string} text1 - 第一个文本
   * @param {string} text2 - 第二个文本
   * @returns {boolean} 是否相似
   */
  function areTextsSimilar(text1, text2) {
    // 如果两个字符串长度差距大于2，认为不相似
    if (Math.abs(text1.length - text2.length) > 2) {
      return false;
    }

    // 简单的模糊相似度判断
    let similarity = 0;
    const minLength = Math.min(text1.length, text2.length);

    for (let i = 0; i < minLength; i++) {
      if (text1[i] === text2[i]) {
        similarity++;
      }
    }

    const similarityRatio = similarity / minLength;
    return similarityRatio > 0.8; // 相似度大于80%认为是相似的
  }

  /**
   * 智能截断长文本
   * @param {string} text - 要截断的文本
   * @returns {string} 截断后的文本
   */
  function truncateText(text) {
    if (text.length <= 25) {
      return text;
    }

    // 先尝试在第一个句号处截断
    const punctuationRegex = /[.。！？!?]/;
    const punctuationMatch = text.match(punctuationRegex);

    if (punctuationMatch && punctuationMatch.index < 25) {
      return text.substring(0, punctuationMatch.index + 1);
    }

    // 如果没有找到合适的句号或者句号位置太远，截取前20个字符加省略号
    if (text.length > 20) {
      return text.substring(0, 20) + "...";
    }

    return text;
  }

  /**
   * 在TOC导航时，如果目标章节与当前视口距离较远，显示一个临时的加载/导航效果。
   * @param {string} sectionName - 正在导航到的章节名称。
   */
  function showTemporaryLoadingEffect(sectionName) {
    let effectDiv = document.getElementById('toc-loading-effect');
    const mainContainer = document.querySelector('.container');

    if (!effectDiv) {
      effectDiv = document.createElement('div');
      effectDiv.id = 'toc-loading-effect';
      // 使用CSS类而不是直接设置样式
      effectDiv.className = 'loading-effect';
      document.body.appendChild(effectDiv);
    }

    if (mainContainer) {
      // 使用CSS类而不是直接设置样式
      mainContainer.classList.add('content-blurred');
    }

    // 确保截断显示的章节名
    const truncatedSectionName = truncateText(sectionName);
    effectDiv.textContent = `正在前往: ${truncatedSectionName}`;

    // 使用CSS类管理可见性
    requestAnimationFrame(() => {
      effectDiv.classList.add('loading-effect-visible');
    });

    setTimeout(() => {
      effectDiv.classList.remove('loading-effect-visible');
      if (mainContainer) {
        mainContainer.classList.remove('content-blurred');
      }
    }, 1500); // 效果持续时间
  }

  // 打开/关闭悬浮窗
  tocBtn.onclick = function() {
    const isOpen = tocPopup.classList.contains('toc-popup-visible');
    if (isOpen) {
      // 使用CSS类管理状态
      tocPopup.classList.remove('toc-popup-visible');
      tocPopup.classList.add('toc-popup-hiding');
      setTimeout(() => {
        tocPopup.classList.remove('toc-popup-hiding');
        tocPopup.classList.add('toc-popup-hidden');
      }, 200);
    } else {
      // 检查当前显示的Tab是否为分块对比
      updateTocModeSelectorVisibility();
      renderTocList(); // 每次打开时重新渲染，确保内容最新
      tocPopup.classList.remove('toc-popup-hidden', 'toc-popup-hiding');
      tocPopup.classList.add('toc-popup-visible');
    }
  };

  // 关闭悬浮窗按钮
  tocCloseBtn.onclick = function() {
    tocPopup.classList.remove('toc-popup-visible');
    tocPopup.classList.add('toc-popup-hiding');
    setTimeout(() => {
      tocPopup.classList.remove('toc-popup-hiding');
      tocPopup.classList.add('toc-popup-hidden');
    }, 200);
  };

  /**
   * 更新TOC模式选择器的可见性，仅在分块对比模式下显示
   */
  function updateTocModeSelectorVisibility() {
    // 获取当前显示的Tab内容
    const visibleTab = document.querySelector('.tab-btn.active');
    const currentTabId = visibleTab ? visibleTab.id : null;

    // 判断当前是否在分块对比模式
    const isChunkCompareMode = currentTabId === 'tab-chunk-compare';

    // 仅在分块对比模式下显示模式选择器
    if (isChunkCompareMode) {
      tocModeSelector.style.display = 'flex';
    } else {
      tocModeSelector.style.display = 'none';
      // 如果不是分块对比模式，强制使用both模式
      if (currentTocMode !== 'both') {
        currentTocMode = 'both';
        // 更新按钮状态
        tocModeSelector.querySelectorAll('.toc-mode-btn').forEach(b => {
          b.classList.remove('active');
        });
        tocModeSelector.querySelector('[data-mode="both"]').classList.add('active');
      }
    }
  }

  /**
   * 生成并渲染TOC目录列表。
   * - 清空现有列表。
   * - 从 `.container` 中查找所有 `h1`, `h2`, `h3`, `h4`, `h5`, `h6` 元素作为TOC条目。
   * - 为每个标题元素生成一个列表项，包含其文本和可选的英文翻译（来自 `tocMap`）。
   * - 列表项链接到对应标题的ID，点击时平滑滚动到该标题，并根据距离触发加载效果。
   * - 存储标题DOM节点到 `tocNodes` 数组。
   */
  function renderTocList() {
    tocList.innerHTML = '';
    tocNodes = []; // 每次渲染时清空并重新填充
    const container = document.querySelector('.container');
    if (!container) return;

    let potentialHeadings = [];
    // 1. 获取标准的 Hx 标题
    container.querySelectorAll('h1, h2:not(#fileName), h3, h4, h5, h6').forEach(h => {
      potentialHeadings.push(h);
    });

    // 2. 获取可能是图表标题的 P 标签
    // 正则表达式：匹配 "图/表/Figure/Table" + 空格 + 数字/字母/./- + 单词边界 (确保是独立编号)
    const captionRegex = /^(图|表|Figure|Table)\s*[\d\w.-]+\b/i;
    container.querySelectorAll('p').forEach(p => {
      const text = p.textContent.trim();
      if (captionRegex.test(text)) {
        // 标记为图表标题，以便后续处理和样式化
        p.dataset.isCaptionToc = "true";
        potentialHeadings.push(p);
      }
    });

    // 3. 按文档顺序对所有潜在标题进行排序
    potentialHeadings.sort((a, b) => {
      if (a === b) return 0;
      const position = a.compareDocumentPosition(b);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
        return -1; // a 在 b 之前
      } else if (position & Node.DOCUMENT_POSITION_PRECEDING) {
        return 1;  // a 在 b 之后
      }
      return 0; // 通常不应发生，除非元素不在同一文档树或存在包含关系
    });

    const headingElements = potentialHeadings;

    // 根据当前模式过滤标题
    let filteredHeadings = [];
    if (currentTocMode === 'both') {
      filteredHeadings = headingElements;
    } else {
      // 获取当前显示的Tab内容
      const visibleTab = document.querySelector('.tab-btn.active');
      const currentTabId = visibleTab ? visibleTab.id : null;

      // 判断当前是否在分块对比模式
      const isChunkCompareMode = currentTabId === 'tab-chunk-compare';

      if (isChunkCompareMode) {
        // 在分块对比模式下，根据currentTocMode筛选标题
        if (currentTocMode === 'ocr') {
          // 筛选左侧原文块的标题
          filteredHeadings = Array.from(headingElements).filter(el => {
            const closestAlignBlock = el.closest('.align-block-ocr');
            return closestAlignBlock !== null;
          });
        } else if (currentTocMode === 'translation') {
          // 筛选右侧译文块的标题
          filteredHeadings = Array.from(headingElements).filter(el => {
            const closestAlignBlock = el.closest('.align-block-trans');
            return closestAlignBlock !== null;
          });
        }
      } else {
        // 非分块对比模式下，检查当前显示的是否是与所选模式匹配的标签页
        if ((currentTabId === 'tab-ocr' && currentTocMode === 'ocr') ||
            (currentTabId === 'tab-translation' && currentTocMode === 'translation')) {
          filteredHeadings = headingElements;
        } else {
          // 如果当前标签页与所选模式不匹配，显示一个提示
          const li = document.createElement('li');
          li.className = 'toc-info';
          li.textContent = `请切换到${currentTocMode === 'ocr' ? '原文' : '译文'}标签页查看对应目录`;
          tocList.appendChild(li);
          return;
        }
      }
    }

    // 存储上一个处理过的TOC项，用于比较和合并
    let previousTocItem = null;
    let previousLi = null;

    filteredHeadings.forEach((nodeEl, idx) => {
      if (!nodeEl.id) nodeEl.id = 'toc-anchor-' + idx; // 确保元素有ID
      tocNodes.push(nodeEl); // 存储DOM节点

      let zh = nodeEl.textContent.trim();

      // 过滤掉 "原文块" 或 "译文块" 标题 (保持现有逻辑)
      if (zh.includes('原文块') || zh.includes('译文块')) {
        return;
      }

      // 应用智能截断
      let displayText = truncateText(zh);
      let en = tocMap[zh]; // 获取英文翻译

      // 检查与前一个TOC项是否相似，如果相似则合并
      if (previousTocItem && areTextsSimilar(previousTocItem, zh)) {
        // 不创建新的TOC项，而是更新前一个的引用，使其同时指向当前节点
        if (previousLi) {
          const previousAnchor = previousLi.querySelector('a');
          if (previousAnchor) {
            // 为前一个TOC项添加当前节点的引用，点击时会处理两个目标
            previousAnchor.dataset.additionalTargetId = nodeEl.id;
          }
        }
        return; // 跳过创建新的TOC项
      }

      // 记录当前项以供下一次比较
      previousTocItem = zh;

      const li = document.createElement('li');
      previousLi = li; // 更新previousLi引用

      let tocClass = '';
      if (nodeEl.dataset.isCaptionToc === "true") {
        tocClass = 'toc-caption'; // 为图表标题使用特定类
      } else {
        tocClass = 'toc-' + nodeEl.tagName.toLowerCase(); // 例如 toc-h1, toc-h2
      }
      li.className = tocClass;

      let linkHTML = `${displayText}`;
      if (en && en !== zh) { // 只有当英文翻译存在且与中文不同时才显示
        linkHTML += ` <span class="toc-en-translation">/ ${en}</span>`;
      }
      li.innerHTML = `<a href="#${nodeEl.id}" data-original-text="${zh}">${linkHTML}</a>`;

      li.querySelector('a').onclick = function(e) {
        e.preventDefault();
        const targetElement = document.getElementById(nodeEl.id);
        if (targetElement) {
          const clickedNodeIndex = tocNodes.findIndex(n => n.id === nodeEl.id);
          let currentTopNodeIndex = 0;

          if (tocNodes.length > 0) {
            let minPositiveTop = Infinity;
            let foundPositive = false;
            for (let i = 0; i < tocNodes.length; i++) {
              const rect = tocNodes[i].getBoundingClientRect();
              if (rect.top >= 0 && rect.top < minPositiveTop) {
                minPositiveTop = rect.top;
                currentTopNodeIndex = i;
                foundPositive = true;
              }
            }
            if (!foundPositive) {
              let maxNegativeTop = -Infinity;
              let foundNegative = false;
              for (let i = 0; i < tocNodes.length; i++) {
                const rect = tocNodes[i].getBoundingClientRect();
                if (rect.top < 0 && rect.top > maxNegativeTop) {
                  maxNegativeTop = rect.top;
                  currentTopNodeIndex = i;
                  foundNegative = true;
                }
              }
              if (!foundNegative && tocNodes.length > 0) {
                 currentTopNodeIndex = 0;
              }
            }
          }

          const indexDifference = Math.abs(clickedNodeIndex - currentTopNodeIndex);

          if (indexDifference >= 6) {
            // 使用原始文本而非截断后的文本显示加载效果
            const originalText = this.dataset.originalText || nodeEl.textContent.trim();
            showTemporaryLoadingEffect(originalText || "目标章节");
          }

          targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });

          // 检查是否有额外的目标节点
          const additionalTargetId = this.dataset.additionalTargetId;
          if (additionalTargetId) {
            const additionalTarget = document.getElementById(additionalTargetId);
            if (additionalTarget) {
              // 可以考虑以某种方式突出显示这个额外目标
              additionalTarget.classList.add('toc-highlight');
              setTimeout(() => {
                additionalTarget.classList.remove('toc-highlight');
              }, 2000);
            }
          }
        }
      };
      tocList.appendChild(li);
    });
  }

  // 点击页面其他地方关闭目录 (可选，如果需要请取消注释)
  /*
  document.addEventListener('click', function(event) {
    if (tocPopup.classList.contains('toc-popup-visible') &&
        !tocPopup.contains(event.target) &&
        !tocBtn.contains(event.target)) {
      tocPopup.classList.remove('toc-popup-visible');
      tocPopup.classList.add('toc-popup-hiding');
      setTimeout(() => {
        tocPopup.classList.remove('toc-popup-hiding');
        tocPopup.classList.add('toc-popup-hidden');
      }, 200);
    }
  });
  */
  window.refreshTocList = function() {
    updateTocModeSelectorVisibility();
    renderTocList();
  };

  // 初始化TOC界面
  updateTocModeSelectorVisibility();

  // 监听标签页切换事件，当标签页切换时更新TOC模式选择器可见性
  document.querySelectorAll('.tab-btn').forEach(tab => {
    tab.addEventListener('click', updateTocModeSelectorVisibility);
  });

  // 确保在DOM加载完成后执行TocFeature的初始化（如果需要的话）
  // 例如，如果TocFeature依赖于页面上其他脚本首先执行完毕来设置某些全局变量或DOM元素，
  // 则可能需要将此IIFE的执行延迟到 `DOMContentLoaded` 事件之后。
  // 但基于当前代码，它查找的DOM元素（tocBtn, tocPopup等）是在HTML中静态定义的，
  // 并且它将 `window.refreshTocList` 附加到全局对象，这应该在脚本加载时立即进行。
  // 如果 `showTab` 函数在 `toc_logic.js` 加载之前被调用，
  // 且 `showTab` 依赖 `window.refreshTocList`，那么将 `toc_logic.js` 的 `<script>` 标签
  // 放在 `history_detail.html` 中调用 `showTab` 的脚本之前是很重要的。

  // 目前的结构中，TocFeature 是一个IIFE，它会立即执行。
  // 它将 refreshTocList 函数暴露到 window 对象。
  // 在 history_detail.html 中，showTab 函数会调用 window.refreshTocList()。
  // 因此，只要 toc_logic.js 在调用 showTab 的主脚本之前加载，这个设置就应该能工作。
})();
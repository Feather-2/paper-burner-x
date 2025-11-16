// ---- 一键屏蔽非错误 console.log ----
const PRODUCTION_MODE = false; // 设置为 true 来屏蔽 console.log, false 则不屏蔽
if (PRODUCTION_MODE) {
  const originalConsoleLog = console.log;
  console.log = function() {
    // 可以选择在这里什么都不做，或者记录到一个备用日志系统
    // originalConsoleLog.apply(console, arguments); // 如果需要，可以取消注释来保留原始日志
  };
}

// ========== 新增：防止 showTab 重复渲染的锁 ==========
let renderingTab = null;
// =====================================================


let isOriginalFirstInChunkCompare = true; // 状态变量：原文是否在左侧
let docIdForLocalStorage = null; // To store the current document ID for localStorage keys
window.docIdForLocalStorage = null; // 将变量挂载到 window 对象上，使其成为全局变量
var currentVisibleTabId = null;  // To store the ID of the currently visible tab
window.currentVisibleTabId = null; // 将变量挂载到 window 对象上，使其成为全局变量
// let progressPercentageSpan = null; // MOVED to dock_logic.js
// let progressPercentageVerboseSpan = null; // MOVED to dock_logic.js
// let dockElement = null; // MOVED to dock_logic.js

// NEW FUNCTION DEFINITION
function getCurrentScrollableElementForHistoryDetail() {
    // console.log(`[getCurrentScrollableElementForHistoryDetail] 开始查找可滚动元素, 沉浸模式=${window.ImmersiveLayout && window.ImmersiveLayout.isActive() ? '是' : '否'}`);

    if (window.ImmersiveLayout && window.ImmersiveLayout.isActive()) {
        const immersiveMainArea = document.getElementById('immersive-main-content-area');
        // console.log(`[getCurrentScrollableElementForHistoryDetail] 找到immersiveMainArea:`, immersiveMainArea ? true : false);

        if (immersiveMainArea) {
            // Try to find the specific, scrollable tab content area first
            const tabContentScroller = immersiveMainArea.querySelector('.tab-content[style*="overflow-y: auto"], .tab-content[style*="overflow: auto"]');
            // console.log(`[getCurrentScrollableElementForHistoryDetail] 尝试查找tabContentScroller:`, tabContentScroller ? {
            //     id: tabContentScroller.id || '无ID',
            //     className: tabContentScroller.className || '无类名',
            //     overflowY: tabContentScroller.style.overflowY,
            //     overflow: tabContentScroller.style.overflow,
            //     computedOverflowY: window.getComputedStyle(tabContentScroller).overflowY
            // } : '未找到');

            if (tabContentScroller) return tabContentScroller;

            // Fallback: look for a .content-wrapper or .chunk-compare-container within .tab-content
            const activeTabContentBlock = immersiveMainArea.querySelector('.tab-content .content-wrapper, .tab-content .chunk-compare-container');
            // console.log(`[getCurrentScrollableElementForHistoryDetail] 尝试查找activeTabContentBlock:`, activeTabContentBlock ? {
            //     id: activeTabContentBlock.id || '无ID',
            //     className: activeTabContentBlock.className || '无类名'
            // } : '未找到');

            if (activeTabContentBlock) {
                // It might be that the .tab-content itself is the designated scroller
                const parentTabContent = activeTabContentBlock.closest('.tab-content');
                // console.log(`[getCurrentScrollableElementForHistoryDetail] 尝试查找parentTabContent:`, parentTabContent ? {
                //     id: parentTabContent.id || '无ID',
                //     className: parentTabContent.className || '无类名',
                //     overflowY: parentTabContent.style.overflowY,
                //     overflow: parentTabContent.style.overflow,
                //     computedOverflowY: window.getComputedStyle(parentTabContent).overflowY
                // } : '未找到');

                if (parentTabContent && (parentTabContent.style.overflowY === 'auto' || parentTabContent.style.overflow === 'auto' ||
                                       window.getComputedStyle(parentTabContent).overflowY === 'auto')) {
                    // console.log(`[getCurrentScrollableElementForHistoryDetail] 返回parentTabContent作为滚动元素`);
                    return parentTabContent;
                }
                // console.log(`[getCurrentScrollableElementForHistoryDetail] 返回activeTabContentBlock作为滚动元素`);
                return activeTabContentBlock; // Fallback to the content wrapper itself if .tab-content isn't the scroller
            }
            // Fallback to the general .container if present inside immersive main area
            const containerInImmersive = immersiveMainArea.querySelector('.container');
            // console.log(`[getCurrentScrollableElementForHistoryDetail] 尝试查找containerInImmersive:`, containerInImmersive ? {
            //     id: containerInImmersive.id || '无ID',
            //     className: containerInImmersive.className || '无类名'
            // } : '未找到');

            if(containerInImmersive) {
                // console.log(`[getCurrentScrollableElementForHistoryDetail] 返回containerInImmersive作为滚动元素`);
                return containerInImmersive;
            }

            // console.log(`[getCurrentScrollableElementForHistoryDetail] 返回immersiveMainArea作为滚动元素`);
            return immersiveMainArea; // Last fallback for immersive mode
        }
    }

    // 非沉浸模式：使用 .app-main（侧边栏布局中的主内容区）
    const appMain = document.querySelector('.app-main');
    if (appMain) {
        // console.log(`[getCurrentScrollableElementForHistoryDetail] 返回.app-main作为滚动元素`);
        return appMain;
    }

    // 最终回退到 document.documentElement（旧布局或特殊情况）
    // console.log(`[getCurrentScrollableElementForHistoryDetail] 返回document.documentElement作为滚动元素`);
    return document.documentElement;
}

function adjustLongHeadingsToParagraphs(parentElement) {
  if (!parentElement) return;

  // console.log('[adjustLongHeadingsToParagraphs] 开始处理，父元素:', parentElement);

  // 创建一个数组来存储所有需要处理的markdown-body元素
  let markdownBodies = [];

  // 检查父元素本身是否有markdown-body类
  if (parentElement.classList && parentElement.classList.contains('markdown-body')) {
    markdownBodies.push(parentElement);
    // console.log('[adjustLongHeadingsToParagraphs] 父元素本身是markdown-body');
  }

  // 查找父元素内的所有markdown-body元素
  const childMarkdownBodies = parentElement.querySelectorAll('.markdown-body');
  childMarkdownBodies.forEach(el => {
    if (!markdownBodies.includes(el)) { // 避免重复
      markdownBodies.push(el);
    }
  });

  // console.log('[adjustLongHeadingsToParagraphs] 找到 markdown-body 元素数量:', markdownBodies.length);

  markdownBodies.forEach((markdownBody, mbIdx) => {
    const headings = Array.from(markdownBody.querySelectorAll('h1, h2, h3, h4, h5, h6'));
    //console.log(`[adjustLongHeadingsToParagraphs] markdown-body #${mbIdx} 中找到标题元素数量:`, headings.length);

    // 逆序遍历，防止DOM结构变化影响
    for (let hIdx = headings.length - 1; hIdx >= 0; hIdx--) {
      const heading = headings[hIdx];
      // Skip the main fileName heading if it's somehow caught by this logic
      if (heading.id === 'fileName') {
          // console.log('[adjustLongHeadingsToParagraphs] 跳过 fileName 标题');
          continue;
      }

      // 补丁：如果没有 id，分配唯一 id
      if (!heading.id) heading.id = 'auto-hx-' + hIdx;

      const textContent = heading.textContent || "";
      //console.log(`[adjustLongHeadingsToParagraphs] 标题 #${hIdx} (${heading.tagName}), ID: ${heading.id}, 文本长度: ${textContent.length}, 文本: "${textContent.substring(0, 50)}${textContent.length > 50 ? '...' : ''}"`);

      if (textContent.length > 30) {
        //console.log(`[adjustLongHeadingsToParagraphs] 标题 #${hIdx} 文本长度 > 30，准备转换为段落`);

        try {
          const p = document.createElement('p');
          const originalTagName = heading.tagName.toLowerCase(); // 存储原始标签名

          // 递归移动所有子节点，彻底保留结构
          while (heading.firstChild) {
            p.appendChild(heading.firstChild);
          }

          // Copy all attributes from heading to p
          for (let i = 0; i < heading.attributes.length; i++) {
            const attr = heading.attributes[i];
            p.setAttribute(attr.name, attr.value);
          }

          // Add a class to indicate this was a converted heading,
          // in case specific styling is needed later.
          p.classList.add('converted-from-heading');
          p.dataset.originalTag = originalTagName; // 将原始标签名存储到 data-* 属性
          p.style.fontWeight = 'bold'; // 直接设置字体加粗

          heading.parentNode.replaceChild(p, heading);
          //console.log(`[adjustLongHeadingsToParagraphs] 成功将标题 #${hIdx} 转换为段落（递归移动子节点）`);
        } catch (error) {
          console.error(`[adjustLongHeadingsToParagraphs] 转换标题 #${hIdx} 时出错:`, error);
        }
      }
    }
  });

  // console.log('[adjustLongHeadingsToParagraphs] 处理完成');
}

function debounce(func, delay) {
  let timeout;
  return function(...args) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), delay);
  };
}

function saveScrollPosition() {
  if (!docIdForLocalStorage || !currentVisibleTabId) return;
  const scrollableElement = getCurrentScrollableElementForHistoryDetail();
  const isImmersive = window.ImmersiveLayout && window.ImmersiveLayout.isActive();
  const modePrefix = isImmersive ? 'immersive_' : 'normal_';

  if (scrollableElement) {
    const scrollKey = `scrollPos_${modePrefix}${docIdForLocalStorage}_${currentVisibleTabId}`;
    localStorage.setItem(scrollKey, scrollableElement.scrollTop);

    let bestAnchorId = null;
    if (typeof window.getTocNodes === 'function') {
        const tocElements = window.getTocNodes(); // 获取TOC节点
        let minPositiveTop = Infinity;
        let lastVisibleAboveFoldId = null;

        for (const el of tocElements) {
            if (!el || !el.id) continue;
            const rect = el.getBoundingClientRect();
            const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

            if (rect.top >= 0 && rect.top < viewportHeight / 3) { // 在视口顶部三分之一
                if (rect.top < minPositiveTop) {
                    minPositiveTop = rect.top;
                    bestAnchorId = el.id;
                }
            } else if (rect.bottom < 0) { // 完全滚出视口上方
                lastVisibleAboveFoldId = el.id; // 记录最后一个滚出上方的
            }
        }
        if (!bestAnchorId && lastVisibleAboveFoldId) { // 如果顶部三分之一没有，用最后一个滚出上方的
            bestAnchorId = lastVisibleAboveFoldId;
        }
    }

    if (bestAnchorId) {
        const anchorKey = `scrollAnchorId_${modePrefix}${docIdForLocalStorage}_${currentVisibleTabId}`;
        localStorage.setItem(anchorKey, bestAnchorId);
        // console.log(`[saveScrollPosition] 保存滚动锚点: ${anchorKey} = ${bestAnchorId}`);
    } else {
        const anchorKey = `scrollAnchorId_${modePrefix}${docIdForLocalStorage}_${currentVisibleTabId}`;
        localStorage.removeItem(anchorKey); // 如果没有合适的锚点，清除旧的
        // console.log(`[saveScrollPosition] 未找到合适锚点，清除旧锚点 (如有): ${anchorKey}`);
    }

    // console.log(`[saveScrollPosition] 保存滚动位置: ${scrollKey} = ${scrollableElement.scrollTop}, 元素: ${scrollableElement.tagName}, 模式: ${isImmersive ? '沉浸式' : '普通'}`, {
    //   元素ID: scrollableElement.id || '无ID',
    //   元素类名: scrollableElement.className || '无类名',
    //   元素标签: scrollableElement.tagName,
    //   scrollTop: scrollableElement.scrollTop,
    //   scrollHeight: scrollableElement.scrollHeight,
    //   clientHeight: scrollableElement.clientHeight,
    //   maxScrollTop: scrollableElement.scrollHeight - scrollableElement.clientHeight,
    //   scrollPercent: ((scrollableElement.scrollTop / (scrollableElement.scrollHeight - scrollableElement.clientHeight)) * 100).toFixed(2) + '%',
    //   路径: getElementPath(scrollableElement),
    //   锚点ID: bestAnchorId
    // });
  } else {
    console.warn(`[saveScrollPosition] 未找到可滚动元素，无法保存滚动位置`);
  }
}

// 使用debounce函数创建一个防抖动的保存滚动位置函数
const debouncedSaveScrollPosition = debounce(saveScrollPosition, 200);

// 动态绑定/解绑滚动事件到当前滚动容器
let lastScrollableElementForSave = null;

function bindScrollForSavePosition() {
  // 解绑旧的滚动监听
  if (lastScrollableElementForSave) {
    lastScrollableElementForSave.removeEventListener('scroll', debouncedSaveScrollPosition);
    lastScrollableElementForSave = null;
  }

  // 获取当前滚动元素
  const el = getCurrentScrollableElementForHistoryDetail();
  if (el) {
    console.log(`[bindScrollForSavePosition] 绑定滚动事件到元素:`, el.id || el.className || el.tagName);
    el.addEventListener('scroll', debouncedSaveScrollPosition);
    lastScrollableElementForSave = el;
  } else {
    console.warn(`[bindScrollForSavePosition] 未找到可滚动元素，无法绑定滚动事件`);
  }
}

function unbindScrollForSavePosition() {
  if (lastScrollableElementForSave) {
    lastScrollableElementForSave.removeEventListener('scroll', debouncedSaveScrollPosition);
    lastScrollableElementForSave = null;
  }
}

// 辅助函数：获取元素的DOM路径
function getElementPath(element) {
  if (!element) return "null";
  let path = [];
  while (element && element.nodeType === Node.ELEMENT_NODE) {
    let selector = element.nodeName.toLowerCase();
    if (element.id) {
      selector += '#' + element.id;
      path.unshift(selector);
      break;
    } else {
      let sibling = element;
      let siblingIndex = 1;
      while (sibling = sibling.previousElementSibling) {
        if (sibling.nodeName.toLowerCase() === selector) siblingIndex++;
      }
      if (siblingIndex > 1) selector += ':nth-of-type(' + siblingIndex + ')';
    }
    path.unshift(selector);
    element = element.parentNode;
  }
  return path.join(' > ');
}

function saveChatbotStateOnUnload() {
  if (docIdForLocalStorage && typeof window.isChatbotOpen !== 'undefined') {
    localStorage.setItem(`chatbotOpenState_${docIdForLocalStorage}`, window.isChatbotOpen);
    // console.log(`Saved chatbot state on beforeunload for ${docIdForLocalStorage}: ${window.isChatbotOpen}`);
  }
}

// MOVED to dock_logic.js: function updateReadingProgress() { ... }
// MOVED to dock_logic.js: const debouncedUpdateReadingProgress = debounce(updateReadingProgress, 100);

// MOVED to dock_logic.js: function updateHighlightSummary() { ... }
// MOVED to dock_logic.js: function updateAnnotationSummary() { ... }
// MOVED to dock_logic.js: function updateImageCount() { ... }
// MOVED to dock_logic.js: function updateTableCount(contentElement) { ... }
// MOVED to dock_logic.js: function updateFormulaCount(contentElement) { ... }
// MOVED to dock_logic.js: function updateWordCount(contentElement) { ... }
// MOVED to dock_logic.js: function updateAllDockStats() { ... }

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
// MOVED to js/markdown_processor.js: function safeMarkdown(md, images) { ... }

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
// MOVED to js/markdown_processor.js: function renderWithKatexFailback(md, customRenderer) { ... }

/**
 * 从当前页面的 URL 中获取指定查询参数的值。
 * @param {string} name - 要获取的查询参数的名称。
 * @returns {string|null} 查询参数的值，如果不存在则返回 null。
 */
function getQueryParam(name) {
  const url = new URL(window.location.href);
  return url.searchParams.get(name);
}
/**
 * @type {Object|null}
 * @description 存储从 IndexedDB 加载的当前历史记录的详细数据。
 */
let data = null;

/**
 * 将块级元素内容按标点分割成子块 (span.sub-block)。
 * @param {HTMLElement} blockElement - 要分割的块级元素 (如 p, h1-h6)。
 * @param {string|number} parentBlockIndex - 父块的索引。
 */
// MOVED to js/sub_block_segmenter.js: function segmentBlockIntoSubBlocks(blockElement, parentBlockIndex) { ... }

function restoreScrollPositionForCurrentTab() {
    if (docIdForLocalStorage && currentVisibleTabId) {
        const isImmersive = window.ImmersiveLayout && window.ImmersiveLayout.isActive();
        const modePrefix = isImmersive ? 'immersive_' : 'normal_';
        const anchorKey = `scrollAnchorId_${modePrefix}${docIdForLocalStorage}_${currentVisibleTabId}`;
        const savedAnchorId = localStorage.getItem(anchorKey);

        console.log(`[restoreScrollPosition] 模式: ${modePrefix}, 尝试恢复锚点: ${anchorKey}, 保存的锚点ID: ${savedAnchorId}`);

        if (savedAnchorId) {
            const targetElement = document.getElementById(savedAnchorId);
            if (targetElement) {
                console.log(`[restoreScrollPosition] 找到锚点元素 ${savedAnchorId}, 滚动到该元素。`);
                requestAnimationFrame(() => {
                     if (localStorage.getItem(`activeTab_${docIdForLocalStorage}`) === currentVisibleTabId) {
                        targetElement.scrollIntoView({ behavior: 'auto', block: 'start' }); // 'auto' for instant jump
                        // 立即保存一次当前scrollTop，因为scrollIntoView后可能需要微调
                        setTimeout(saveScrollPosition, 50);
                    }
                });
                // 新增：每次恢复滚动后都绑定 scroll 事件到正确容器
                if (window.DockLogic && typeof window.DockLogic.bindScrollForCurrentScrollable === 'function') {
                    window.DockLogic.bindScrollForCurrentScrollable();
                }
                return; // 成功通过锚点恢复，直接返回
            }
            console.warn(`[restoreScrollPosition] 未找到ID为 ${savedAnchorId} 的锚点元素。回退到scrollTop恢复。`);
        }

        // 如果锚点恢复失败或没有锚点，则回退到scrollTop恢复
        const scrollKey = `scrollPos_${modePrefix}${docIdForLocalStorage}_${currentVisibleTabId}`;
        const savedScrollTop = localStorage.getItem(scrollKey);
        console.log(`[restoreScrollPosition] (回退)尝试恢复scrollTop: ${scrollKey}, 保存的值: ${savedScrollTop}`);

        if (savedScrollTop !== null && !isNaN(parseInt(savedScrollTop, 10))) {
            const scrollableElement = getCurrentScrollableElementForHistoryDetail();
            if (scrollableElement) {
                console.log(`[restoreScrollPosition] (回退)找到可滚动元素:`, {
                    元素ID: scrollableElement.id || '无ID',
                    元素类名: scrollableElement.className || '无类名',
                    元素标签: scrollableElement.tagName,
                    当前scrollTop: scrollableElement.scrollTop,
                    将要设置的scrollTop: parseInt(savedScrollTop, 10)
                });
                requestAnimationFrame(() => {
                    if (localStorage.getItem(`activeTab_${docIdForLocalStorage}`) === currentVisibleTabId) {
                        const scrollTopToSet = parseInt(savedScrollTop, 10);
                        scrollableElement.scrollTop = scrollTopToSet;
                        setTimeout(() => {
                            if (Math.abs(scrollTopToSet - scrollableElement.scrollTop) > 5) {
                                console.warn(`[restoreScrollPosition] (回退)警告: scrollTop设置可能未生效! 尝试再次设置...`);
                                scrollableElement.scrollTop = scrollTopToSet;
                            }
                            // 即使是scrollTop恢复，也保存一次，这可能会更新锚点（如果之前没有）
                            saveScrollPosition();
                        }, 100);
                    }
                });
            } else {
                console.warn(`[restoreScrollPosition] (回退)未找到可滚动元素，无法恢复scrollTop`);
            }
        } else {
            console.log(`[restoreScrollPosition] (回退)没有保存的scrollTop或值无效: ${savedScrollTop}`);
        }
    } else {
        console.log(`[restoreScrollPosition] 缺少必要参数: docId=${docIdForLocalStorage}, tabId=${currentVisibleTabId}`);
    }
    // 新增：每次恢复滚动后都绑定 scroll 事件到正确容器
    if (window.DockLogic && typeof window.DockLogic.bindScrollForCurrentScrollable === 'function') {
        window.DockLogic.bindScrollForCurrentScrollable();
    }
}

// Listen for immersive mode changes
document.addEventListener('immersiveModeEntered', function() {
    setTimeout(() => {
        console.log("[HistoryDetail] 进入沉浸模式事件触发");
        const normalModeAnchorKey = `scrollAnchorId_normal_${docIdForLocalStorage}_${currentVisibleTabId}`;
        const savedNormalAnchorId = localStorage.getItem(normalModeAnchorKey);
        let restoredByAnchor = false;

        if (savedNormalAnchorId) {
            const targetElement = document.getElementById(savedNormalAnchorId);
            if (targetElement && document.body.contains(targetElement)) { // 确保元素在当前DOM中
                 const immersiveScrollableElement = getCurrentScrollableElementForHistoryDetail();
                 if(immersiveScrollableElement && immersiveScrollableElement.contains(targetElement)){
                    console.log(`[HistoryDetail-ImmersiveEnter] 应用普通模式锚点 ${savedNormalAnchorId} 到沉浸式元素`);
                    targetElement.scrollIntoView({ behavior: 'auto', block: 'start' });
                    restoredByAnchor = true;
                 } else {
                    console.warn("[HistoryDetail-ImmersiveEnter] 锚点元素不在当前沉浸模式滚动容器内，无法精确恢复。");
                 }
            } else {
                 console.warn("[HistoryDetail-ImmersiveEnter] 普通模式锚点 ${savedNormalAnchorId} 在沉浸模式DOM中未找到。");
            }
        }

        if (restoredByAnchor) {
            // 锚点恢复成功，立即为沉浸模式保存当前状态（包括scrollTop和新计算的锚点）
            console.log("[HistoryDetail-ImmersiveEnter] 通过锚点恢复成功，立即为沉浸模式保存状态");
            saveScrollPosition();
        } else {
            console.log("[HistoryDetail-ImmersiveEnter] 普通模式锚点恢复失败或无锚点，尝试恢复上次沉浸式位置(锚点优先，后scrollTop)");
            restoreScrollPositionForCurrentTab(); // 会尝试恢复 immersive_ 锚点，然后 immersive_ scrollTop
        }

        if (window.DockLogic) {
            if (typeof window.DockLogic.forceUpdateReadingProgress === 'function') {
                window.DockLogic.forceUpdateReadingProgress();
            }
            if (typeof window.DockLogic.bindScrollForCurrentScrollable === 'function') {
                 window.DockLogic.bindScrollForCurrentScrollable();
            }
        }

        // 重新绑定滚动事件以保存滚动位置
        if (typeof bindScrollForSavePosition === 'function') {
            bindScrollForSavePosition();
        }
    }, 450); // 增加延迟确保DOM和TOC更新
});

document.addEventListener('immersiveModeExited', function() {
    setTimeout(() => {
        console.log("[HistoryDetail] 退出沉浸模式事件触发");
        const immersiveModeAnchorKey = `scrollAnchorId_immersive_${docIdForLocalStorage}_${currentVisibleTabId}`;
        const savedImmersiveAnchorId = localStorage.getItem(immersiveModeAnchorKey);
        let restoredByAnchor = false;

        if (savedImmersiveAnchorId) {
            const targetElement = document.getElementById(savedImmersiveAnchorId);
            // 退出沉浸模式后，内容移回主容器，检查 targetElement 是否在 document.body (或其他主内容区) 中
            if (targetElement && document.body.contains(targetElement)) {
                const normalScrollableElement = getCurrentScrollableElementForHistoryDetail();
                if(normalScrollableElement && (normalScrollableElement === document.documentElement || normalScrollableElement.contains(targetElement))){
                    console.log(`[HistoryDetail-ImmersiveExit] 应用沉浸模式锚点 ${savedImmersiveAnchorId} 到普通模式元素`);
                    targetElement.scrollIntoView({ behavior: 'auto', block: 'start' });
                    restoredByAnchor = true;
                } else {
                     console.warn("[HistoryDetail-ImmersiveExit] 锚点元素不在当前普通模式滚动容器内，无法精确恢复。");
                }
            } else {
                console.warn("[HistoryDetail-ImmersiveExit] 沉浸模式锚点 ${savedImmersiveAnchorId} 在普通模式DOM中未找到。");
            }
        }

        if (restoredByAnchor) {
            // 锚点恢复成功，立即为普通模式保存当前状态
            console.log("[HistoryDetail-ImmersiveExit] 通过锚点恢复成功，立即为普通模式保存状态");
            saveScrollPosition();
        } else {
            console.log("[HistoryDetail-ImmersiveExit] 沉浸模式锚点恢复失败或无锚点，尝试恢复上次普通模式位置(锚点优先，后scrollTop)");
            restoreScrollPositionForCurrentTab(); // 会尝试恢复 normal_ 锚点，然后 normal_ scrollTop
        }

        if (window.DockLogic) {
            if (typeof window.DockLogic.forceUpdateReadingProgress === 'function') {
                window.DockLogic.forceUpdateReadingProgress();
            }
            if (typeof window.DockLogic.bindScrollForCurrentScrollable === 'function') {
                 window.DockLogic.bindScrollForCurrentScrollable();
            }
        }

        // 重新绑定滚动事件以保存滚动位置
        if (typeof bindScrollForSavePosition === 'function') {
            bindScrollForSavePosition();
        }
    }, 450); // 增加延迟
});


window.addEventListener('beforeunload', function cleanupLargeRefs() {
  try {
    if (window.ChunkCompareOptimizer && window.ChunkCompareOptimizer.instance && typeof window.ChunkCompareOptimizer.instance.cleanup === 'function') {
      window.ChunkCompareOptimizer.instance.cleanup();
    }
  } catch {}
  try {
    if (window.chunkParseCache) {
      Object.keys(window.chunkParseCache).forEach(k => delete window.chunkParseCache[k]);
    }
  } catch {}
  try {
    if (typeof window.__lastChunkCompareTotalBlocks === 'number') {
      for (let i = 0; i <= window.__lastChunkCompareTotalBlocks; i++) {
        delete window[`blockRawContent_${i}`];
      }
    }
  } catch {}
  window.largeDocumentData = null;
});

// 自动恢复 globalCurrentContentIdentifier
(function restoreContentIdentifierFromLocalStorage() {
  try {
    // 优先用 docIdForLocalStorage，如果没有则尝试从URL获取
    let docId = window.docIdForLocalStorage;
    if (!docId && typeof getQueryParam === 'function') {
      docId = getQueryParam('id');
    }
    if (!docId) return;
    const savedTabKey = `activeTab_${docId}`;
    const savedTab = localStorage.getItem(savedTabKey);
    if (savedTab === 'ocr' || savedTab === 'translation') {
      window.globalCurrentContentIdentifier = savedTab;
      console.log('[auto-restore] 恢复 globalCurrentContentIdentifier =', savedTab);
    }
  } catch (e) {
    // 忽略
  }
})();

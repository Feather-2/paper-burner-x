/**
 * @file js/ui/toc_scroll_sync.js
 * @description 负责监听页面滚动，自动高亮当前视口中对应的 TOC 目录项。
 * 支持普通视图和沉浸式视图的自动切换。
 */

(function() {
  let scrollTimeout = null;
  let lastActiveId = null;

  /**
   * 获取当前的滚动容器
   * @returns {HTMLElement|Window}
   */
  function getScrollContainer() {
    if (document.body.classList.contains('immersive-active')) {
      return document.querySelector('#immersive-main-content-area .tab-content') || window;
    }
    return window;
  }

  /**
   * 核心逻辑：计算当前应该高亮的标题
   */
  function highlightActiveTocItem() {
    // 依赖 toc_logic.js 暴露的全局函数
    if (typeof window.getTocNodes !== 'function') return;

    const tocNodes = window.getTocNodes();
    if (!tocNodes || tocNodes.length === 0) return;

    const container = getScrollContainer();
    // 在沉浸模式下，容器顶部可能有偏移
    const containerTop = (container === window) ? 0 : container.getBoundingClientRect().top;
    // 定义“激活区域”：视口顶部向下 150px 的范围
    const activeZoneTop = containerTop + 150;

    let currentActiveNode = null;

    // 倒序遍历，找到第一个在激活区域之上的标题
    for (let i = tocNodes.length - 1; i >= 0; i--) {
      const node = tocNodes[i];
      const rect = node.getBoundingClientRect();

      if (rect.top <= activeZoneTop) {
        currentActiveNode = node;
        break;
      }
    }

    // 如果页面刚打开，可能都在视口下方，默认高亮第一个
    if (!currentActiveNode && tocNodes.length > 0) {
        // 可选：currentActiveNode = tocNodes[0];
    }

    if (currentActiveNode) {
      const activeId = currentActiveNode.id;
      if (activeId !== lastActiveId) {
        updateTocUi(activeId);
        lastActiveId = activeId;
      }
    } else if (lastActiveId) {
        // 如果没有找到激活节点（例如滚动到最顶部之前），清除高亮
        clearTocUi();
        lastActiveId = null;
    }
  }

  /**
   * 更新 TOC UI 的高亮状态
   * @param {string} activeId
   */
  function updateTocUi(activeId) {
    // 1. 移除所有旧的激活状态
    document.querySelectorAll('#toc-list a.active').forEach(link => {
      link.classList.remove('active');
    });

    // 2. 找到新的激活链接
    // 可能有多个链接指向同一个ID（虽然不常见，但为了健壮性）
    // 使用属性选择器匹配 href="#id"
    const activeLinks = document.querySelectorAll(`#toc-list a[href="#${CSS.escape(activeId)}"]`);
    
    activeLinks.forEach(link => {
        link.classList.add('active');
        
        // 可选：自动展开父级目录
        // ensureParentExpanded(link);
        
        // 可选：确保高亮的目录项在 TOC 视口中可见
        ensureTocItemVisible(link);
    });
  }

  function clearTocUi() {
      document.querySelectorAll('#toc-list a.active').forEach(link => {
          link.classList.remove('active');
      });
  }

  /**
   * 确保激活的 TOC 项在滚动容器中可见
   * @param {HTMLElement} link 
   */
  function ensureTocItemVisible(link) {
      const tocPopup = document.getElementById('toc-popup');
      // 仅当 TOC 弹窗显示时才自动滚动
      if (tocPopup && (getComputedStyle(tocPopup).display !== 'none' || document.body.classList.contains('immersive-active'))) {
          // 简单的 scrollIntoView，使用 nearest 避免剧烈跳动
          link.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
  }

  /**
   * 节流滚动事件处理器
   */
  function handleScroll() {
    if (!scrollTimeout) {
      scrollTimeout = requestAnimationFrame(() => {
        highlightActiveTocItem();
        scrollTimeout = null;
      });
    }
  }

  /**
   * 初始化监听器
   */
  function initScrollSync() {
    // 监听全局滚动（普通模式）
    window.addEventListener('scroll', handleScroll, { passive: true });

    // 监听可能的内部容器滚动（沉浸模式或其他特定 Tab）
    // 使用事件代理或定期检查可能更健壮，这里先尝试直接绑定常见容器
    const potentialContainers = document.querySelectorAll('.tab-content');
    potentialContainers.forEach(c => {
        c.addEventListener('scroll', handleScroll, { passive: true });
    });

    // 监听沉浸模式切换，重新绑定或触发一次计算
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.attributeName === 'class' && mutation.target === document.body) {
                // 模式切换后，稍等布局稳定再计算一次
                setTimeout(highlightActiveTocItem, 300);
                // 如果进入沉浸模式，可能需要重新绑定新的滚动容器
                if (document.body.classList.contains('immersive-active')) {
                     const immersiveContainer = document.querySelector('#immersive-main-content-area .tab-content');
                     if (immersiveContainer) {
                         immersiveContainer.removeEventListener('scroll', handleScroll); // 避免重复
                         immersiveContainer.addEventListener('scroll', handleScroll, { passive: true });
                     }
                }
            }
        }
    });
    observer.observe(document.body, { attributes: true });

    // 初始执行一次
    setTimeout(highlightActiveTocItem, 500);
  }

  // 页面加载完成后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initScrollSync);
  } else {
    initScrollSync();
  }

  // 暴露一个全局方法以便在内容重新渲染后手动触发
  window.syncTocScroll = highlightActiveTocItem;

})();
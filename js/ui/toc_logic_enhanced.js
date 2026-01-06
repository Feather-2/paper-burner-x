/**
 * @namespace TocFeature - Enhanced Modern Version
 * @description 管理页面侧边浮动的现代化目录 (Table of Contents) 功能。
 * 包括TOC按钮的点击事件、TOC悬浮窗的显示/隐藏、
 * 智能层级识别、平滑滚动导航以及动态生成TOC列表项。
 * 
 * 特性：
 * - 现代化UI设计
 * - 智能标题识别
 * - 平滑动画过渡
 * - 响应式布局
 * - 层级可视化
 * - 快速导航
 */
(function EnhancedTocFeature(){
  const tocBtn = document.getElementById('toc-float-btn');
  const tocPopup = document.getElementById('toc-popup');
  const tocList = document.getElementById('toc-list');
  const tocCloseBtn = document.getElementById('toc-popup-close-btn');

  // 智能TOC缓存系统
  let tocCache = {
    lastUpdate: 0,
    structure: null,
    nodes: [],
    clearCache: function() {
      this.lastUpdate = 0;
      this.structure = null;
      this.nodes = [];
    },
    isValid: function() {
      return Date.now() - this.lastUpdate < 30000; // 30秒缓存
    }
  };

  // 性能监控
  let performanceMetrics = {
    renderTime: 0,
    nodeCount: 0,
    structureComplexity: 0
  };

  // 智能观察器，监控DOM变化
  let contentObserver = null;
  
  // 创建内容变化观察器
  function initContentObserver() {
    if (!window.MutationObserver) return;
    
    contentObserver = new MutationObserver(function(mutations) {
      let shouldRefresh = false;
      mutations.forEach(function(mutation) {
        if (mutation.type === 'childList') {
          // 检查是否有标题元素的变化
          mutation.addedNodes.forEach(function(node) {
            if (node.nodeType === 1 && 
                (node.matches && node.matches('h1,h2,h3,h4,h5,h6,p') ||
                 node.querySelector && node.querySelector('h1,h2,h3,h4,h5,h6,p'))) {
              shouldRefresh = true;
            }
          });
        }
      });
      
      if (shouldRefresh) {
        tocCache.clearCache();
        if (tocPopup.classList.contains('toc-popup-visible')) {
          setTimeout(renderTocList, 500); // 延迟刷新避免频繁更新
        }
      }
    });
    
    const container = document.querySelector('.container');
    if (container) {
      contentObserver.observe(container, {
        childList: true,
        subtree: true
      });
    }
  }

  // 当前 TOC 显示模式：both, ocr, translation
  let currentTocMode = 'both';
  
  // TOC 偏好设置
  let tocPreferences = {
    autoExpand: localStorage.getItem('toc-auto-expand') !== 'false',
    showPreview: localStorage.getItem('toc-show-preview') !== 'false',
    compactMode: localStorage.getItem('toc-compact-mode') === 'true',
    smartGrouping: localStorage.getItem('toc-smart-grouping') !== 'false'
  };

  // 添加 TOC 模式切换按钮容器，改为现代化标签页形式
  let tocModeSelector = document.createElement('div');
  tocModeSelector.className = 'toc-mode-selector';
  tocModeSelector.innerHTML = `
    <button class="toc-mode-btn active" data-mode="both" title="显示双语目录">
      <i class="fas fa-layer-group"></i> 双语
    </button>
    <button class="toc-mode-btn" data-mode="ocr" title="仅显示原文目录">
      <i class="fas fa-file-text"></i> 原文
    </button>
    <button class="toc-mode-btn" data-mode="translation" title="仅显示译文目录">
      <i class="fas fa-language"></i> 译文
    </button>
  `;

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
      if (currentTocMode === mode) return; // 避免重复切换
      
      currentTocMode = mode;
      tocCache.clearCache(); // 清除缓存

      // 更新按钮状态
      tocModeSelector.querySelectorAll('.toc-mode-btn').forEach(b => {
        b.classList.remove('active');
      });
      this.classList.add('active');

      // 添加切换动画
      const tocListElement = document.getElementById('toc-list');
      tocListElement.style.opacity = '0.5';
      tocListElement.style.transform = 'translateY(10px)';
      
      // 重新渲染 TOC 列表
      setTimeout(() => {
        renderTocList();
        tocListElement.style.opacity = '';
        tocListElement.style.transform = '';
      }, 150);
    });
  });

  // 添加现代化底部控制区域
  const tocControls = document.createElement('div');
  tocControls.className = 'toc-controls';
  tocControls.innerHTML = `
    <button class="toc-control-btn" id="toc-expand-btn" title="展开/收起目录" aria-label="展开目录">
      <i class="fas fa-expand-arrows-alt"></i>
      <span>展开</span>
    </button>
    <button class="toc-control-btn" id="toc-expand-all" title="全部展开" aria-label="全部展开">
      <i class="fas fa-angle-double-down"></i>
      <span>全展开</span>
    </button>
    <button class="toc-control-btn" id="toc-collapse-all" title="全部折叠" aria-label="全部折叠">
      <i class="fas fa-angle-double-up"></i>
      <span>全折叠</span>
    </button>
  `;

  // 将控制区域添加到TOC弹窗
  if (tocPopup) {
    tocPopup.appendChild(tocControls);
  }

  /**
   * TOC映射表 - 支持更多语言对照
   */
  const tocMap = {
    '历史详情': 'History Detail',
    'OCR内容': 'OCR Content',
    '仅OCR': 'OCR Only',
    '翻译内容': 'Translation',
    '仅翻译': 'Translation Only',
    '分块对比': 'Chunk Compare',
    '摘要': 'Abstract',
    '引言': 'Introduction',
    '方法': 'Methods',
    '结果': 'Results',
    '讨论': 'Discussion',
    '结论': 'Conclusion',
    '参考文献': 'References',
    '附录': 'Appendix'
  };

  /**
   * 存储TOC列表项对应的页面内标题DOM元素
   */
  let tocNodes = [];

  /**
   * 现代化智能文本截断函数
   * @param {string} text - 要截断的文本
   * @param {number} maxLength - 最大长度
   * @returns {string} 截断后的文本
   */
  function smartTruncateText(text, maxLength = 35) {
    if (!text || text.length <= maxLength) return text;

    // 检查是否是图表标题
    const isChartTitle = /^(图|表|Figure|Table)\s*\d+/i.test(text);
    
    // 对于图表标题，使用更智能的截断策略
    if (isChartTitle) {
      const titleMatch = text.match(/^(图|表|Figure|Table)\s*\d+[\.:\：]?\s*(.*)$/i);
      if (titleMatch) {
        const prefix = titleMatch[1];
        const content = titleMatch[2] || '';
        
        // 在内容中查找合适的截断点
        const sentenceEnd = content.search(/[。！？\.!?]/); 
        if (sentenceEnd > 0 && sentenceEnd <= maxLength - prefix.length - 5) {
          return prefix + content.substring(0, sentenceEnd + 1);
        }
      }
    }

    // 智能截断：优先在标点符号处截断
    const punctuationRegex = /[。，！？；：、\.,!?;:]/g;
    let match;
    let lastPunctIndex = -1;
    
    while ((match = punctuationRegex.exec(text)) !== null) {
      if (match.index < maxLength - 3) {
        lastPunctIndex = match.index;
      } else {
        break;
      }
    }
    
    if (lastPunctIndex > maxLength * 0.6) {
      return text.substring(0, lastPunctIndex + 1);
    }
    
    // 在空格处截断
    const spaceIndex = text.lastIndexOf(' ', maxLength - 3);
    if (spaceIndex > maxLength * 0.7) {
      return text.substring(0, spaceIndex) + '...';
    }
    
    // 最后使用硬截断
    return text.substring(0, maxLength - 3) + '...';
  }

  /**
   * 现代化临时加载效果，带进度指示
   * @param {string} sectionName - 正在导航到的章节名称
   */
  function showEnhancedLoadingEffect(sectionName) {
    let effectDiv = document.getElementById('toc-loading-effect');
    const mainContainer = document.querySelector('.container');

    if (!effectDiv) {
      effectDiv = document.createElement('div');
      effectDiv.id = 'toc-loading-effect';
      effectDiv.className = 'loading-effect';
      document.body.appendChild(effectDiv);
    }

    if (mainContainer) {
      mainContainer.classList.add('content-blurred');
    }

    const truncatedSectionName = smartTruncateText(sectionName, 30);
    effectDiv.innerHTML = `
      <div class="loading-content">
        <div class="loading-icon">
          <i class="fas fa-compass"></i>
        </div>
        <div class="loading-text">正在前往</div>
        <div class="loading-target">${truncatedSectionName}</div>
        <div class="loading-progress">
          <div class="progress-bar"></div>
        </div>
      </div>
    `;

    requestAnimationFrame(() => {
      effectDiv.classList.add('loading-effect-visible');
      
      // 启动进度条动画
      const progressBar = effectDiv.querySelector('.progress-bar');
      if (progressBar) {
        progressBar.style.width = '0%';
        setTimeout(() => {
          progressBar.style.width = '100%';
        }, 100);
      }
    });

    setTimeout(() => {
      effectDiv.classList.remove('loading-effect-visible');
      if (mainContainer) {
        mainContainer.classList.remove('content-blurred');
      }
    }, 1800);
  }

  /**
   * 现代化平滑切换TOC项的折叠状态
   * @param {HTMLElement} toggleBtn - 折叠/展开按钮元素
   * @param {HTMLElement} childrenContainer - 子项容器元素
   */
  function toggleTocItem(toggleBtn, childrenContainer) {
    const isCollapsed = toggleBtn.classList.contains('collapsed');
    const listItem = toggleBtn.closest('li');

    if (isCollapsed) {
      // 展开动画
      toggleBtn.classList.remove('collapsed');
      childrenContainer.classList.remove('collapsed');

      // 计算目标高度
      childrenContainer.style.height = '0';
      childrenContainer.style.opacity = '0';
      childrenContainer.style.transform = 'translateY(-10px)';
      
      const targetHeight = Array.from(childrenContainer.children)
        .reduce((height, child) => height + child.offsetHeight, 0);

      // 触发动画
      requestAnimationFrame(() => {
        childrenContainer.style.height = targetHeight + 'px';
        childrenContainer.style.opacity = '1';
        childrenContainer.style.transform = 'translateY(0)';
      });

      // 动画完成后清理样式
      setTimeout(() => {
        childrenContainer.style.height = 'auto';
      }, 300);
      
      // 添加展开状态指示
      if (listItem) {
        listItem.classList.add('toc-expanded');
      }
    } else {
      // 折叠动画
      const currentHeight = childrenContainer.offsetHeight;
      childrenContainer.style.height = currentHeight + 'px';
      
      requestAnimationFrame(() => {
        toggleBtn.classList.add('collapsed');
        childrenContainer.style.height = '0';
        childrenContainer.style.opacity = '0';
        childrenContainer.style.transform = 'translateY(-10px)';
      });
      
      setTimeout(() => {
        childrenContainer.classList.add('collapsed');
      }, 300);
      
      // 移除展开状态指示
      if (listItem) {
        listItem.classList.remove('toc-expanded');
      }
    }
    
    // 保存用户的折叠偏好
    const itemId = listItem?.querySelector('a')?.getAttribute('href');
    if (itemId) {
      const collapsedItems = JSON.parse(localStorage.getItem('toc-collapsed-items') || '[]');
      if (isCollapsed) {
        // 展开：从折叠列表中移除
        const index = collapsedItems.indexOf(itemId);
        if (index > -1) collapsedItems.splice(index, 1);
      } else {
        // 折叠：添加到折叠列表
        if (!collapsedItems.includes(itemId)) {
          collapsedItems.push(itemId);
        }
      }
      localStorage.setItem('toc-collapsed-items', JSON.stringify(collapsedItems));
    }
  }

  // 现代化打开/关闭悬浮窗
  tocBtn.onclick = function() {
    const isOpen = tocPopup.classList.contains('toc-popup-visible');
    if (isOpen) {
      // 关闭动画
      tocPopup.classList.remove('toc-popup-visible');
      tocPopup.classList.add('toc-popup-hiding');
      setTimeout(() => {
        tocPopup.classList.remove('toc-popup-hiding');
        tocPopup.classList.add('toc-popup-hidden');
      }, 400);
    } else {
      // 打开前检查和更新内容
      updateTocModeSelectorVisibility();
      
      // 如果缓存无效，重新渲染
      if (!tocCache.isValid()) {
        renderTocList();
      }
      
      // 打开动画
      tocPopup.classList.remove('toc-popup-hidden', 'toc-popup-hiding');
      tocPopup.classList.add('toc-popup-visible');
      
      // 延迟聚焦以改善用户体验
      setTimeout(() => {
        const firstLink = tocPopup.querySelector('#toc-list a');
        if (firstLink) {
          firstLink.focus();
        }
      }, 100);
    }
  };

  // 关闭悬浮窗按钮
  tocCloseBtn.onclick = function() {
    tocPopup.classList.remove('toc-popup-visible');
    tocPopup.classList.add('toc-popup-hiding');
    setTimeout(() => {
      tocPopup.classList.remove('toc-popup-hiding');
      tocPopup.classList.add('toc-popup-hidden');
    }, 400);
  };

  /**
   * 更新TOC模式选择器的可见性，仅在分块对比模式下显示
   */
  function updateTocModeSelectorVisibility() {
    const visibleTab = document.querySelector('.tab-btn.active');
    const currentTabId = visibleTab ? visibleTab.id : null;
    const isChunkCompareMode = currentTabId === 'tab-chunk-compare';

    if (isChunkCompareMode) {
      tocModeSelector.style.display = 'flex';
    } else {
      tocModeSelector.style.display = 'none';
      if (currentTocMode !== 'both') {
        currentTocMode = 'both';
        tocModeSelector.querySelectorAll('.toc-mode-btn').forEach(b => {
          b.classList.remove('active');
        });
        tocModeSelector.querySelector('[data-mode="both"]').classList.add('active');
      }
    }
  }

  /**
   * 增强的智能层级管理器
   */
  let enhancedLevelManager = {
    prefixMapping: {},
    contextStack: [],
    lastStructureInfo: null,
    
    analyzeHeading: function(text) {
      const patterns = {
        chapter: /^第[一二三四五六七八九十百千万]+[章节篇部]/,
        numeric: /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?/,
        roman: /^([IVX]+)(?:\.([IVX]+))?(?:\.([IVX]+))?/i,
        bulletList: /^[•\*\-]\s+/,
        numberedList: /^(\d+)(?:[\.、]|\s*[\(\（])\s*/,
        specialSection: /^(摘要|Abstract|引言|Introduction|参考文献|References|附录|Appendix|致谢|Acknowledgements|结论|Conclusion|讨论|Discussion|实验|Experiment|方法|Methods|材料|Materials)/i
      };

      let structureInfo = {
        type: 'normal',
        level: null,
        prefix: '',
        content: text,
        confidence: 0
      };

      // 检测各种模式并计算置信度
      for (const [type, pattern] of Object.entries(patterns)) {
        const match = text.match(pattern);
        if (match) {
          structureInfo.type = type;
          structureInfo.prefix = match[0];
          structureInfo.content = text.substring(match[0].length).trim();
          structureInfo.confidence = this.calculateConfidence(type, match);
          
          // 根据类型确定层级
          structureInfo.level = this.determineLevelByType(type, match);
          break;
        }
      }

      // 更新上下文栈
      this.updateContextStack(structureInfo);
      this.lastStructureInfo = structureInfo;
      
      return structureInfo;
    },

    calculateConfidence: function(type, match) {
      // 基于模式复杂度和匹配质量计算置信度
      const confidenceMap = {
        'specialSection': 0.95,
        'chapter': 0.9,
        'numeric': 0.85,
        'roman': 0.8,
        'numberedList': 0.7,
        'bulletList': 0.6
      };
      return confidenceMap[type] || 0.5;
    },

    determineLevelByType: function(type, match) {
      switch (type) {
        case 'specialSection':
        case 'chapter':
          return 1;
        case 'numeric':
          return (match[0].match(/\./g) || []).length + 1;
        case 'roman':
          return (match[0].match(/\./g) || []).length + 1;
        case 'numberedList':
        case 'bulletList':
          return (this.lastStructureInfo?.level || 1) + 1;
        default:
          return 2;
      }
    },

    updateContextStack: function(structureInfo) {
      // 维护结构化上下文栈
      if (structureInfo.level) {
        // 移除更深层级的项目
        this.contextStack = this.contextStack.filter(item => item.level < structureInfo.level);
        this.contextStack.push(structureInfo);
      }
    }
  };

  /**
   * 主要的TOC渲染函数 - 增强版
   */
  function renderTocList() {
    const startTime = performance.now();
    
    // 检查缓存
    if (tocCache.isValid() && tocCache.structure) {
      buildTocHtml(tocCache.structure.children, tocList);
      return;
    }

    tocList.innerHTML = '';
    tocNodes = [];
    
    const container = document.querySelector('.container');
    if (!container) return;

    // 收集所有潜在标题
    let potentialHeadings = [];
    container.querySelectorAll('h1, h2:not(#fileName), h3, h4, h5, h6, p.converted-from-heading').forEach(h => {
      potentialHeadings.push(h);
    });

    // 添加图表标题
    const captionRegex = /^(图|表|Figure|Table)\s*[\d\w.-]+\b/i;
    container.querySelectorAll('p').forEach(p => {
      const text = p.textContent.trim();
      if (captionRegex.test(text)) {
        p.dataset.isCaptionToc = "true";
        p.dataset.isChartCaption = "true";
        potentialHeadings.push(p);
      }
    });

    // 按文档顺序排序
    potentialHeadings.sort((a, b) => {
      const position = a.compareDocumentPosition(b);
      return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });

    // 根据当前模式过滤
    let filteredHeadings = filterHeadingsByMode(potentialHeadings);

    // 构建TOC结构
    const tocStructure = buildTocStructure(filteredHeadings);
    
    // 缓存结果
    tocCache.structure = tocStructure;
    tocCache.nodes = tocNodes;
    tocCache.lastUpdate = Date.now();

    // 渲染HTML
    buildTocHtml(tocStructure.children, tocList);

    // 恢复折叠状态
    restoreCollapsedState();

    // 记录性能指标
    performanceMetrics.renderTime = performance.now() - startTime;
    performanceMetrics.nodeCount = tocNodes.length;
    
    console.log(`TOC渲染完成: ${performanceMetrics.nodeCount}个节点, 耗时${performanceMetrics.renderTime.toFixed(2)}ms`);
  }

  /**
   * 根据模式过滤标题
   */
  function filterHeadingsByMode(headings) {
    if (currentTocMode === 'both') {
      return headings;
    }

    const visibleTab = document.querySelector('.tab-btn.active');
    const currentTabId = visibleTab ? visibleTab.id : null;
    const isChunkCompareMode = currentTabId === 'tab-chunk-compare';

    if (isChunkCompareMode) {
      const selector = currentTocMode === 'ocr' ? '.align-block-ocr' : '.align-block-trans';
      return headings.filter(el => el.closest(selector) !== null);
    } else {
      const expectedTabId = currentTocMode === 'ocr' ? 'tab-ocr' : 'tab-translation';
      if (currentTabId === expectedTabId) {
        return headings;
      } else {
        // 显示提示信息
        const li = document.createElement('li');
        li.className = 'toc-info';
        li.innerHTML = `
          <div class="toc-mode-hint">
            <i class="fas fa-info-circle"></i>
            <span>请切换到${currentTocMode === 'ocr' ? '原文' : '译文'}标签页查看对应目录</span>
          </div>
        `;
        tocList.appendChild(li);
        return [];
      }
    }
  }

  /**
   * 构建TOC层级结构
   */
  function buildTocStructure(headings) {
    const structure = { root: true, children: [] };
    let currentPath = [structure];
    let previousLevel = 0;

    headings.forEach((nodeEl, idx) => {
      if (!nodeEl.id) nodeEl.id = 'toc-auto-' + idx;
      tocNodes.push(nodeEl);

      const text = nodeEl.textContent.trim();
      if (text.includes('原文块') || text.includes('译文块')) return;

      // 使用增强的层级管理器分析
      const structureInfo = enhancedLevelManager.analyzeHeading(text);
      const level = structureInfo.level || getDefaultLevel(nodeEl);

      // 调整路径
      adjustPath(currentPath, level, previousLevel);

      // 创建TOC项
      const tocItem = createTocItem(nodeEl, text, level, structureInfo);
      currentPath[currentPath.length - 1].children.push(tocItem);
      
      previousLevel = level;
    });

    return structure;
  }

  /**
   * 获取默认层级
   */
  function getDefaultLevel(element) {
    const tagName = element.tagName.toLowerCase();
    if (tagName.match(/^h[1-6]$/)) {
      return parseInt(tagName.substring(1));
    }
    return element.dataset.isChartCaption === "true" ? 4 : 3;
  }

  /**
   * 调整当前路径
   */
  function adjustPath(path, currentLevel, previousLevel) {
    if (currentLevel > previousLevel) {
      // 进入更深层级
      while (path.length < currentLevel) {
        if (path[path.length - 1].children.length === 0) {
          // 创建占位符
          const placeholder = {
            id: 'placeholder-' + Date.now(),
            text: '未命名章节',
            level: path.length,
            children: []
          };
          path[path.length - 1].children.push(placeholder);
        }
        path.push(path[path.length - 1].children[path[path.length - 1].children.length - 1]);
      }
    } else if (currentLevel < previousLevel) {
      // 返回上层
      const levelsToGoUp = previousLevel - currentLevel;
      for (let i = 0; i < levelsToGoUp && path.length > 1; i++) {
        path.pop();
      }
    }
  }

  /**
   * 创建TOC项
   */
  function createTocItem(element, text, level, structureInfo) {
    const displayText = smartTruncateText(text);
    const translation = tocMap[text];
    
    return {
      id: element.id,
      text: displayText,
      originalText: text,
      translation: translation,
      level: level,
      children: [],
      isChartCaption: element.dataset.isChartCaption === "true",
      structureInfo: structureInfo,
      element: element
    };
  }

  /**
   * 构建TOC HTML - 增强版
   */
  function buildTocHtml(items, parentElement) {
    items.forEach(item => {
      if (item.id?.indexOf('placeholder') === 0 && !item.text) return;

      const li = document.createElement('li');
      const hasChildren = item.children && item.children.length > 0;

      // 设置CSS类
      li.className = getTocItemClasses(item, hasChildren);

      // 构建链接HTML
      const linkHTML = buildLinkHTML(item, hasChildren);
      const link = document.createElement('a');
      link.href = `#${item.id}`;
      link.innerHTML = linkHTML;
      link.dataset.originalText = item.originalText;

      // 添加现代化点击事件
      addEnhancedClickHandler(link, item);

      li.appendChild(link);

      // 添加子项
      if (hasChildren) {
        const childrenContainer = document.createElement('ul');
        childrenContainer.className = 'toc-children';
        buildTocHtml(item.children, childrenContainer);
        li.appendChild(childrenContainer);

        // 添加折叠按钮事件
        addToggleHandler(li);
      }

      parentElement.appendChild(li);
    });
  }

  /**
   * 获取TOC项的CSS类
   */
  function getTocItemClasses(item, hasChildren) {
    let classes = [];
    
    if (item.level) {
      if (item.isChartCaption) {
        classes.push('toc-caption');
      } else {
        classes.push(`toc-h${item.level}`);
      }
    }

    if (hasChildren) {
      classes.push('has-children');
    }

    if (item.structureInfo?.type && item.structureInfo.type !== 'normal') {
      classes.push('toc-structured', `toc-structure-${item.structureInfo.type}`);
    }

    return classes.join(' ');
  }

  /**
   * 构建链接HTML
   */
  function buildLinkHTML(item, hasChildren) {
    let html = '';

    if (hasChildren) {
      html += '<span class="toc-toggle">▼</span>';
    }

    html += '<span class="toc-text">';

    // 添加结构化前缀
    if (item.structureInfo?.prefix) {
      html += `<span class="toc-prefix">${item.structureInfo.prefix}</span>`;
    }

    // 添加图表图标
    if (item.isChartCaption) {
      const isTable = item.originalText?.startsWith('表');
      const icon = isTable ? '📊' : '📈';
      html += `<span class="toc-chart-icon">${icon}</span>`;
    }

    // 添加内容
    let displayText = item.text;
    if (item.structureInfo?.prefix && displayText.startsWith(item.structureInfo.prefix)) {
      displayText = displayText.substring(item.structureInfo.prefix.length).trim();
    }
    
    html += `<span class="toc-content">${displayText}</span>`;

    // 添加翻译
    if (item.translation && item.translation !== item.originalText) {
      html += `<span class="toc-en-translation">/ ${item.translation}</span>`;
    }

    html += '</span>';
    return html;
  }

  /**
   * 添加增强的点击处理器
   */
  function addEnhancedClickHandler(link, item) {
    link.onclick = function(e) {
      e.preventDefault();

      console.log('[TOC Debug] TOC 点击事件触发:', item.id);

      const targetElement = document.getElementById(item.id);
      if (!targetElement) {
        console.log('[TOC Debug] 未找到目标元素:', item.id);
        return;
      }

      // 计算距离并决定是否显示加载效果
      const clickedNodeIndex = tocNodes.findIndex(n => n.id === item.id);
      const currentTopNodeIndex = getCurrentTopNodeIndex();
      const indexDifference = Math.abs(clickedNodeIndex - currentTopNodeIndex);

      if (indexDifference >= 6) {
        showEnhancedLoadingEffect(item.originalText || "目标章节");
      }

      console.log('[TOC Debug] 检查沉浸模式:', {
        hasImmersiveLayout: !!window.ImmersiveLayout,
        isActive: window.ImmersiveLayout?.isActive()
      });

      // 修复：在沉浸模式下使用自定义滚动逻辑，避免布局偏移
      if (window.ImmersiveLayout && window.ImmersiveLayout.isActive()) {
        console.log('[TOC Debug] 进入沉浸模式分支');
        // 沉浸模式下使用自定义滚动定位
        // 优先查找 .content-wrapper（真正的滚动容器）
        let scrollContainer = document.querySelector('#immersive-main-content-area .content-wrapper');

        // 后备方案 1：查找 .js-scroll-container 标记
        if (!scrollContainer) {
          scrollContainer = document.querySelector('#immersive-main-content-area .js-scroll-container');
        }

        // 后备方案 2：查找 .tab-content
        if (!scrollContainer) {
          scrollContainer = document.querySelector('#immersive-main-content-area .tab-content');
        }

        if (scrollContainer) {
          // 使用 computed style 检查是否可滚动（而不是检查内联样式）
          const computedStyle = getComputedStyle(scrollContainer);
          const overflowY = computedStyle.overflowY;
          const isScrollable = (overflowY === 'auto' || overflowY === 'scroll');

          console.log('[TOC Debug] 沉浸模式滚动检测:', {
            scrollContainer: scrollContainer.className,
            overflowY,
            isScrollable,
            scrollHeight: scrollContainer.scrollHeight,
            clientHeight: scrollContainer.clientHeight
          });

          // 只要找到了滚动容器，就尝试滚动（即使当前没有滚动条）
          if (isScrollable) {
            // 计算目标元素在滚动容器内的绝对位置
            const containerRect = scrollContainer.getBoundingClientRect();
            const targetRect = targetElement.getBoundingClientRect();
            const currentScrollTop = scrollContainer.scrollTop;

            // 目标元素相对于容器内容的绝对位置 = 当前滚动位置 + 目标相对于容器视口的位置
            const targetOffsetInContainer = currentScrollTop + (targetRect.top - containerRect.top);

            // 改进的滚动逻辑：确保目标元素可见，但不滚动过头
            // 如果目标元素已经在视口内，就不滚动
            const viewportTop = containerRect.top;
            const viewportBottom = containerRect.bottom;
            const targetTop = targetRect.top;
            const targetBottom = targetRect.bottom;

            // 目标元素已经完全可见，不需要滚动
            if (targetTop >= viewportTop && targetBottom <= viewportBottom) {
              return;
            }

            // 目标元素在视口上方，需要向上滚动
            if (targetTop < viewportTop) {
              const scrollDelta = targetTop - viewportTop;
              scrollContainer.scrollTo({
                top: currentScrollTop + scrollDelta,
                behavior: 'smooth'
              });
              return;
            }

            // 目标元素在视口下方，需要向下滚动
            // 将目标元素滚动到视口底部附近
            if (targetBottom > viewportBottom) {
              const scrollDelta = targetBottom - viewportBottom + 20; // 底部留 20px 空隙
              scrollContainer.scrollTo({
                top: currentScrollTop + scrollDelta,
                behavior: 'smooth'
              });
              return;
            }
          }
        }

        // 如果没有找到滚动容器，不调用 scrollIntoView，避免滚动 overflow:hidden 的祖先容器
        return;
      } else {
        // 普通模式下，检查是否需要滚动 .tab-content 容器（OCR/翻译模式）
        const tabContent = document.querySelector('.tab-content');

        // 检查 tabContent 是否是滚动容器
        if (tabContent) {
          const computedStyle = getComputedStyle(tabContent);
          const overflowY = computedStyle.overflowY;
          const overflow = computedStyle.overflow;
          // 支持 auto 和 scroll
          const isScrollable = (overflowY === 'auto' || overflowY === 'scroll' || overflow === 'auto' || overflow === 'scroll');
          const hasScroll = tabContent.scrollHeight > tabContent.clientHeight;

          if (isScrollable && hasScroll) {
            // 计算目标元素相对于滚动容器的位置
            const containerRect = tabContent.getBoundingClientRect();
            const targetRect = targetElement.getBoundingClientRect();
            const currentScrollTop = tabContent.scrollTop;

            // 计算目标位置（将元素置于容器中心）
            const targetScrollTop = currentScrollTop + targetRect.top - containerRect.top - (containerRect.height / 2) + (targetRect.height / 2);

            // 平滑滚动到目标位置
            tabContent.scrollTo({
              top: Math.max(0, targetScrollTop),
              behavior: 'smooth'
            });
          } else {
            // 如果 tab-content 不是滚动容器或不需要滚动，使用原生 scrollIntoView
            targetElement.scrollIntoView({
              behavior: 'smooth',
              block: 'center',
              inline: 'nearest'
            });
          }
        } else {
          // tab-content 不存在，使用原生 scrollIntoView
          targetElement.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'nearest'
          });
        }
      }

      // 添加高亮效果
      addHighlightEffect(targetElement);
    };
  }

  /**
   * 获取当前顶部节点索引
   */
  function getCurrentTopNodeIndex() {
    if (tocNodes.length === 0) return 0;

    let minPositiveTop = Infinity;
    let topIndex = 0;

    for (let i = 0; i < tocNodes.length; i++) {
      const rect = tocNodes[i].getBoundingClientRect();
      if (rect.top >= 0 && rect.top < minPositiveTop) {
        minPositiveTop = rect.top;
        topIndex = i;
      }
    }

    return topIndex;
  }

  /**
   * 添加高亮效果
   */
  function addHighlightEffect(element) {
    element.classList.add('toc-target-highlight');
    setTimeout(() => {
      element.classList.remove('toc-target-highlight');
    }, 3000);
  }

  /**
   * 添加折叠按钮处理器
   */
  function addToggleHandler(li) {
    const toggleBtn = li.querySelector('.toc-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        e.preventDefault();

        const childContainer = this.closest('li').querySelector('.toc-children');
        if (childContainer) {
          toggleTocItem(this, childContainer);
        }
      });
    }
  }

  /**
   * 恢复折叠状态
   */
  function restoreCollapsedState() {
    const collapsedItems = JSON.parse(localStorage.getItem('toc-collapsed-items') || '[]');
    
    collapsedItems.forEach(itemId => {
      const link = tocList.querySelector(`a[href="${itemId}"]`);
      if (link) {
        const li = link.closest('li');
        const toggleBtn = li.querySelector('.toc-toggle');
        const childrenContainer = li.querySelector('.toc-children');
        
        if (toggleBtn && childrenContainer) {
          toggleBtn.classList.add('collapsed');
          childrenContainer.classList.add('collapsed');
        }
      }
    });
  }

  // 键盘导航支持
  function addKeyboardNavigation() {
    tocPopup.addEventListener('keydown', function(e) {
      const focusedElement = document.activeElement;
      
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          navigateToNext(focusedElement);
          break;
        case 'ArrowUp':
          e.preventDefault();
          navigateToPrevious(focusedElement);
          break;
        case 'Enter':
        case ' ':
          if (focusedElement.classList.contains('toc-toggle')) {
            e.preventDefault();
            focusedElement.click();
          }
          break;
        case 'Escape':
          e.preventDefault();
          tocCloseBtn.click();
          break;
      }
    });
  }

  function navigateToNext(current) {
    const allFocusable = tocPopup.querySelectorAll('a, .toc-toggle, .toc-control-btn');
    const currentIndex = Array.from(allFocusable).indexOf(current);
    const nextElement = allFocusable[currentIndex + 1];
    if (nextElement) nextElement.focus();
  }

  function navigateToPrevious(current) {
    const allFocusable = tocPopup.querySelectorAll('a, .toc-toggle, .toc-control-btn');
    const currentIndex = Array.from(allFocusable).indexOf(current);
    const prevElement = allFocusable[currentIndex - 1];
    if (prevElement) prevElement.focus();
  }

  // 控制按钮事件绑定
  function bindControlEvents() {
    // 展开/收起目录
    document.getElementById('toc-expand-btn').addEventListener('click', function() {
      const isExpanded = tocPopup.classList.contains('toc-expanded');
      const icon = this.querySelector('i');
      const text = this.querySelector('span');
      
      if (isExpanded) {
        tocPopup.classList.remove('toc-expanded');
        icon.className = 'fas fa-expand-arrows-alt';
        text.textContent = '展开';
        this.title = '展开目录';
      } else {
        tocPopup.classList.add('toc-expanded');
        icon.className = 'fas fa-compress-arrows-alt';
        text.textContent = '收起';
        this.title = '收起目录';
      }
    });

    // 全部展开
    document.getElementById('toc-expand-all').addEventListener('click', function() {
      const allToggleButtons = tocList.querySelectorAll('.toc-toggle.collapsed');
      allToggleButtons.forEach(btn => {
        const childrenContainer = btn.closest('li').querySelector('.toc-children');
        if (childrenContainer) {
          toggleTocItem(btn, childrenContainer);
        }
      });
    });

    // 全部折叠
    document.getElementById('toc-collapse-all').addEventListener('click', function() {
      const allToggleButtons = tocList.querySelectorAll('.toc-toggle:not(.collapsed)');
      allToggleButtons.forEach(btn => {
        const childrenContainer = btn.closest('li').querySelector('.toc-children');
        if (childrenContainer) {
          toggleTocItem(btn, childrenContainer);
        }
      });
    });
  }

  // 全局刷新函数
  window.refreshTocList = function() {
    tocCache.clearCache();
    updateTocModeSelectorVisibility();
    renderTocList();
  };

  // 初始化
  function init() {
    updateTocModeSelectorVisibility();
    renderTocList();
    addKeyboardNavigation();
    bindControlEvents();
    initContentObserver();
    
    // 监听标签页切换
    document.querySelectorAll('.tab-btn').forEach(tab => {
      tab.addEventListener('click', () => {
        setTimeout(updateTocModeSelectorVisibility, 100);
      });
    });

    console.log('Enhanced TOC initialized successfully');
  }

  // 启动初始化：仅在真实浏览器环境（readyState 为 string）下执行
  const rs = document.readyState;
  if (rs === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else if (typeof rs === 'string') {
    init();
  } else {
    // 测试/非浏览器 DOM：不自动初始化
  }

  // 暴露API
  window.EnhancedTocFeature = {
    refresh: window.refreshTocList,
    getNodes: () => tocNodes,
    getStructure: () => tocCache.structure,
    getMetrics: () => performanceMetrics,
    setMode: (mode) => {
      if (['both', 'ocr', 'translation'].includes(mode)) {
        currentTocMode = mode;
        renderTocList();
      }
    }
  };

})();

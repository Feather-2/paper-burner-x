/**
 * @namespace TocFeature
 * @description 管理页面右侧浮动的目录 (Table of Contents) 功能。
 * 包括TOC按钮的点击事件、TOC悬浮窗的显示/隐藏、
 * 以及动态生成TOC列表项。
 */
(function TocFeature(){
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[ch]);
  }

  // 兼容层：避免其他脚本在 TOC 初始化前调用时报错
  if (typeof window.refreshTocList !== 'function') window.refreshTocList = function() {};
  if (typeof window.getCurrentTocStructure !== 'function') window.getCurrentTocStructure = function() { return null; };
  if (typeof window.getTocNodes !== 'function') window.getTocNodes = function() { return []; };

  const tocBtn = document.getElementById('toc-float-btn');
  const tocPopup = document.getElementById('toc-popup');
  const tocList = document.getElementById('toc-list');
  const tocCloseBtn = document.getElementById('toc-popup-close-btn');
  if (!tocBtn || !tocPopup || !tocList || !tocCloseBtn) return;

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

  // 添加底部控制区域（合并展开目录按钮和全部展开/折叠按钮）
  const tocControls = document.createElement('div');
  tocControls.className = 'toc-controls';
  tocControls.innerHTML = `
    <button class="toc-control-btn" id="toc-expand-btn" title="展开目录" aria-label="展开目录">
      <i class="fa-solid fa-angles-right"></i>
    </button>
    <button class="toc-control-btn" id="toc-expand-all" title="全部展开" aria-label="全部展开">
      <i class="fa-solid fa-angle-double-down"></i>
    </button>
    <button class="toc-control-btn" id="toc-collapse-all" title="全部折叠" aria-label="全部折叠">
      <i class="fa-solid fa-angle-double-up"></i>
    </button>
  `;

  // 将控制区域添加到TOC弹窗
  if (tocPopup) {
    tocPopup.appendChild(tocControls);
  }

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
    // 如果文本不超过35个字符，直接返回
    if (text.length <= 35) {
      return text;
    }

    // 检查文本是否是图表标题（以"图"或"表"开头，后跟数字）
    const isChartTitle = /^(图|表)\s*\d+\.?\s*/.test(text);

    // 如果是图表标题，优先在第一个句号或逗号处截断
    if (isChartTitle) {
      const dotIndex = text.indexOf('。');
      const commaIndex = text.indexOf('，');
      // 也检查英文句号和逗号
      const enDotIndex = text.indexOf('.');
      const enCommaIndex = text.indexOf(',');

      // 找到第一个有效的截断标点位置
      let firstCutIndex = -1;
      // 优先使用句号，其次使用逗号
      if (dotIndex !== -1) {
        firstCutIndex = dotIndex;
      } else if (enDotIndex !== -1) {
        // 确保英文句号不是数字的一部分
        const charBeforeDot = text.charAt(enDotIndex-1);
        const charAfterDot = text.charAt(enDotIndex+1);
        // 如果句号前后都是数字，可能是小数点，继续检查其他标点
        if (!(/\d/.test(charBeforeDot) && /\d/.test(charAfterDot))) {
          firstCutIndex = enDotIndex;
        }
      }

      // 如果没有找到句号，尝试使用逗号
      if (firstCutIndex === -1) {
        if (commaIndex !== -1) {
          firstCutIndex = commaIndex;
        } else if (enCommaIndex !== -1) {
          firstCutIndex = enCommaIndex;
        }
      }

      // 如果仍然没有找到有效的截断点，使用所有标点中最早的一个
      if (firstCutIndex === -1) {
        const allPunctIndices = [dotIndex, commaIndex, enDotIndex, enCommaIndex].filter(idx => idx !== -1);
        if (allPunctIndices.length > 0) {
          firstCutIndex = Math.min(...allPunctIndices);
        }
      }

      // 确保标点不是图表编号的一部分（如"图5."中的句号）
      if (firstCutIndex > 5) {
        // 特殊处理英文句号，可能是小数点
        if (firstCutIndex === enDotIndex) {
          const charBeforeDot = text.charAt(firstCutIndex-1);
          const charAfterDot = text.charAt(firstCutIndex+1);

          // 如果句号前后都是数字，这可能是编号的一部分
          if (/\d/.test(charBeforeDot) && /\d/.test(charAfterDot)) {
            // 继续寻找下一个标点，同样优先使用句号
            const nextText = text.substring(firstCutIndex + 1);
            const nextDotIndex = nextText.indexOf('。');
            const nextEnDotIndex = nextText.indexOf('.');

            // 优先检查中文句号
            if (nextDotIndex !== -1) {
              return text.substring(0, firstCutIndex + 1 + nextDotIndex + 1);
            }
            // 再检查英文句号
            else if (nextEnDotIndex !== -1) {
              // 确保这个英文句号不是小数点
              const nextCharBefore = firstCutIndex + 1 + nextEnDotIndex - 1 < text.length ?
                                     text.charAt(firstCutIndex + 1 + nextEnDotIndex - 1) : '';
              const nextCharAfter = firstCutIndex + 1 + nextEnDotIndex + 1 < text.length ?
                                    text.charAt(firstCutIndex + 1 + nextEnDotIndex + 1) : '';

              if (!(/\d/.test(nextCharBefore) && /\d/.test(nextCharAfter))) {
                return text.substring(0, firstCutIndex + 1 + nextEnDotIndex + 1);
              }
            }

            // 如果没有找到句号，检查逗号
            const nextCommaIndex = nextText.indexOf('，');
            const nextEnCommaIndex = nextText.indexOf(',');

            if (nextCommaIndex !== -1) {
              return text.substring(0, firstCutIndex + 1 + nextCommaIndex + 1);
            } else if (nextEnCommaIndex !== -1) {
              return text.substring(0, firstCutIndex + 1 + nextEnCommaIndex + 1);
            }

            // 如果都没找到，使用所有下一个标点中最早的一个
            const nextPunctIndices = [nextDotIndex, nextCommaIndex, nextEnDotIndex, nextEnCommaIndex].filter(idx => idx !== -1);
            if (nextPunctIndices.length > 0) {
              const nextCutIndex = Math.min(...nextPunctIndices);
              return text.substring(0, firstCutIndex + 1 + nextCutIndex + 1);
            }
          } else {
            return text.substring(0, firstCutIndex + 1);
          }
        } else {
          return text.substring(0, firstCutIndex + 1);
        }
      }
    }

    // 优先使用中文句号作为截断点
    const chineseDotIndex = text.substring(0, 35).indexOf('。');
    if (chineseDotIndex !== -1) {
      return text.substring(0, chineseDotIndex + 1);
    }

    // 其次使用英文句号（确保不是小数点）
    const englishDotIndex = text.substring(0, 35).indexOf('.');
    if (englishDotIndex !== -1 && englishDotIndex > 0) {
      const charBeforeDot = text.charAt(englishDotIndex - 1);
      const charAfterDot = englishDotIndex + 1 < text.length ? text.charAt(englishDotIndex + 1) : '';

      // 如果不是小数点，使用英文句号截断
      if (!(/\d/.test(charBeforeDot) && /\d/.test(charAfterDot))) {
        return text.substring(0, englishDotIndex + 1);
      }
    }

    // 再使用中文逗号
    const chineseCommaIndex = text.substring(0, 35).indexOf('，');
    if (chineseCommaIndex !== -1) {
      return text.substring(0, chineseCommaIndex + 1);
    }

    // 最后使用英文逗号
    const englishCommaIndex = text.substring(0, 35).indexOf(',');
    if (englishCommaIndex !== -1) {
      return text.substring(0, englishCommaIndex + 1);
    }

    // 如果以上都没找到，使用其他中文标点
    const otherChinesePunctuationRegex = /[；：！？]/;
    const otherChinesePunctuationMatch = text.substring(0, 35).match(otherChinesePunctuationRegex);
    if (otherChinesePunctuationMatch) {
      return text.substring(0, otherChinesePunctuationMatch.index + 1);
    }

    // 如果中文标点都没有，尝试使用其他英文标点
    const otherEnglishPunctuationRegex = /[;:!?]/;
    const otherEnglishPunctuationMatch = text.substring(0, 35).match(otherEnglishPunctuationRegex);
    if (otherEnglishPunctuationMatch) {
      return text.substring(0, otherEnglishPunctuationMatch.index + 1);
    }

    // 如果都没有找到合适的标点符号，截取前32个字符加省略号
    return text.substring(0, 32) + "...";
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

  /**
   * 切换TOC项的折叠状态
   * @param {HTMLElement} toggleBtn - 折叠/展开按钮元素
   * @param {HTMLElement} childrenContainer - 子项容器元素
   */
  function toggleTocItem(toggleBtn, childrenContainer) {
    const isCollapsed = toggleBtn.classList.contains('collapsed');

    if (isCollapsed) {
      // 展开
      toggleBtn.classList.remove('collapsed');
      childrenContainer.classList.remove('collapsed');

      // 设置高度以实现动画效果
      const originalHeight = childrenContainer.scrollHeight;
      childrenContainer.style.height = '0';

      // 触发回流
      childrenContainer.offsetHeight;

      childrenContainer.style.height = originalHeight + 'px';

      // 延迟后移除固定高度，允许自动调整
      setTimeout(() => {
        childrenContainer.style.height = 'auto';
      }, 300);
    } else {
      // 折叠
      toggleBtn.classList.add('collapsed');

      // 先设置当前高度，然后过渡到0
      childrenContainer.style.height = childrenContainer.scrollHeight + 'px';

      // 强制回流
      childrenContainer.offsetHeight;

      childrenContainer.style.height = '0';
      childrenContainer.classList.add('collapsed');
    }
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
   * - 新增：构建层级结构并支持折叠/展开功能。
   * - 新增：智能识别标题格式，根据标题格式自动调整层级。
   */
  function renderTocList() {
    tocList.innerHTML = '';
    tocNodes = []; // 每次渲染时清空并重新填充
    const container = document.querySelector('.container');
    if (!container) return;

    let potentialHeadings = [];
    // 1. 获取标准的 Hx 标题和被转换的长标题
    container.querySelectorAll('h1, h2:not(#fileName), h3, h4, h5, h6, p.converted-from-heading').forEach(h => {
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
        // 同时设置一个标志，表示是图表标题
        p.dataset.isChartCaption = "true";
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

    // 创建一个层级结构对象
    const tocStructure = {
      root: true,
      children: []
    };

    // 存储上一个处理过的TOC项，用于比较和合并
    let previousTocItem = null;
    let previousHeadingLevel = 0;
    let currentPath = [tocStructure]; // 当前路径，从根开始

    // 结构化标题格式的正则表达式
    const chapterPattern = /^第[一二三四五六七八九十百千]+[章节篇部]/; // 匹配"第一章"、"第二节"等
    const numericPattern = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?/; // 匹配"1"、"1.1"、"1.1.1"等
    const romanPattern = /^([IVX]+)(?:\.([IVX]+))?(?:\.([IVX]+))?/i; // 匹配罗马数字标题
    const letterPattern = /^([A-Za-z])(?:\.([A-Za-z]))?(?:\.([A-Za-z]))?/; // 匹配字母标题如"A"、"A.1"

    // 新的正则表达式，增强匹配能力
    const spacedNumericPattern = /^(\d+)\.?\s+(\d+(?:\.?\d+)*)\s+/; // 匹配"3. 1.1 xxxx"和"4. 5 xxxx"格式

    // 新增：多种列表项匹配模式
    const bulletListPattern = /^[•\*\-]\s+/; // 匹配"• xxx"、"* xxx"、"- xxx"等无序列表
    const numberedListPattern = /^(\d+)(?:[\.、]|\s*[\(\（])\s*/; // 匹配"1. xxx"、"2、xxx"、"3) xxx"、"4（xxx"等
    const chineseNumberedListPattern = /^[一二三四五六七八九十]+[\.、]/; // 匹配"一、xxx"等中文编号
    const alphaListPattern = /^[(（]?([a-zA-Z])[\)）\.、]\s*/; // 匹配"(a) xxx"、"(A) xxx"、"a. xxx"、"A、xxx"等
    const specialSymbolListPattern = /^[(（]?[\*\#\+\-][\)）]\s*/; // 匹配"(*) xxx"、"(#) xxx"等特殊符号列表

    // 论文特殊章节标题模式
    const specialSectionPattern = /^(摘要|Abstract|引言|Introduction|参考文献|References|附录|Appendix|致谢|Acknowledgements|结论|Conclusion|讨论|Discussion|实验|Experiment|方法|Methods|材料|Materials)/i;

    // 智能层级管理对象
    let levelManager = {
      // 结构化前缀到层级的映射
      prefixMapping: {},
      // 当前处理到的章节编号
      currentChapter: null,
      currentSection: null,
      currentSubsection: null,

      // 新增属性，用于跟踪更复杂的上下文
      lastStructureType: null, // 上一个结构化标题的类型
      lastStructureLevel: 0,   // 上一个结构化标题的层级
      lastNumericPrefix: null, // 上一个数字前缀，如"1.5"
      lastSimpleNumber: null,  // 上一个简单数字，如"2."中的"2"
      inSimpleList: false,     // 是否在简单数字列表中（如"1. 2. 3."）
      simpleListParentLevel: 0, // 简单数字列表的父级层级

      // 分析标题文本，提取结构化信息
      analyzeHeading: function(text) {
        let structureInfo = {
          type: 'normal', // 默认为普通标题
          level: null,    // 结构化层级
          prefix: '',     // 标题前缀
          content: text,  // 标题内容
          isSimpleNumbered: false // 是否是简单数字编号（如"1. 2. 3."）
        };

        // 检查是否为论文特殊章节标题
        const specialSectionMatch = text.match(specialSectionPattern);
        if (specialSectionMatch) {
          this.lastStructureType = 'special';
          this.lastStructureLevel = 1;
          this.inSimpleList = false;

          structureInfo.type = 'special';
          structureInfo.level = 1; // 特殊章节通常是顶级
          structureInfo.prefix = specialSectionMatch[0];
          structureInfo.content = text;
          return structureInfo;
        }

        // 检查是否为章节标题（如"第一章"）
        const chapterMatch = text.match(chapterPattern);
        if (chapterMatch) {
          this.lastStructureType = 'chapter';
          this.lastStructureLevel = 1;
          this.inSimpleList = false;

          structureInfo.type = 'chapter';
          structureInfo.level = 1; // 章节一般是顶级
          structureInfo.prefix = chapterMatch[0];
          structureInfo.content = text.substring(chapterMatch[0].length).trim();
          return structureInfo;
        }

        // 检查是否为带空格的多级编号格式（如"3. 1.1 xxxx"或"4. 5 xxxx"）
        const spacedNumericMatch = text.match(spacedNumericPattern);
        if (spacedNumericMatch) {
          // 提取主要数字部分
          const mainNumber = spacedNumericMatch[1];
          const subNumbers = spacedNumericMatch[2];

          // 检查子编号是否已经包含点号，如果没有，需要添加
          let formattedSubNumbers = subNumbers;
          if (!subNumbers.includes('.')) {
            formattedSubNumbers = subNumbers; // 如"4. 5 xxxx"中的"5"
          }

          // 组合成标准格式，确保格式正确
          const combinedNumber = mainNumber + "." + formattedSubNumbers.replace(/\s+/g, '');

          // 计算层级（根据点的数量+1）
          const dots = (combinedNumber.match(/\./g) || []).length;

          // 检查是否可能是章节的子节
          let isSubSection = false;
          if (this.lastStructureType === 'chapter' && this.currentChapter === mainNumber) {
            isSubSection = true;
          }

          // 设置适当的层级
          let level = dots + 1;
          if (isSubSection) {
            // 如果是章节的子节，层级应该是章节层级+1
            level = this.lastStructureLevel + 1;
          }

          // 更新状态
          this.lastStructureType = 'numeric';
          this.lastStructureLevel = level;
          this.lastNumericPrefix = combinedNumber;
          this.inSimpleList = false;

          structureInfo.type = 'numeric';
          structureInfo.level = level;
          structureInfo.prefix = spacedNumericMatch[0]; // 保留原始前缀，包括空格
          structureInfo.originalPrefix = combinedNumber; // 保存标准化的前缀
          structureInfo.content = text.substring(spacedNumericMatch[0].length).trim();
          structureInfo.isSubSection = isSubSection; // 标记是否为章节的子节

          // 更新当前处理到的章节编号
          const numParts = combinedNumber.split('.');
          if (numParts.length > 0) this.currentChapter = numParts[0];
          if (numParts.length > 1) this.currentSection = numParts[1];
          if (numParts.length > 2) this.currentSubsection = numParts[2];

          return structureInfo;
        }

        // 新增：检查各种列表项格式
        // 无序列表项
        const bulletMatch = text.match(bulletListPattern);
        if (bulletMatch) {
          // 无序列表通常是当前层级的子层级
          const parentLevel = this.lastStructureLevel || 1;

          this.inSimpleList = true;
          this.simpleListParentLevel = parentLevel;

          structureInfo.type = 'bullet-list';
          structureInfo.level = parentLevel + 1;
          structureInfo.prefix = bulletMatch[0];
          structureInfo.content = text.substring(bulletMatch[0].length).trim();
          structureInfo.isSimpleNumbered = true;
          return structureInfo;
        }

        // 检查是否为各种数字编号列表项（如"1. "、"2、"、"3) "等）
        const numberedMatch = text.match(numberedListPattern);
        if (numberedMatch) {
          const number = numberedMatch[1];
          const parentLevel = this.lastStructureLevel || 1;

          // 判断是否是简单数字列表的开始或延续
          if (!this.inSimpleList) {
            // 如果前一个标题是结构化的，那么这个简单数字可能是其子项
            if (this.lastStructureType && this.lastStructureType !== 'bullet-list') {
              // 设置为简单数字列表模式
              this.inSimpleList = true;
              this.simpleListParentLevel = parentLevel;
              this.lastSimpleNumber = number;

              // 层级为父级层级+1
              structureInfo.level = parentLevel + 1;
              structureInfo.type = 'simple-numbered';
              structureInfo.prefix = numberedMatch[0];
              structureInfo.content = text.substring(numberedMatch[0].length).trim();
              structureInfo.isSimpleNumbered = true;
              return structureInfo;
            }
          } else {
            // 已经在简单数字列表中，继续使用相同的层级
            this.lastSimpleNumber = number;

            structureInfo.level = this.simpleListParentLevel + 1;
            structureInfo.type = 'simple-numbered';
            structureInfo.prefix = numberedMatch[0];
            structureInfo.content = text.substring(numberedMatch[0].length).trim();
            structureInfo.isSimpleNumbered = true;
            return structureInfo;
          }
        }

        // 检查中文数字编号列表项（如"一、"）
        const chineseNumberedMatch = text.match(chineseNumberedListPattern);
        if (chineseNumberedMatch) {
          const parentLevel = this.lastStructureLevel || 1;

          this.inSimpleList = true;
          this.simpleListParentLevel = parentLevel;

          structureInfo.type = 'chinese-numbered';
          structureInfo.level = parentLevel + 1;
          structureInfo.prefix = chineseNumberedMatch[0];
          structureInfo.content = text.substring(chineseNumberedMatch[0].length).trim();
          structureInfo.isSimpleNumbered = true;
          return structureInfo;
        }

        // 检查字母编号列表项（如"(a) "、"A. "）
        const alphaMatch = text.match(alphaListPattern);
        if (alphaMatch) {
          const parentLevel = this.lastStructureLevel || 1;

          this.inSimpleList = true;
          this.simpleListParentLevel = parentLevel;

          structureInfo.type = 'alpha-list';
          structureInfo.level = parentLevel + 1;
          structureInfo.prefix = alphaMatch[0];
          structureInfo.content = text.substring(alphaMatch[0].length).trim();
          structureInfo.isSimpleNumbered = true;
          return structureInfo;
        }

        // 检查特殊符号列表项（如"(*) "）
        const specialSymbolMatch = text.match(specialSymbolListPattern);
        if (specialSymbolMatch) {
          const parentLevel = this.lastStructureLevel || 1;

          this.inSimpleList = true;
          this.simpleListParentLevel = parentLevel;

          structureInfo.type = 'special-symbol-list';
          structureInfo.level = parentLevel + 1;
          structureInfo.prefix = specialSymbolMatch[0];
          structureInfo.content = text.substring(specialSymbolMatch[0].length).trim();
          structureInfo.isSimpleNumbered = true;
          return structureInfo;
        }

        // 检查是否为简单数字列表项（如"1. "、"2. "，不包含子编号）
        const simpleNumberMatch = text.match(/^(\d+)\.\s+/);
        if (simpleNumberMatch) {
          const number = simpleNumberMatch[1];

          // 判断是否是简单数字列表的开始或延续
          if (!this.inSimpleList) {
            // 如果前一个标题是结构化的（如"1.5"），那么这个简单数字可能是其子项
            if (this.lastStructureType === 'numeric' && this.lastNumericPrefix) {
              // 设置为简单数字列表模式
              this.inSimpleList = true;
              this.simpleListParentLevel = this.lastStructureLevel;
              this.lastSimpleNumber = number;

              // 层级为父级层级+1
              structureInfo.level = this.simpleListParentLevel + 1;
              structureInfo.type = 'simple-numbered';
              structureInfo.prefix = simpleNumberMatch[0];
              structureInfo.content = text.substring(simpleNumberMatch[0].length).trim();
              structureInfo.isSimpleNumbered = true;
              return structureInfo;
            }
          } else {
            // 已经在简单数字列表中，继续使用相同的层级
            this.lastSimpleNumber = number;

            structureInfo.level = this.simpleListParentLevel + 1;
            structureInfo.type = 'simple-numbered';
            structureInfo.prefix = simpleNumberMatch[0];
            structureInfo.content = text.substring(simpleNumberMatch[0].length).trim();
            structureInfo.isSimpleNumbered = true;
            return structureInfo;
          }
        }

        // 检查是否为数字编号标题（如"1.1"）
        const numericMatch = text.match(numericPattern);
        if (numericMatch) {
          // 计算层级（根据实际匹配到的数字段数）
          let level = 0;
          for (let i = 1; i < numericMatch.length; i++) {
            if (numericMatch[i]) {
              level++;
            }
          }

          // 获取当前编号的主部分（如"1.5"中的"1"）
          const mainNumber = numericMatch[1];

          // 如果之前在简单数字列表中，但现在遇到了正式的结构化编号
          // 例如从"1. 2. 3."列表跳转到"1.6"
          if (this.inSimpleList) {
            // 检查当前编号是否是与父级编号相同的系列
            // 例如，如果父级是"1.5"，那么当前"1.6"应该是同级的
            if (this.lastNumericPrefix && this.lastNumericPrefix.startsWith(mainNumber + '.')) {
              // 退出简单数字列表模式
              this.inSimpleList = false;
            }
          }

          // 更新状态
          this.lastStructureType = 'numeric';
          this.lastStructureLevel = level;
          this.lastNumericPrefix = numericMatch[0];

          structureInfo.type = 'numeric';
          structureInfo.level = level;
          structureInfo.prefix = numericMatch[0];
          structureInfo.content = text.substring(numericMatch[0].length).trim();

          // 更新当前处理到的章节编号
          if (level === 1) {
            this.currentChapter = numericMatch[1];
            this.currentSection = null;
            this.currentSubsection = null;
          } else if (level === 2) {
            this.currentSection = numericMatch[2];
            this.currentSubsection = null;
          } else if (level === 3) {
            this.currentSubsection = numericMatch[3];
          }

          return structureInfo;
        }

        // 检查是否为罗马数字标题
        const romanMatch = text.match(romanPattern);
        if (romanMatch) {
          // 类似处理逻辑...
          this.lastStructureType = 'roman';
          this.inSimpleList = false;

          let dots = 0;
          for (let i = 1; i < romanMatch.length; i++) {
            if (romanMatch[i]) dots++;
          }
          this.lastStructureLevel = dots + 1;

          structureInfo.type = 'roman';
          structureInfo.level = dots + 1;
          structureInfo.prefix = romanMatch[0];
          structureInfo.content = text.substring(romanMatch[0].length).trim();
          return structureInfo;
        }

        // 检查是否为字母标题
        const letterMatch = text.match(letterPattern);
        if (letterMatch) {
          // 类似处理逻辑...
          this.lastStructureType = 'letter';
          this.inSimpleList = false;

          let dots = 0;
          for (let i = 1; i < letterMatch.length; i++) {
            if (letterMatch[i]) dots++;
          }
          this.lastStructureLevel = dots + 1;

          structureInfo.type = 'letter';
          structureInfo.level = dots + 1;
          structureInfo.prefix = letterMatch[0];
          structureInfo.content = text.substring(letterMatch[0].length).trim();
          return structureInfo;
        }

        // 无法识别结构，重置简单列表状态
        this.inSimpleList = false;

        // 无法识别结构，返回默认值
        return structureInfo;
      },

      // 根据标题文本和标签确定层级
      determineLevel: function(text, tagName) {
        // 首先分析标题结构
        const structureInfo = this.analyzeHeading(text);

        // 如果能识别结构化层级，则使用识别的层级
        if (structureInfo.level !== null) {
          return {
            level: structureInfo.level,
            structureInfo: structureInfo
          };
        }

        // 无法识别结构，则根据标签名确定层级
        let headingLevel = 0;
        if (tagName.match(/^h[1-6]$/)) {
          headingLevel = parseInt(tagName.substring(1));
        } else {
          headingLevel = 3; // 默认级别
        }

        return {
          level: headingLevel,
          structureInfo: structureInfo
        };
      }
    };

    filteredHeadings.forEach((nodeEl, idx) => {
      // 补丁1：强制给没有 id 的标题分配唯一 id
      if (!nodeEl.id) nodeEl.id = 'toc-auto-' + idx;
      tocNodes.push(nodeEl); // 存储DOM节点

      let zh = nodeEl.textContent.trim();

      // 过滤掉 "原文块" 或 "译文块" 标题
      if (zh.includes('原文块') || zh.includes('译文块')) {
        return;
      }

      // 应用智能截断
      let displayText = truncateText(zh);
      let en = tocMap[zh]; // 获取英文翻译

      // 检查与前一个TOC项是否相似，如果相似则合并
      if (previousTocItem && areTextsSimilar(previousTocItem, zh)) {
        // 不创建新的TOC项，而是更新前一个的引用
        const lastItem = currentPath[currentPath.length - 1].children[currentPath[currentPath.length - 1].children.length - 1];
        if (lastItem) {
          lastItem.additionalTargetId = nodeEl.id;
        }
        return; // 跳过创建新的TOC项
      }

      // 记录当前项以供下一次比较
      previousTocItem = zh;

      // 确定标题级别
      let headingLevel = 0;
      let nodeTagName = nodeEl.tagName.toLowerCase();
      let isChartCaption = nodeEl.dataset.isChartCaption === "true";

      if (nodeEl.classList.contains('converted-from-heading') && nodeEl.dataset.originalTag) {
        nodeTagName = nodeEl.dataset.originalTag; // 使用原始标签名决定TOC层级
      }

      // 图表标题处理逻辑
      if (nodeEl.dataset.isCaptionToc === "true") {
        // 图表标题默认为其父章节的下一级，先使用默认值
        headingLevel = 4;
        isChartCaption = true;
      } else {
        // 使用结构化识别确定层级
        const { level, structureInfo } = levelManager.determineLevel(zh, nodeTagName);
        headingLevel = level;

        // 如果标题有结构化前缀，保存原始文本用于显示
        if (structureInfo.prefix) {
          nodeEl.dataset.structuredPrefix = structureInfo.prefix;
          // 保存结构信息
          nodeEl.dataset.structureType = structureInfo.type;
        }
      }

      // 如果是图表标题，应用特殊的截断逻辑
      if (isChartCaption) {
        // 首先识别图表标题的前缀部分（如"图5."）
        const titlePrefixMatch = zh.match(/^(图|表)\s*\d+\.?\s*/);
        const titlePrefix = titlePrefixMatch ? titlePrefixMatch[0] : '';
        const contentStart = titlePrefix.length;

        // 在图表标题内容部分查找标点符号作为截断点
        const dotIndex = zh.indexOf('。', contentStart);
        const commaIndex = zh.indexOf('，', contentStart);

        // 找到最近的中文标点
        let firstPunctIndex = -1;
        if (dotIndex !== -1 && commaIndex !== -1) {
          firstPunctIndex = Math.min(dotIndex, commaIndex);
        } else if (dotIndex !== -1) {
          firstPunctIndex = dotIndex;
        } else if (commaIndex !== -1) {
          firstPunctIndex = commaIndex;
        }

        if (firstPunctIndex !== -1) {
          // 找到了中文标点，在此处截断
          displayText = zh.substring(0, firstPunctIndex + 1);
        } else {
          // 尝试查找英文标点
          const enDotIndex = zh.indexOf('.', contentStart);
          const enCommaIndex = zh.indexOf(',', contentStart);

          let firstEnPunctIndex = -1;
          if (enDotIndex !== -1 && enCommaIndex !== -1) {
            firstEnPunctIndex = Math.min(enDotIndex, enCommaIndex);
          } else if (enDotIndex !== -1) {
            firstEnPunctIndex = enDotIndex;
          } else if (enCommaIndex !== -1) {
            firstEnPunctIndex = enCommaIndex;
          }

          // 确保句号不是数字后的小数点（如：图5.1中的点）
          if (firstEnPunctIndex === enDotIndex && firstEnPunctIndex !== -1) {
            let validDotIndex = firstEnPunctIndex;
            while (validDotIndex !== -1) {
              const charBeforeDot = zh.charAt(validDotIndex - 1);
              const charAfterDot = zh.charAt(validDotIndex + 1);

              // 如果句号前是数字，后也是数字，那么这可能是小数点，继续寻找下一个句号
              if (/\d/.test(charBeforeDot) && /\d/.test(charAfterDot)) {
                validDotIndex = zh.indexOf('.', validDotIndex + 1);
              } else {
                // 找到了有效的句号
                break;
              }
            }

            if (validDotIndex !== -1) {
              displayText = zh.substring(0, validDotIndex + 1);
            } else if (enCommaIndex !== -1) {
              // 如果没有有效的句号但有逗号，使用逗号截断
              displayText = zh.substring(0, enCommaIndex + 1);
            }
          } else if (firstEnPunctIndex !== -1) {
            displayText = zh.substring(0, firstEnPunctIndex + 1);
          }
        }

        // 图表标题特殊处理：将其归属到当前层级的下一级
        // 计算其应该属于的层级
        headingLevel = previousHeadingLevel + 1;
        // 限制最大层级，防止层级过深
        if (headingLevel > 6) headingLevel = 6;
      }

      // 新增：读取真实的 data-block-index
      let realBlockIndex = nodeEl.dataset.blockIndex ? parseInt(nodeEl.dataset.blockIndex, 10) : null;

      // 根据标题级别调整当前路径
      if (headingLevel > previousHeadingLevel) {
        // 进入更深层级
        // 确保有父节点
        if (currentPath[currentPath.length - 1].children.length === 0) {
          // 如果当前路径的最后一个节点没有子节点，添加一个占位节点
          // 获取当前文件名作为未命名章节的替代文本
          const fileNameElement = document.getElementById('fileName');
          const fileName = fileNameElement ? fileNameElement.textContent : '未命名章节';

          const placeholderItem = {
            id: 'placeholder-' + idx,
            text: fileName,
            level: previousHeadingLevel,
            children: []
          };
          currentPath[currentPath.length - 1].children.push(placeholderItem);
        }
        // 将最后一个子节点作为新的当前节点
        currentPath.push(currentPath[currentPath.length - 1].children[currentPath[currentPath.length - 1].children.length - 1]);
      } else if (headingLevel < previousHeadingLevel) {
        // 返回上层
        const levelsToGoUp = previousHeadingLevel - headingLevel;
        for (let i = 0; i < levelsToGoUp && currentPath.length > 1; i++) {
          currentPath.pop();
        }
      }

      // 创建新的TOC项
      const tocItem = {
        id: nodeEl.id,
        text: displayText,
        originalText: zh,
        translation: en,
        level: headingLevel,
        children: [],
        isChartCaption: isChartCaption,
        structuredPrefix: nodeEl.dataset.structuredPrefix || null,
        structureType: nodeEl.dataset.structureType || null,
        structureInfo: levelManager.analyzeHeading(zh),
        blockIndex: realBlockIndex // 新增，真实内容流 blockIndex
      };

      // 将TOC项添加到当前路径的最后一个节点
      currentPath[currentPath.length - 1].children.push(tocItem);
      previousHeadingLevel = headingLevel;
    });

    // === 在原有 TOC 节点生成后，补充 blockIndex/startBlockIndex/endBlockIndex 字段 ===
    function parseBlockIndexFromId(id) {
      if (!id) return null;
      let match = id.match(/block-(\d+)/);
      if (match) return parseInt(match[1], 10);
      match = id.match(/toc-anchor-(\d+)/);
      if (match) return parseInt(match[1], 10);
      match = id.match(/toc-auto-(\d+)/);
      if (match) return parseInt(match[1], 10);
      match = id.match(/auto-hx-(\d+)/); // 新增支持 auto-hx-数字
      if (match) return parseInt(match[1], 10);
      return null;
    }
    function supplementBlockIndexRecursive(nodes) {
      for (let i = 0; i < nodes.length; i++) {
        let node = nodes[i];
        node.blockIndex = parseBlockIndexFromId(node.id);
        node.startBlockIndex = node.blockIndex;
        if (i < nodes.length - 1) {
          node.endBlockIndex = nodes[i + 1].blockIndex !== null ? nodes[i + 1].blockIndex - 1 : null;
        } else {
          node.endBlockIndex = null;
        }
        if (node.children && node.children.length > 0) {
          supplementBlockIndexRecursive(node.children);
        }
        if (node.blockIndex == null && node.el && node.el.dataset && node.el.dataset.blockIndex) {
          node.blockIndex = parseInt(node.el.dataset.blockIndex, 10);
        }
      }
    }
    if (tocStructure && tocStructure.children && tocStructure.children.length > 0) {
      supplementBlockIndexRecursive(tocStructure.children);
    }

    // 递归构建TOC HTML
    function buildTocHtml(items, parentElement) {
      items.forEach(item => {
        // 跳过占位符和空标题
        // 1. 空标题
        // 2. "未命名章节"占位符
        // 3. placeholder- 开头的ID（占位符标识）
        // 4. undefined/null 文本
        if (!item.text ||
            item.text === '未命名章节' ||
            item.text === 'undefined' ||
            item.text === 'null' ||
            (item.id && item.id.indexOf('placeholder-') === 0)) {
          return;
        }

        const li = document.createElement('li');
        const hasChildren = item.children && item.children.length > 0;

        // 设置CSS类
        if (item.level) {
          // 只基于item属性判断
          if (item.isCaption || item.isChartCaption) {
            li.className = 'toc-caption';
          } else {
            li.className = `toc-h${item.level}`;
          }

          // 检查是否为简单数字列表项或带空格的多级编号标题
          const isSimpleNumbered = item.structureInfo && item.structureInfo.isSimpleNumbered;
          const hasSpacedNumeric = item.structureInfo && item.structureInfo.originalPrefix;
          const structureType = item.structureInfo && item.structureInfo.type;

          // 如果有结构化前缀、是简单数字列表项或带空格的多级编号，添加结构化样式类
          if (item.structuredPrefix || isSimpleNumbered || hasSpacedNumeric ||
              (structureType && structureType !== 'normal')) {
            li.classList.add(`toc-structured`);

            // 对于简单数字列表项，使用特殊样式类
            if (isSimpleNumbered) {
              li.classList.add('toc-simple-numbered');
              li.classList.add(`toc-structure-simple-numbered`);
            }
            // 对于带空格的多级编号，使用标准数字编号样式
            else if (hasSpacedNumeric) {
              li.classList.add(`toc-structure-numeric`);
              li.classList.add('toc-spaced-numeric');
            }
            // 处理各种新增的列表项类型
            else if (structureType) {
              li.classList.add(`toc-structure-${structureType}`);
            }
            else {
              li.classList.add(`toc-structure-${item.structureType || 'normal'}`);
            }
          }
        }

        if (hasChildren) {
          li.classList.add('has-children');
        }

        // 构建链接HTML
        let linkHTML = '';

        if (hasChildren) {
          linkHTML += `<span class="toc-toggle">▼</span>`;
        }

        // 包装文本内容在一个span中，以便更好地控制多行显示
        linkHTML += `<span class="toc-text">`;

        // 如果有结构化前缀、是简单数字列表项或带空格的多级编号，特殊显示前缀
        if (item.structuredPrefix || (item.structureInfo && item.structureInfo.prefix)) {
          // 对于带空格的多级编号，优先使用标准化的前缀
          let prefix = item.structuredPrefix || item.structureInfo.prefix;
          if (item.structureInfo && item.structureInfo.originalPrefix) {
            prefix = item.structureInfo.originalPrefix; // 使用标准化的格式，如"3.1.1"
          }
          linkHTML += `<span class="toc-prefix">${escapeHtml(prefix)}</span> `;
        }

        // 如果是图表标题，添加特殊图标
        if (item.isChartCaption) {
          // 根据图表类型显示不同图标
          const isTable = item.originalText && item.originalText.trim().startsWith('表');
          const icon = isTable ? '📊' : '📈';
          linkHTML += `<span class="toc-chart-icon">${icon}</span> `;
        }

        // 显示主要文本内容
        let displayText = item.text;

        // 如果有结构化前缀，从显示文本中移除
        if (item.structuredPrefix && displayText.indexOf(item.structuredPrefix) === 0) {
          displayText = displayText.replace(item.structuredPrefix, '').trim();
        }
        // 如果是简单数字列表项，从显示文本中移除前缀
        else if (item.structureInfo && item.structureInfo.prefix &&
                 displayText.indexOf(item.structureInfo.prefix) === 0) {
          displayText = displayText.replace(item.structureInfo.prefix, '').trim();
        }

        // 将文本内容包装在span中，确保正确显示
        linkHTML += `<span class="toc-content">${escapeHtml(displayText)}</span>`;

        if (item.translation && item.translation !== item.originalText) {
          linkHTML += ` <span class="toc-en-translation">／ ${escapeHtml(item.translation)}</span>`;
        }

        linkHTML += `</span>`;

        const link = document.createElement('a');
        link.href = `#${item.id}`;
        link.innerHTML = linkHTML;
        if (item.originalText) {
          link.dataset.originalText = item.originalText;
        }

        if (item.additionalTargetId) {
          link.dataset.additionalTargetId = item.additionalTargetId;
        }

        // 添加点击事件
        link.onclick = function(e) {
        e.preventDefault();
          const targetElement = document.getElementById(item.id);
        if (targetElement) {
            const clickedNodeIndex = tocNodes.findIndex(n => n.id === item.id);
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
              const originalText = this.dataset.originalText || item.originalText;
            showTemporaryLoadingEffect(originalText || "目标章节");
          }

            // 修复：在沉浸模式下使用自定义滚动逻辑，避免布局偏移
            if (window.ImmersiveLayout && window.ImmersiveLayout.isActive()) {
              // 沉浸模式下使用自定义滚动定位
              const scrollContainer = document.querySelector('#immersive-main-content-area .tab-content');
              if (scrollContainer && scrollContainer.style.overflowY === 'auto') {
                // 计算目标元素相对于滚动容器的位置
                const containerRect = scrollContainer.getBoundingClientRect();
                const targetRect = targetElement.getBoundingClientRect();
                const currentScrollTop = scrollContainer.scrollTop;
                
                // 计算目标位置（将元素置于容器中心）
                const targetScrollTop = currentScrollTop + targetRect.top - containerRect.top - (containerRect.height / 2) + (targetRect.height / 2);
                
                // 平滑滚动到目标位置
                scrollContainer.scrollTo({
                  top: Math.max(0, targetScrollTop),
                  behavior: 'smooth'
                });
              } else {
                // 备用方案：使用原生scrollIntoView
                targetElement.scrollIntoView({
                  behavior: 'smooth',
                  block: 'center',
                  inline: 'nearest'
                });
              }
            } else {
              // 普通模式下使用原生scrollIntoView
              targetElement.scrollIntoView({
                behavior: 'smooth',
                block: 'center',
                inline: 'nearest'
              });
            }

            // 添加临时高亮效果
            targetElement.classList.add('toc-target-highlight');

            // 3秒后移除高亮效果
            setTimeout(() => {
              targetElement.classList.remove('toc-target-highlight');
            }, 3000);

          // 检查是否有额外的目标节点
          const additionalTargetId = this.dataset.additionalTargetId;
          if (additionalTargetId) {
            const additionalTarget = document.getElementById(additionalTargetId);
            if (additionalTarget) {
                // 也为额外目标添加高亮效果
                additionalTarget.classList.add('toc-target-highlight');
              setTimeout(() => {
                  additionalTarget.classList.remove('toc-target-highlight');
                }, 3000);
            }
          }
        }
      };

        li.appendChild(link);

        // 如果有子项，创建子项容器
        if (hasChildren) {
          const childrenContainer = document.createElement('ul');
          childrenContainer.className = 'toc-children';
          buildTocHtml(item.children, childrenContainer);
          li.appendChild(childrenContainer);

          // 为折叠按钮添加点击事件，确保事件正确处理
          const toggleBtn = li.querySelector('.toc-toggle');
          if (toggleBtn) {
            // 移除现有的事件监听器（如果有）
            toggleBtn.replaceWith(toggleBtn.cloneNode(true));

            // 重新获取按钮并添加事件
            const newToggleBtn = li.querySelector('.toc-toggle');
            newToggleBtn.addEventListener('click', function(e) {
              e.stopPropagation(); // 阻止事件冒泡
              e.preventDefault(); // 防止链接被点击

              // 获取子项容器
              const childContainer = this.closest('li').querySelector('.toc-children');
              if (childContainer) {
                toggleTocItem(this, childContainer);
              }
            });
          }
        }

        parentElement.appendChild(li);
      });
    }

    // 构建TOC HTML
    buildTocHtml(tocStructure.children, tocList);

    window.getCurrentTocStructure = function() {
      return tocStructure;
    };

    // Expose getTocNodes to window
    window.getTocNodes = function() {
      return tocNodes;
    };
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

  // 展开/收起TOC的功能
  document.getElementById('toc-expand-btn').addEventListener('click', function() {
    const isExpanded = tocPopup.classList.contains('toc-expanded');
    const icon = this.querySelector('i');
    if (isExpanded) {
      tocPopup.classList.remove('toc-expanded');
      icon.classList.remove('fa-angles-left');
      icon.classList.add('fa-angles-right');
      this.title = '展开目录';
    } else {
      tocPopup.classList.add('toc-expanded');
      icon.classList.remove('fa-angles-right');
      icon.classList.add('fa-angles-left');
      this.title = '收起目录';
    }
  });

  // 全部展开功能
  document.getElementById('toc-expand-all').addEventListener('click', function() {
    const allToggleButtons = tocList.querySelectorAll('.toc-toggle.collapsed');
    allToggleButtons.forEach(btn => {
      const childrenContainer = btn.closest('li').querySelector('.toc-children');
      if (childrenContainer) {
        toggleTocItem(btn, childrenContainer);
      }
    });
  });

  // 全部折叠功能
  document.getElementById('toc-collapse-all').addEventListener('click', function() {
    const allToggleButtons = tocList.querySelectorAll('.toc-toggle:not(.collapsed)');
    allToggleButtons.forEach(btn => {
      const childrenContainer = btn.closest('li').querySelector('.toc-children');
      if (childrenContainer) {
        toggleTocItem(btn, childrenContainer);
      }
    });
  });

  // 目前的结构中，TocFeature 是一个IIFE，它会立即执行。
  // 它将 refreshTocList 函数暴露到 window 对象。
  // 在 history_detail.html 中，showTab 函数会调用 window.refreshTocList()。
  // 因此，只要 toc_logic.js 在调用 showTab 的主脚本之前加载，这个设置就应该能工作。
})();

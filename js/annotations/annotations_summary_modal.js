const annotationsSummaryModal = document.getElementById('annotations-summary-modal');
const annotationsSummaryCloseBtn = document.getElementById('annotations-summary-close-btn');
const annotationsFilterTypeSelect = document.getElementById('annotations-filter-type');
const annotationsFilterContentSelect = document.getElementById('annotations-filter-content');
const annotationsSummaryTableBody = document.getElementById('annotations-summary-table-body');
const annotationsSummaryColorFilter = document.getElementById('annotations-summary-color-filter');

// 获取所有出现过的高亮颜色
function getAllHighlightColors() {
  if (!window.data || !window.data.annotations) return [];
  const colorSet = new Set();
  window.data.annotations.forEach(ann => {
    if (ann.highlightColor) colorSet.add(ann.highlightColor);
  });
  return Array.from(colorSet);
}

// 渲染颜色多选区
function renderColorFilter(selectedColors) {
  const allColors = getAllHighlightColors();
  annotationsSummaryColorFilter.innerHTML = '';
  if (allColors.length === 0) return;
  allColors.forEach(color => {
    const label = document.createElement('label');
    label.className = 'annotations-summary-color-checkbox';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = color;
    checkbox.checked = selectedColors.includes(color);
    checkbox.addEventListener('change', () => {
      // 重新渲染表格
      const checkedColors = Array.from(annotationsSummaryColorFilter.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
      populateAnnotationsSummaryTable(
        annotationsFilterTypeSelect.value,
        annotationsFilterContentSelect.value,
        checkedColors
      );
    });
    const swatch = document.createElement('span');
    swatch.className = 'annotations-summary-color-swatch';
    swatch.style.backgroundColor = typeof getHighlightColor === 'function' ? getHighlightColor(color) : color;
    label.appendChild(checkbox);
    label.appendChild(swatch);
    label.appendChild(document.createTextNode(' '));
    annotationsSummaryColorFilter.appendChild(label);
  });
}

// 主表格渲染函数，增加颜色筛选参数
function populateAnnotationsSummaryTable(typeFilter = 'all', contentFilter = 'all', colorFilter = null) {
  console.log('[调试] populateAnnotationsSummaryTable called, data:', window.data, 'tocStructure:', (typeof window.getCurrentTocStructure === 'function') ? window.getCurrentTocStructure() : null);

  if (!window.data || !window.data.annotations || !annotationsSummaryTableBody) {
    annotationsSummaryTableBody.innerHTML = '<tr><td colspan="7">暂无数据或批注未加载。</td></tr>';
    return;
  }

  // 默认全选所有颜色
  let allColors = getAllHighlightColors();
  if (!colorFilter) colorFilter = allColors;
  renderColorFilter(colorFilter);

  // 清空表格内容，防止重复
  annotationsSummaryTableBody.innerHTML = '';

  // 对批注数据进行去重处理
  // 创建一个 Map 用于检测重复的批注
  const uniqueAnnotations = new Map();

  // 遍历所有批注，按照目标标识符和内容类型进行去重
  window.data.annotations.forEach(ann => {
    // 获取批注的唯一标识
    let targetSelector = ann.target && ann.target.selector && ann.target.selector[0];
    let uniqueKey = '';

    if (targetSelector) {
      // 使用 subBlockId 或 blockIndex 作为唯一标识的一部分
      if (targetSelector.subBlockId) {
        uniqueKey = `${ann.targetType}_subBlock_${targetSelector.subBlockId}`;
      } else if (targetSelector.blockIndex !== undefined) {
        uniqueKey = `${ann.targetType}_block_${targetSelector.blockIndex}`;
      }
    }

    // 如果有有效的唯一标识，则添加到 Map 中
    if (uniqueKey) {
      // 如果是相同位置的批注，保留最新的（假设 id 越大越新）
      if (!uniqueAnnotations.has(uniqueKey) ||
          (ann.id && uniqueAnnotations.get(uniqueKey).id && ann.id > uniqueAnnotations.get(uniqueKey).id)) {
        uniqueAnnotations.set(uniqueKey, ann);
      }
    } else {
      // 对于没有有效唯一标识的批注，使用 id 作为键
      uniqueAnnotations.set(ann.id || _page_generateUUID(), ann);
    }
  });

  // 将去重后的批注转换为数组并应用筛选条件
  const filteredAnnotations = Array.from(uniqueAnnotations.values()).filter(ann => {
    const typeMatch = typeFilter === 'all' || ann.motivation === typeFilter;
    const contentMatch = contentFilter === 'all' || ann.targetType === contentFilter;
    const colorMatch = !ann.highlightColor || colorFilter.includes(ann.highlightColor);
    return typeMatch && contentMatch && colorMatch;
  });

  // 按照位置排序（先按内容类型，再按块索引或子块ID）
  filteredAnnotations.sort((a, b) => {
    // 先按内容类型排序
    if (a.targetType !== b.targetType) {
      return a.targetType === 'ocr' ? -1 : 1;
    }

    // 再按块索引或子块ID排序
    const aSel = a.target && a.target.selector && a.target.selector[0];
    const bSel = b.target && b.target.selector && b.target.selector[0];

    if (aSel && bSel) {
      // 如果都有 blockIndex，按 blockIndex 排序
      if (aSel.blockIndex !== undefined && bSel.blockIndex !== undefined) {
        return aSel.blockIndex - bSel.blockIndex;
      }

      // 如果都有 subBlockId，按 subBlockId 排序
      if (aSel.subBlockId && bSel.subBlockId) {
        const aIds = aSel.subBlockId.split('.');
        const bIds = bSel.subBlockId.split('.');

        // 先比较主块索引
        const aMainBlock = parseInt(aIds[0]);
        const bMainBlock = parseInt(bIds[0]);
        if (aMainBlock !== bMainBlock) {
          return aMainBlock - bMainBlock;
        }

        // 再比较子块索引
        if (aIds.length > 1 && bIds.length > 1) {
          return parseInt(aIds[1]) - parseInt(bIds[1]);
        }
      }
    }

    // 默认按 id 排序（如果有）
    return (a.id || '') < (b.id || '') ? -1 : 1;
  });

  // ========== TOC 分组渲染 ===========
  let tocStructure = (typeof window.getCurrentTocStructure === 'function') ? window.getCurrentTocStructure() : null;
  let grouped = {};
  let ungrouped = [];
  // 辅助：递归查找批注属于哪个 TOC 节点，并返回完整路径
  function findTocPathForAnnotation(tocNodes, blockIndex, subBlockId, path = []) {
    let found = null;
    for (let node of tocNodes) {
      // 判断 blockIndex 是否在本节点范围内
      let inRange = false;
      if (blockIndex !== null && node.startBlockIndex !== undefined) {
        if (node.endBlockIndex !== null && node.endBlockIndex !== undefined) {
          inRange = blockIndex >= node.startBlockIndex && blockIndex <= node.endBlockIndex;
        } else {
          inRange = blockIndex >= node.startBlockIndex;
        }
      }
      // 判断 subBlockId 是否属于本节点（可扩展）
      // 这里只做 blockIndex 匹配，subBlockId 可按需扩展
      if (inRange) {
        // 递归查找更小的子节点
        let childFound = null;
        if (node.children && node.children.length > 0) {
          childFound = findTocPathForAnnotation(node.children, blockIndex, subBlockId, path.concat([node]));
        }
        if (childFound) return childFound;
        return path.concat([node]);
      }
    }
    return null;
  }
  if (tocStructure && tocStructure.children && tocStructure.children.length > 0) {
    console.log('[批注分组] TOC结构节点数:', tocStructure.children.length);
    filteredAnnotations.forEach(ann => {
      let targetSelector = ann.target && ann.target.selector && ann.target.selector[0];
      let blockIndex = targetSelector && targetSelector.blockIndex !== undefined ? parseInt(targetSelector.blockIndex, 10) : null;
      let subBlockId = targetSelector && targetSelector.subBlockId ? String(targetSelector.subBlockId) : null;
      // 新增：如果 blockIndex 为空但 subBlockId 存在，自动用 subBlockId 的前半部分
      if (blockIndex === null && subBlockId) {
        const parts = subBlockId.split('.');
        if (parts.length > 0 && !isNaN(parseInt(parts[0], 10))) {
          blockIndex = parseInt(parts[0], 10);
        }
      }
      let tocPath = findTocPathForAnnotation(tocStructure.children, blockIndex, subBlockId);
      if (tocPath && tocPath.length > 0) {
        let groupKey = tocPath.map(n => n.text).join(' > ');
        if (!grouped[groupKey]) grouped[groupKey] = { path: tocPath, items: [] };
        grouped[groupKey].items.push(ann);
        console.log(`[批注分组] blockIndex: ${blockIndex}, subBlockId: ${subBlockId}, 分组到: ${groupKey}`);
      } else {
        ungrouped.push(ann);
        console.log(`[批注分组] blockIndex: ${blockIndex}, subBlockId: ${subBlockId}, 未分组`);
      }
    });
  } else {
    ungrouped = filteredAnnotations;
  }
  // ========== 渲染分组 ===========
  let groupCount = 0;
  for (let key in grouped) {
    if (!grouped[key].items.length) continue;
    groupCount += grouped[key].items.length;
    const groupRow = document.createElement('tr');
    groupRow.className = 'toc-group';
    groupRow.innerHTML = `<td colspan="7">${key}（${grouped[key].items.length}）</td>`;
    annotationsSummaryTableBody.appendChild(groupRow);
    grouped[key].items.forEach(ann => {
      const row = annotationsSummaryTableBody.insertRow();
      row.insertCell().textContent = ann.motivation === 'commenting' ? '批注' : (ann.motivation === 'highlighting' ? '高亮' : ann.motivation);
      row.insertCell().textContent = ann.targetType ? ann.targetType.toUpperCase() : 'N/A';

      let identifierText = 'N/A';
      let targetSelector = ann.target && ann.target.selector && ann.target.selector[0];
      if (targetSelector) {
        if (targetSelector.subBlockId) {
          identifierText = `子块: ${targetSelector.subBlockId}`;
        } else if (targetSelector.blockIndex !== undefined) {
          identifierText = `块: ${targetSelector.blockIndex}`;
        }
      }
      row.insertCell().textContent = identifierText;

      // 增强文本片段预览
      const textCell = row.insertCell();
      let textSnippet = '[无文本片段]';

      // 尝试获取更丰富的文本片段
      if (targetSelector) {
        // 1. 优先显示 exact
        if (targetSelector.exact) {
          textSnippet = targetSelector.exact;
        }
        // 2. 没有 exact，再考虑唯一子块显示父块内容
        else if (targetSelector.subBlockId) {
          const parts = targetSelector.subBlockId.split('.');
          if (parts.length === 2) {
            const parentBlockIndex = parseInt(parts[0], 10);
            // 统计 annotation 里所有属于该父块的唯一子块
            const allSubBlockIds = window.data.annotations
              .map(a => a.target && a.target.selector && a.target.selector[0] && a.target.selector[0].subBlockId)
              .filter(id => id && id.startsWith(`${parentBlockIndex}.`));
            const uniqueSubBlockIds = Array.from(new Set(allSubBlockIds));
            if (uniqueSubBlockIds.length === 1 &&
                window.currentBlockTokensForCopy &&
                window.currentBlockTokensForCopy[ann.targetType] &&
                window.currentBlockTokensForCopy[ann.targetType][parentBlockIndex] &&
                typeof window.currentBlockTokensForCopy[ann.targetType][parentBlockIndex].raw === 'string') {
              textSnippet = window.currentBlockTokensForCopy[ann.targetType][parentBlockIndex].raw;
            }
          }
        }
        // 3. 块级批注
        else if (targetSelector.blockIndex !== undefined && !targetSelector.subBlockId) {
          const blockIndex = parseInt(targetSelector.blockIndex, 10);
          if (!isNaN(blockIndex) &&
              window.currentBlockTokensForCopy &&
              window.currentBlockTokensForCopy[ann.targetType] &&
              window.currentBlockTokensForCopy[ann.targetType][blockIndex] &&
              typeof window.currentBlockTokensForCopy[ann.targetType][blockIndex].raw === 'string') {
            textSnippet = window.currentBlockTokensForCopy[ann.targetType][blockIndex].raw;
          }
        }
      }

      // 限制显示长度，但保留更多内容
      if (textSnippet && textSnippet.length > 150) {
        textCell.textContent = textSnippet.substring(0, 150) + '...';
        textCell.title = textSnippet; // 鼠标悬停时显示完整内容
      } else {
        textCell.textContent = textSnippet || '[无文本片段]';
      }

      // 添加查看完整内容的功能
      if (textSnippet && textSnippet.length > 50) {
        textCell.style.cursor = 'pointer';
        textCell.addEventListener('click', function() {
          const fullTextDialog = document.createElement('div');
          fullTextDialog.className = 'full-text-dialog';
          fullTextDialog.style.position = 'fixed';
          fullTextDialog.style.top = '50%';
          fullTextDialog.style.left = '50%';
          fullTextDialog.style.transform = 'translate(-50%, -50%)';
          fullTextDialog.style.maxWidth = '80%';
          fullTextDialog.style.maxHeight = '80%';
          fullTextDialog.style.backgroundColor = 'white';
          fullTextDialog.style.padding = '20px';
          fullTextDialog.style.borderRadius = '8px';
          fullTextDialog.style.boxShadow = '0 0 20px rgba(0,0,0,0.3)';
          fullTextDialog.style.zIndex = '10000';
          fullTextDialog.style.overflow = 'auto';

          const closeBtn = document.createElement('button');
          closeBtn.textContent = '关闭';
          closeBtn.style.position = 'absolute';
          closeBtn.style.top = '10px';
          closeBtn.style.right = '10px';
          closeBtn.style.padding = '5px 10px';
          closeBtn.style.cursor = 'pointer';

          const content = document.createElement('pre');
          content.style.whiteSpace = 'pre-wrap';
          content.style.wordBreak = 'break-word';
          content.style.margin = '10px 0';
          content.style.padding = '10px';
          content.style.backgroundColor = '#f5f5f5';
          content.style.border = '1px solid #ddd';
          content.style.borderRadius = '4px';
          content.textContent = textSnippet;

          fullTextDialog.appendChild(closeBtn);
          fullTextDialog.appendChild(content);
          document.body.appendChild(fullTextDialog);

          closeBtn.onclick = function() {
            if (fullTextDialog.parentNode === document.body) {
              document.body.removeChild(fullTextDialog);
            }
          };

          // 点击对话框外部关闭
          document.addEventListener('click', function closeDialog(e) {
            if (!fullTextDialog.contains(e.target) && e.target !== textCell) {
              // 添加检查确保对话框仍然存在于文档中
              if (fullTextDialog.parentNode === document.body) {
                document.body.removeChild(fullTextDialog);
              }
              document.removeEventListener('click', closeDialog);
            }
          });
        });
      }

      // ======= 可编辑笔记列 =======
      const noteCell = row.insertCell();
      const noteText = ann.body && ann.body.length > 0 && ann.body[0].value ? ann.body[0].value : '';
      noteCell.textContent = noteText;
      // 带批注类型 或 仅高亮类型都可编辑/添加
      if (ann.motivation === 'commenting' || ann.motivation === 'highlighting') {
        noteCell.style.cursor = 'pointer';
        noteCell.title = noteText ? '点击编辑批注' : '点击添加批注';
        if (!noteText && ann.motivation === 'highlighting') {
          noteCell.style.color = '#aaa';
          noteCell.textContent = '点击添加批注';
        }
        noteCell.addEventListener('click', function onEditNoteCell(e) {
          if (noteCell.querySelector('textarea')) return; // 已经在编辑
          const textarea = document.createElement('textarea');
          textarea.value = noteText;
          textarea.style.width = '98%';
          textarea.style.minHeight = '40px';
          textarea.style.fontSize = '13px';
          textarea.style.fontFamily = 'inherit';
          textarea.style.resize = 'vertical';
          textarea.autofocus = true;
          noteCell.innerHTML = '';
          noteCell.appendChild(textarea);
          textarea.focus();
          // 保存函数
          const saveNote = async () => {
            const newVal = textarea.value.trim();
            if (newVal === noteText || (!newVal && !noteText)) {
              noteCell.textContent = noteText || '点击添加批注';
              if (!noteText && ann.motivation === 'highlighting') noteCell.style.color = '#aaa';
              return;
            }
            if (!newVal) {
              noteCell.textContent = '内容不能为空';
              setTimeout(() => { noteCell.textContent = noteText || '点击添加批注'; if (!noteText && ann.motivation === 'highlighting') noteCell.style.color = '#aaa'; }, 1200);
              return;
            }
            noteCell.textContent = '保存中...';
            try {
              ann.body = [{ type: 'TextualBody', value: newVal, format: 'text/plain', purpose: 'commenting' }];
              ann.modified = new Date().toISOString();
              ann.motivation = 'commenting'; // 升级为批注

              // 检查 updateAnnotationInDB 函数是否可用
              if (typeof updateAnnotationInDB !== 'function') {
                console.error('updateAnnotationInDB 函数未定义，请确保 storage.js 已正确加载');
                throw new Error('保存批注的函数未定义');
              }

              await updateAnnotationInDB(ann);
              // 更新window.data.annotations
              const idx = window.data.annotations.findIndex(a => a.id === ann.id);
              if (idx > -1) window.data.annotations[idx] = { ...ann };
              // 刷新表格，保持筛选
              const checkedColors = Array.from(annotationsSummaryColorFilter.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
              populateAnnotationsSummaryTable(annotationsFilterTypeSelect.value, annotationsFilterContentSelect.value, checkedColors);
            } catch (err) {
              console.error('保存批注失败:', err);
              noteCell.textContent = '[保存失败]';
              setTimeout(() => { noteCell.textContent = noteText || '点击添加批注'; if (!noteText && ann.motivation === 'highlighting') noteCell.style.color = '#aaa'; }, 1500);
            }
          };
          textarea.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              saveNote();
            } else if (e.key === 'Escape') {
              noteCell.textContent = noteText || '点击添加批注';
              if (!noteText && ann.motivation === 'highlighting') noteCell.style.color = '#aaa';
            }
          });
          textarea.addEventListener('blur', saveNote);
        });
      }

      // ======= 可编辑颜色列 =======
      const colorCell = row.insertCell();
      if (ann.highlightColor) {
        const swatch = document.createElement('span');
        swatch.className = 'color-swatch';
        swatch.style.backgroundColor = typeof getHighlightColor === 'function' ? getHighlightColor(ann.highlightColor) : ann.highlightColor;
        swatch.style.cursor = 'pointer';
        swatch.title = '点击更改高亮颜色';
        colorCell.appendChild(swatch);
        // 点击弹出下拉
        swatch.addEventListener('click', function onEditColor(e) {
          if (colorCell.querySelector('select')) return;
          // 颜色选项：常用色+所有已用色
          const commonColors = ['yellow','pink','lightblue','lightgreen','purple','orange','red','cyan','blue','green'];
          const allColors = Array.from(new Set([...commonColors, ...getAllHighlightColors()]));
          const select = document.createElement('select');
          select.style.marginLeft = '6px';
          allColors.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c;
            opt.textContent = c;
            opt.style.backgroundColor = typeof getHighlightColor === 'function' ? getHighlightColor(c) : c;
            if (c === ann.highlightColor) opt.selected = true;
            select.appendChild(opt);
          });
          colorCell.appendChild(select);
          select.focus();
          // 保存颜色
          const saveColor = async () => {
            const newColor = select.value;
            if (newColor === ann.highlightColor) {
              colorCell.innerHTML = '';
              colorCell.appendChild(swatch);
              return;
            }
            colorCell.textContent = '保存中...';
            try {
              ann.highlightColor = newColor;
              ann.modified = new Date().toISOString();
              if (ann.motivation !== 'commenting') ann.motivation = 'highlighting';

              // 检查 updateAnnotationInDB 函数是否可用
              if (typeof updateAnnotationInDB !== 'function') {
                console.error('updateAnnotationInDB 函数未定义，请确保 storage.js 已正确加载');
                throw new Error('保存批注颜色的函数未定义');
              }

              await updateAnnotationInDB(ann);
              // 更新window.data.annotations
              const idx = window.data.annotations.findIndex(a => a.id === ann.id);
              if (idx > -1) window.data.annotations[idx] = { ...ann };
              // 刷新表格，保持筛选
              const checkedColors = Array.from(annotationsSummaryColorFilter.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
              populateAnnotationsSummaryTable(annotationsFilterTypeSelect.value, annotationsFilterContentSelect.value, checkedColors);
            } catch (err) {
              console.error('保存批注颜色失败:', err);
              colorCell.textContent = '[保存失败]';
              setTimeout(() => { colorCell.innerHTML = ''; colorCell.appendChild(swatch); }, 1500);
            }
          };
          select.addEventListener('change', saveColor);
          select.addEventListener('blur', saveColor);
        });
      } else {
        colorCell.textContent = '-';
      }

      const actionsCell = row.insertCell();
      const jumpButton = document.createElement('button');
      jumpButton.textContent = '跳转';
      jumpButton.className = 'action-btn';
      jumpButton.dataset.annotationId = ann.id;
      jumpButton.dataset.targetType = ann.targetType;
      jumpButton.dataset.blockIndex = (targetSelector && targetSelector.blockIndex !== undefined) ? targetSelector.blockIndex : '';
      jumpButton.dataset.subBlockId = (targetSelector && targetSelector.subBlockId !== undefined) ? targetSelector.subBlockId : '';

      // Disable jump button if in chunk-compare mode, or no valid target
      if (window.currentVisibleTabId === 'chunk-compare' || (!targetSelector || (targetSelector.subBlockId === undefined && targetSelector.blockIndex === undefined))) {
          jumpButton.disabled = true;
          jumpButton.title = window.currentVisibleTabId === 'chunk-compare' ? '分块对比模式下禁用跳转' : '无有效跳转目标';
      }


      jumpButton.onclick = async function() {
        closeAnnotationsSummaryModal(); // Close modal before jumping

        const targetType = this.dataset.targetType;
        const blockIndex = this.dataset.blockIndex;
        const subBlockId = this.dataset.subBlockId;

        if (!targetType || (subBlockId === '' && blockIndex === '')) {
          alert('无效的跳转目标。');
          return;
        }

        // Switch tab if necessary
        if (window.currentVisibleTabId !== targetType && window.currentVisibleTabId !== `${targetType}-content-wrapper`) { // Check against common tab ID patterns
          if (typeof showTab === 'function') {
            console.log(`Switching to tab: ${targetType} for jump action.`);
            await Promise.resolve(showTab(targetType)); // Ensure tab switch completes
             // Wait a brief moment for DOM updates after tab switch, if showTab involves async rendering.
            await new Promise(resolve => setTimeout(resolve, 200));
          } else {
            alert('无法切换标签页。');
            return;
          }
        }


        let elementToJump = null;
        const contentWrapperId = `${targetType}-content-wrapper`; // e.g., ocr-content-wrapper
        const contentWrapper = document.getElementById(contentWrapperId);

        if (!contentWrapper) {
          console.error(`Content wrapper ${contentWrapperId} not found.`);
          alert(`无法找到内容区域 ${contentWrapperId} 以进行跳转。`);
          return;
        }

        if (subBlockId && subBlockId !== 'undefined' && subBlockId !== '') {
          elementToJump = contentWrapper.querySelector(`.sub-block[data-sub-block-id="${subBlockId}"]`);
        } else if (blockIndex !== '') {
          // 直接查找块级元素
          elementToJump = contentWrapper.querySelector(`[data-block-index="${blockIndex}"]`);
        }

        if (elementToJump) {
          elementToJump.scrollIntoView({ behavior: 'smooth', block: 'center' });
          elementToJump.classList.add('jump-to-highlight-effect');
          setTimeout(() => {
            elementToJump.classList.remove('jump-to-highlight-effect');
          }, 2500); // Keep highlight for 2.5 seconds
        } else {
          alert('在当前视图中未找到目标元素。它可能已被过滤或不存在。');
          console.warn('Element not found for jump:', {targetType, blockIndex, subBlockId});
        }
      };
      actionsCell.appendChild(jumpButton);
    });
  }
  if (ungrouped.length) {
    const groupRow = document.createElement('tr');
    groupRow.className = 'toc-group';
    groupRow.innerHTML = `<td colspan="7">未分组（${ungrouped.length}）</td>`;
    annotationsSummaryTableBody.appendChild(groupRow);
    ungrouped.forEach(ann => {
      const row = annotationsSummaryTableBody.insertRow();
      row.insertCell().textContent = ann.motivation === 'commenting' ? '批注' : (ann.motivation === 'highlighting' ? '高亮' : ann.motivation);
      row.insertCell().textContent = ann.targetType ? ann.targetType.toUpperCase() : 'N/A';

      let identifierText = 'N/A';
      let targetSelector = ann.target && ann.target.selector && ann.target.selector[0];
      if (targetSelector) {
        if (targetSelector.subBlockId) {
          identifierText = `子块: ${targetSelector.subBlockId}`;
        } else if (targetSelector.blockIndex !== undefined) {
          identifierText = `块: ${targetSelector.blockIndex}`;
        }
      }
      row.insertCell().textContent = identifierText;

      // 增强文本片段预览
      const textCell = row.insertCell();
      let textSnippet = '[无文本片段]';

      // 尝试获取更丰富的文本片段
      if (targetSelector) {
        // 1. 优先显示 exact
        if (targetSelector.exact) {
          textSnippet = targetSelector.exact;
        }
        // 2. 没有 exact，再考虑唯一子块显示父块内容
        else if (targetSelector.subBlockId) {
          const parts = targetSelector.subBlockId.split('.');
          if (parts.length === 2) {
            const parentBlockIndex = parseInt(parts[0], 10);
            // 统计 annotation 里所有属于该父块的唯一子块
            const allSubBlockIds = window.data.annotations
              .map(a => a.target && a.target.selector && a.target.selector[0] && a.target.selector[0].subBlockId)
              .filter(id => id && id.startsWith(`${parentBlockIndex}.`));
            const uniqueSubBlockIds = Array.from(new Set(allSubBlockIds));
            if (uniqueSubBlockIds.length === 1 &&
                window.currentBlockTokensForCopy &&
                window.currentBlockTokensForCopy[ann.targetType] &&
                window.currentBlockTokensForCopy[ann.targetType][parentBlockIndex] &&
                typeof window.currentBlockTokensForCopy[ann.targetType][parentBlockIndex].raw === 'string') {
              textSnippet = window.currentBlockTokensForCopy[ann.targetType][parentBlockIndex].raw;
            }
          }
        }
        // 3. 块级批注
        else if (targetSelector.blockIndex !== undefined && !targetSelector.subBlockId) {
          const blockIndex = parseInt(targetSelector.blockIndex, 10);
          if (!isNaN(blockIndex) &&
              window.currentBlockTokensForCopy &&
              window.currentBlockTokensForCopy[ann.targetType] &&
              window.currentBlockTokensForCopy[ann.targetType][blockIndex] &&
              typeof window.currentBlockTokensForCopy[ann.targetType][blockIndex].raw === 'string') {
            textSnippet = window.currentBlockTokensForCopy[ann.targetType][blockIndex].raw;
          }
        }
      }

      // 限制显示长度，但保留更多内容
      if (textSnippet && textSnippet.length > 150) {
        textCell.textContent = textSnippet.substring(0, 150) + '...';
        textCell.title = textSnippet; // 鼠标悬停时显示完整内容
      } else {
        textCell.textContent = textSnippet || '[无文本片段]';
      }

      // 添加查看完整内容的功能
      if (textSnippet && textSnippet.length > 50) {
        textCell.style.cursor = 'pointer';
        textCell.addEventListener('click', function() {
          const fullTextDialog = document.createElement('div');
          fullTextDialog.className = 'full-text-dialog';
          fullTextDialog.style.position = 'fixed';
          fullTextDialog.style.top = '50%';
          fullTextDialog.style.left = '50%';
          fullTextDialog.style.transform = 'translate(-50%, -50%)';
          fullTextDialog.style.maxWidth = '80%';
          fullTextDialog.style.maxHeight = '80%';
          fullTextDialog.style.backgroundColor = 'white';
          fullTextDialog.style.padding = '20px';
          fullTextDialog.style.borderRadius = '8px';
          fullTextDialog.style.boxShadow = '0 0 20px rgba(0,0,0,0.3)';
          fullTextDialog.style.zIndex = '10000';
          fullTextDialog.style.overflow = 'auto';

          const closeBtn = document.createElement('button');
          closeBtn.textContent = '关闭';
          closeBtn.style.position = 'absolute';
          closeBtn.style.top = '10px';
          closeBtn.style.right = '10px';
          closeBtn.style.padding = '5px 10px';
          closeBtn.style.cursor = 'pointer';

          const content = document.createElement('pre');
          content.style.whiteSpace = 'pre-wrap';
          content.style.wordBreak = 'break-word';
          content.style.margin = '10px 0';
          content.style.padding = '10px';
          content.style.backgroundColor = '#f5f5f5';
          content.style.border = '1px solid #ddd';
          content.style.borderRadius = '4px';
          content.textContent = textSnippet;

          fullTextDialog.appendChild(closeBtn);
          fullTextDialog.appendChild(content);
          document.body.appendChild(fullTextDialog);

          closeBtn.onclick = function() {
            if (fullTextDialog.parentNode === document.body) {
              document.body.removeChild(fullTextDialog);
            }
          };

          // 点击对话框外部关闭
          document.addEventListener('click', function closeDialog(e) {
            if (!fullTextDialog.contains(e.target) && e.target !== textCell) {
              // 添加检查确保对话框仍然存在于文档中
              if (fullTextDialog.parentNode === document.body) {
                document.body.removeChild(fullTextDialog);
              }
              document.removeEventListener('click', closeDialog);
            }
          });
        });
      }

      // ======= 可编辑笔记列 =======
      const noteCell = row.insertCell();
      const noteText = ann.body && ann.body.length > 0 && ann.body[0].value ? ann.body[0].value : '';
      noteCell.textContent = noteText;
      // 带批注类型 或 仅高亮类型都可编辑/添加
      if (ann.motivation === 'commenting' || ann.motivation === 'highlighting') {
        noteCell.style.cursor = 'pointer';
        noteCell.title = noteText ? '点击编辑批注' : '点击添加批注';
        if (!noteText && ann.motivation === 'highlighting') {
          noteCell.style.color = '#aaa';
          noteCell.textContent = '点击添加批注';
        }
        noteCell.addEventListener('click', function onEditNoteCell(e) {
          if (noteCell.querySelector('textarea')) return; // 已经在编辑
          const textarea = document.createElement('textarea');
          textarea.value = noteText;
          textarea.style.width = '98%';
          textarea.style.minHeight = '40px';
          textarea.style.fontSize = '13px';
          textarea.style.fontFamily = 'inherit';
          textarea.style.resize = 'vertical';
          textarea.autofocus = true;
          noteCell.innerHTML = '';
          noteCell.appendChild(textarea);
          textarea.focus();
          // 保存函数
          const saveNote = async () => {
            const newVal = textarea.value.trim();
            if (newVal === noteText || (!newVal && !noteText)) {
              noteCell.textContent = noteText || '点击添加批注';
              if (!noteText && ann.motivation === 'highlighting') noteCell.style.color = '#aaa';
              return;
            }
            if (!newVal) {
              noteCell.textContent = '内容不能为空';
              setTimeout(() => { noteCell.textContent = noteText || '点击添加批注'; if (!noteText && ann.motivation === 'highlighting') noteCell.style.color = '#aaa'; }, 1200);
              return;
            }
            noteCell.textContent = '保存中...';
            try {
              ann.body = [{ type: 'TextualBody', value: newVal, format: 'text/plain', purpose: 'commenting' }];
              ann.modified = new Date().toISOString();
              ann.motivation = 'commenting'; // 升级为批注

              // 检查 updateAnnotationInDB 函数是否可用
              if (typeof updateAnnotationInDB !== 'function') {
                console.error('updateAnnotationInDB 函数未定义，请确保 storage.js 已正确加载');
                throw new Error('保存批注的函数未定义');
              }

              await updateAnnotationInDB(ann);
              // 更新window.data.annotations
              const idx = window.data.annotations.findIndex(a => a.id === ann.id);
              if (idx > -1) window.data.annotations[idx] = { ...ann };
              // 刷新表格，保持筛选
              const checkedColors = Array.from(annotationsSummaryColorFilter.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
              populateAnnotationsSummaryTable(annotationsFilterTypeSelect.value, annotationsFilterContentSelect.value, checkedColors);
            } catch (err) {
              console.error('保存批注失败:', err);
              noteCell.textContent = '[保存失败]';
              setTimeout(() => { noteCell.textContent = noteText || '点击添加批注'; if (!noteText && ann.motivation === 'highlighting') noteCell.style.color = '#aaa'; }, 1500);
            }
          };
          textarea.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              saveNote();
            } else if (e.key === 'Escape') {
              noteCell.textContent = noteText || '点击添加批注';
              if (!noteText && ann.motivation === 'highlighting') noteCell.style.color = '#aaa';
            }
          });
          textarea.addEventListener('blur', saveNote);
        });
      }

      // ======= 可编辑颜色列 =======
      const colorCell = row.insertCell();
      if (ann.highlightColor) {
        const swatch = document.createElement('span');
        swatch.className = 'color-swatch';
        swatch.style.backgroundColor = typeof getHighlightColor === 'function' ? getHighlightColor(ann.highlightColor) : ann.highlightColor;
        swatch.style.cursor = 'pointer';
        swatch.title = '点击更改高亮颜色';
        colorCell.appendChild(swatch);
        // 点击弹出下拉
        swatch.addEventListener('click', function onEditColor(e) {
          if (colorCell.querySelector('select')) return;
          // 颜色选项：常用色+所有已用色
          const commonColors = ['yellow','pink','lightblue','lightgreen','purple','orange','red','cyan','blue','green'];
          const allColors = Array.from(new Set([...commonColors, ...getAllHighlightColors()]));
          const select = document.createElement('select');
          select.style.marginLeft = '6px';
          allColors.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c;
            opt.textContent = c;
            opt.style.backgroundColor = typeof getHighlightColor === 'function' ? getHighlightColor(c) : c;
            if (c === ann.highlightColor) opt.selected = true;
            select.appendChild(opt);
          });
          colorCell.appendChild(select);
          select.focus();
          // 保存颜色
          const saveColor = async () => {
            const newColor = select.value;
            if (newColor === ann.highlightColor) {
              colorCell.innerHTML = '';
              colorCell.appendChild(swatch);
              return;
            }
            colorCell.textContent = '保存中...';
            try {
              ann.highlightColor = newColor;
              ann.modified = new Date().toISOString();
              if (ann.motivation !== 'commenting') ann.motivation = 'highlighting';

              // 检查 updateAnnotationInDB 函数是否可用
              if (typeof updateAnnotationInDB !== 'function') {
                console.error('updateAnnotationInDB 函数未定义，请确保 storage.js 已正确加载');
                throw new Error('保存批注颜色的函数未定义');
              }

              await updateAnnotationInDB(ann);
              // 更新window.data.annotations
              const idx = window.data.annotations.findIndex(a => a.id === ann.id);
              if (idx > -1) window.data.annotations[idx] = { ...ann };
              // 刷新表格，保持筛选
              const checkedColors = Array.from(annotationsSummaryColorFilter.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
              populateAnnotationsSummaryTable(annotationsFilterTypeSelect.value, annotationsFilterContentSelect.value, checkedColors);
            } catch (err) {
              console.error('保存批注颜色失败:', err);
              colorCell.textContent = '[保存失败]';
              setTimeout(() => { colorCell.innerHTML = ''; colorCell.appendChild(swatch); }, 1500);
            }
          };
          select.addEventListener('change', saveColor);
          select.addEventListener('blur', saveColor);
        });
      } else {
        colorCell.textContent = '-';
      }

      const actionsCell = row.insertCell();
      const jumpButton = document.createElement('button');
      jumpButton.textContent = '跳转';
      jumpButton.className = 'action-btn';
      jumpButton.dataset.annotationId = ann.id;
      jumpButton.dataset.targetType = ann.targetType;
      jumpButton.dataset.blockIndex = (targetSelector && targetSelector.blockIndex !== undefined) ? targetSelector.blockIndex : '';
      jumpButton.dataset.subBlockId = (targetSelector && targetSelector.subBlockId !== undefined) ? targetSelector.subBlockId : '';

      // Disable jump button if in chunk-compare mode, or no valid target
      if (window.currentVisibleTabId === 'chunk-compare' || (!targetSelector || (targetSelector.subBlockId === undefined && targetSelector.blockIndex === undefined))) {
          jumpButton.disabled = true;
          jumpButton.title = window.currentVisibleTabId === 'chunk-compare' ? '分块对比模式下禁用跳转' : '无有效跳转目标';
      }


      jumpButton.onclick = async function() {
        closeAnnotationsSummaryModal(); // Close modal before jumping

        const targetType = this.dataset.targetType;
        const blockIndex = this.dataset.blockIndex;
        const subBlockId = this.dataset.subBlockId;

        if (!targetType || (subBlockId === '' && blockIndex === '')) {
          alert('无效的跳转目标。');
          return;
        }

        // Switch tab if necessary
        if (window.currentVisibleTabId !== targetType && window.currentVisibleTabId !== `${targetType}-content-wrapper`) { // Check against common tab ID patterns
          if (typeof showTab === 'function') {
            console.log(`Switching to tab: ${targetType} for jump action.`);
            await Promise.resolve(showTab(targetType)); // Ensure tab switch completes
             // Wait a brief moment for DOM updates after tab switch, if showTab involves async rendering.
            await new Promise(resolve => setTimeout(resolve, 200));
          } else {
            alert('无法切换标签页。');
            return;
          }
        }


        let elementToJump = null;
        const contentWrapperId = `${targetType}-content-wrapper`; // e.g., ocr-content-wrapper
        const contentWrapper = document.getElementById(contentWrapperId);

        if (!contentWrapper) {
          console.error(`Content wrapper ${contentWrapperId} not found.`);
          alert(`无法找到内容区域 ${contentWrapperId} 以进行跳转。`);
          return;
        }

        if (subBlockId && subBlockId !== 'undefined' && subBlockId !== '') {
          elementToJump = contentWrapper.querySelector(`.sub-block[data-sub-block-id="${subBlockId}"]`);
        } else if (blockIndex !== '') {
          // 直接查找块级元素
          elementToJump = contentWrapper.querySelector(`[data-block-index="${blockIndex}"]`);
        }

        if (elementToJump) {
          elementToJump.scrollIntoView({ behavior: 'smooth', block: 'center' });
          elementToJump.classList.add('jump-to-highlight-effect');
          setTimeout(() => {
            elementToJump.classList.remove('jump-to-highlight-effect');
          }, 2500); // Keep highlight for 2.5 seconds
        } else {
          alert('在当前视图中未找到目标元素。它可能已被过滤或不存在。');
          console.warn('Element not found for jump:', {targetType, blockIndex, subBlockId});
        }
      };
      actionsCell.appendChild(jumpButton);
    });
  }
  if (!groupCount && !ungrouped.length) {
    annotationsSummaryTableBody.innerHTML = '<tr><td colspan="7">没有符合筛选条件的批注或高亮。</td></tr>';
    return;
  }
}

window.openAnnotationsSummaryModal = function(filterByType = 'all', filterByContent = 'all') {
    if (!annotationsSummaryModal) return;

    // Set initial filter values from parameters
    annotationsFilterTypeSelect.value = filterByType;
    annotationsFilterContentSelect.value = filterByContent;

    // 默认全选所有颜色
    const allColors = getAllHighlightColors();
    populateAnnotationsSummaryTable(filterByType, filterByContent, allColors);
    annotationsSummaryModal.classList.add('visible');
};

function closeAnnotationsSummaryModal() {
    if (annotationsSummaryModal) {
        annotationsSummaryModal.classList.remove('visible');
    }
}

if (annotationsSummaryCloseBtn) {
    annotationsSummaryCloseBtn.onclick = closeAnnotationsSummaryModal;
}
if (annotationsSummaryModal) {
    annotationsSummaryModal.addEventListener('click', function(event) {
        if (event.target === annotationsSummaryModal) { // Click on overlay
            closeAnnotationsSummaryModal();
        }
    });
}
if (annotationsFilterTypeSelect && annotationsFilterContentSelect) {
    annotationsFilterTypeSelect.addEventListener('change', () => {
        // 颜色多选保持当前选中
        const checkedColors = Array.from(annotationsSummaryColorFilter.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
        populateAnnotationsSummaryTable(annotationsFilterTypeSelect.value, annotationsFilterContentSelect.value, checkedColors);
    });
    annotationsFilterContentSelect.addEventListener('change', () => {
        const checkedColors = Array.from(annotationsSummaryColorFilter.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
        populateAnnotationsSummaryTable(annotationsFilterTypeSelect.value, annotationsFilterContentSelect.value, checkedColors);
    });
}

// 存储上次看到的颜色集合，用于检测新颜色
let lastSeenColors = new Set();

// 定期检查是否有新颜色出现
function checkForNewColors() {
    const currentColors = new Set(getAllHighlightColors());

    // 找出新增的颜色
    const newColors = Array.from(currentColors).filter(color => !lastSeenColors.has(color));

    // 如果有新颜色且模态框当前可见
    if (newColors.length > 0 && annotationsSummaryModal && annotationsSummaryModal.classList.contains('visible')) {
        console.log('检测到新颜色:', newColors);

        // 获取当前已选中的颜色
        const currentlyCheckedColors = Array.from(
            annotationsSummaryColorFilter.querySelectorAll('input[type="checkbox"]:checked')
        ).map(cb => cb.value);

        // 合并当前选中的颜色和新颜色
        const updatedSelection = [...currentlyCheckedColors, ...newColors];

        // 重新渲染表格，确保新颜色被选中
        populateAnnotationsSummaryTable(
            annotationsFilterTypeSelect.value,
            annotationsFilterContentSelect.value,
            updatedSelection
        );
    }

    // 更新已知颜色集合
    lastSeenColors = currentColors;
}

// 初始化已知颜色集合
lastSeenColors = new Set(getAllHighlightColors());

// 每秒检查一次新颜色
setInterval(checkForNewColors, 1000);


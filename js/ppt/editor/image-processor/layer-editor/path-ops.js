/**
 * LayerEditor 路径操作模块
 * 从 layer-editor.js 拆分出的路径操作方法
 */

/**
 * 路径操作 mixin
 */
export const PathOpsMixin = {
    /**
     * 炸开子图层的路径为独立图层
     */
    _explodeChildPaths(parentLayer, childLayer) {
        console.log('[LayerEditor] 炸开路径:', { parentLayer, childLayer });
        
        if (!childLayer || !childLayer.svg) {
            console.warn('[LayerEditor] 无效的子图层或 SVG');
            return;
        }
        
        // 提取 SVG 的基础属性
        const widthMatch = childLayer.svg.match(/width="([^"]+)"/);
        const heightMatch = childLayer.svg.match(/height="([^"]+)"/);
        const viewBoxMatch = childLayer.svg.match(/viewBox="([^"]+)"/);
        
        const width = widthMatch ? widthMatch[1] : '100%';
        const height = heightMatch ? heightMatch[1] : '100%';
        const viewBox = viewBoxMatch ? viewBoxMatch[1] : '';
        
        // 提取所有 path 元素
        const pathRegex = /<path[^>]*(?:\/>|>[^<]*<\/path>)/g;
        const pathElements = childLayer.svg.match(pathRegex) || [];
        
        let paths = [];
        
        // 如果只有一个 path 元素，尝试拆分复合路径
        if (pathElements.length === 1) {
            const dMatch = pathElements[0].match(/\bd="([^"]+)"/);
            const fillMatch = pathElements[0].match(/fill="([^"]+)"/);
            const fill = fillMatch ? fillMatch[1] : childLayer.color || '#000000';
            
            if (dMatch) {
                const d = dMatch[1];
                const subPathRegex = /M[^M]+/gi;
                const subPaths = d.match(subPathRegex) || [];
                
                console.log('[LayerEditor] 检测到', subPaths.length, '个子路径');
                
                // 智能分组：将孔洞与其父形状保持在一起
                const groups = this._groupPathsByContainment(subPaths);
                console.log('[LayerEditor] 分组为', groups.length, '个独立形状');
                
                paths = groups.map(group => ({
                    d: group.join(' '),
                    fill: fill
                }));
            }
        } else {
            // 多个 path 元素，直接使用
            paths = pathElements.map(p => {
                const dMatch = p.match(/\bd="([^"]+)"/);
                const fillMatch = p.match(/fill="([^"]+)"/);
                return {
                    d: dMatch ? dMatch[1] : '',
                    fill: fillMatch ? fillMatch[1] : childLayer.color || '#000000',
                    original: p
                };
            });
        }
        
        console.log('[LayerEditor] 找到路径数量:', paths.length);
        
        if (paths.length <= 1) {
            alert(`只有 ${paths.length} 个路径，无需炸开`);
            return;
        }
        
        // 找到当前子图层在父级中的索引
        const childIndex = parentLayer.children.indexOf(childLayer);
        if (childIndex === -1) return;
        
        // 为每个路径创建新的子图层
        const newSubChildren = paths.map((pathObj, idx) => {
            const color = pathObj.fill || childLayer.color || '#000000';
            
            const pathElement = pathObj.original 
                ? pathObj.original 
                : `<path d="${pathObj.d}" fill="${color}"/>`;
            const newSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"${viewBox ? ` viewBox="${viewBox}"` : ''}>${pathElement}</svg>`;
            
            return {
                id: `${childLayer.id}_path_${idx}_${Date.now()}`,
                type: 'vector',
                name: `路径 ${idx + 1}`,
                color: color,
                svg: newSvg,
                visible: true
            };
        });
        
        // 创建新的子组来包裹炸开的路径
        const subGroup = {
            id: `${childLayer.id}_exploded_${Date.now()}`,
            type: 'subgroup',
            name: `炸开组 (${paths.length} 个)`,
            color: childLayer.color,
            children: newSubChildren,
            visible: true,
            expanded: true,
            vectorGroupId: parentLayer.id,
            parentId: parentLayer.id
        };
        
        // 替换原子图层为新的子组
        parentLayer.children.splice(childIndex, 1, subGroup);
        
        // 选中新的子组
        this.selectedChildIndex = childIndex;
        
        this._saveHistory();
        this._updateLayerList();
        this._updatePropertyPanel();
        this._render();
        
        console.log(`[LayerEditor] 已炸开 ${paths.length} 个路径为独立图层`);
    },

    /**
     * 设置路径选择功能
     */
    _setupPathSelection(childLayer) {
        const svgContainer = this.container.querySelector('.image-editor-svg-container');
        
        if (!this.pathSelectMode) {
            svgContainer.classList.remove('path-select-mode');
            const overlay = svgContainer.querySelector('.path-select-overlay');
            if (overlay) {
                if (overlay._cleanup) overlay._cleanup();
                overlay.remove();
            }
            return;
        }
        
        svgContainer.classList.add('path-select-mode');
        this._createPathSelectOverlay(svgContainer, childLayer);
    },

    /**
     * 创建可点击的路径覆盖层 - 支持点击和框选删除
     */
    _createPathSelectOverlay(container, childLayer) {
        const oldOverlay = container.querySelector('.path-select-overlay');
        if (oldOverlay) oldOverlay.remove();
        
        if (!childLayer || !childLayer.svg) return;
        
        const widthMatch = childLayer.svg.match(/width="([^"]+)"/);
        const heightMatch = childLayer.svg.match(/height="([^"]+)"/);
        const viewBoxMatch = childLayer.svg.match(/viewBox="([^"]+)"/);
        
        const width = widthMatch ? widthMatch[1] : '100%';
        const height = heightMatch ? heightMatch[1] : '100%';
        const viewBox = viewBoxMatch ? viewBoxMatch[1] : '';
        
        const dMatch = childLayer.svg.match(/\bd="([^"]+)"/);
        if (!dMatch) return;
        
        const subPathRegex = /M[^M]+/gi;
        const subPaths = dMatch[1].match(subPathRegex) || [];
        
        if (subPaths.length === 0) return;
        
        const overlay = document.createElement('div');
        overlay.className = 'path-select-overlay';
        overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:100;';
        
        const color = childLayer.color || '#000000';
        const pathElements = subPaths.map((d, idx) => 
            `<path d="${d.trim()}" fill="${color}" fill-opacity="0.01" stroke="transparent" stroke-width="10" 
                   style="pointer-events:all;cursor:pointer;" data-subpath-idx="${idx}"/>`
        ).join('');
        
        const svgWrapper = document.createElement('div');
        svgWrapper.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;';
        svgWrapper.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"${viewBox ? ` viewBox="${viewBox}"` : ''} 
                 style="width:100%;height:100%;" preserveAspectRatio="xMidYMid meet">
                ${pathElements}
            </svg>
        `;
        overlay.appendChild(svgWrapper);
        
        // 创建选择框元素
        const selectionDiv = document.createElement('div');
        selectionDiv.className = 'selection-box';
        selectionDiv.style.cssText = 'position:absolute;border:2px dashed #4f46e5;background:rgba(79,70,229,0.15);display:none;pointer-events:none;z-index:300;';
        svgWrapper.appendChild(selectionDiv);
        
        // 创建操作按钮容器
        const actionBar = document.createElement('div');
        actionBar.style.cssText = 'position:absolute;top:8px;right:8px;display:none;z-index:301;gap:8px;';
        overlay.appendChild(actionBar);
        
        // 选中的路径索引集合
        const selectedPaths = new Set();
        const pathBounds = subPaths.map(d => this._getPathBounds(d));
        
        // 绑定点击事件
        const allPaths = overlay.querySelectorAll('path');
        allPaths.forEach(path => {
            path.addEventListener('mouseenter', () => {
                if (!selectedPaths.has(parseInt(path.dataset.subpathIdx))) {
                    path.style.fill = 'rgba(239, 68, 68, 0.3)';
                    path.style.stroke = '#ef4444';
                    path.style.strokeWidth = '2';
                }
            });
            path.addEventListener('mouseleave', () => {
                if (!selectedPaths.has(parseInt(path.dataset.subpathIdx))) {
                    path.style.fill = color;
                    path.style.fillOpacity = '0.01';
                    path.style.stroke = 'transparent';
                }
            });
            path.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(path.dataset.subpathIdx);
                
                if (e.ctrlKey || e.metaKey) {
                    if (selectedPaths.has(idx)) {
                        selectedPaths.delete(idx);
                        path.style.fill = color;
                        path.style.fillOpacity = '0.01';
                        path.style.stroke = 'transparent';
                    } else {
                        selectedPaths.add(idx);
                        path.style.fill = 'rgba(239, 68, 68, 0.5)';
                        path.style.stroke = '#ef4444';
                        path.style.strokeWidth = '2';
                    }
                    updateActionBar();
                } else if (selectedPaths.size > 0) {
                    if (confirm(`删除 ${selectedPaths.size} 个选中的路径？`)) {
                        this._deleteMultipleSubPaths(childLayer, Array.from(selectedPaths));
                    }
                } else {
                    if (confirm(`删除此子路径？(${idx + 1}/${subPaths.length})`)) {
                        this._deleteSubPathFromChild(childLayer, idx);
                    }
                }
            });
        });
        
        // 框选状态
        let isSelecting = false;
        let startX = 0, startY = 0;
        
        // 删除按钮
        const deleteBtn = document.createElement('button');
        deleteBtn.style.cssText = 'padding:3px 8px;background:#ef4444;color:white;border:none;border-radius:3px;cursor:pointer;font-size:11px;display:flex;align-items:center;gap:3px;';
        deleteBtn.innerHTML = '<iconify-icon icon="carbon:trash-can" style="font-size:12px"></iconify-icon> 删除 (0)';
        deleteBtn.onclick = () => {
            if (selectedPaths.size > 0 && confirm(`删除 ${selectedPaths.size} 个选中的路径？`)) {
                this._deleteMultipleSubPaths(childLayer, Array.from(selectedPaths));
            }
        };
        
        // 取消按钮
        const cancelBtn = document.createElement('button');
        cancelBtn.style.cssText = 'padding:3px 8px;background:#6b7280;color:white;border:none;border-radius:3px;cursor:pointer;font-size:11px;';
        cancelBtn.textContent = '取消';
        cancelBtn.onclick = () => {
            selectedPaths.clear();
            allPaths.forEach(p => {
                p.style.fill = color;
                p.style.fillOpacity = '0.01';
                p.style.stroke = 'transparent';
            });
            updateActionBar();
        };
        
        actionBar.appendChild(deleteBtn);
        actionBar.appendChild(cancelBtn);
        
        // 更新操作栏
        const updateActionBar = () => {
            if (selectedPaths.size > 0) {
                actionBar.style.display = 'flex';
                deleteBtn.innerHTML = `<iconify-icon icon="carbon:trash-can" style="font-size:12px"></iconify-icon> 删除 (${selectedPaths.size})`;
            } else {
                actionBar.style.display = 'none';
            }
        };
        
        // 解析 viewBox
        let vbMinX = 0, vbMinY = 0, vbWidth = parseFloat(width) || 100, vbHeight = parseFloat(height) || 100;
        if (viewBox) {
            const vbParts = viewBox.split(/[\s,]+/).map(parseFloat);
            if (vbParts.length === 4) {
                [vbMinX, vbMinY, vbWidth, vbHeight] = vbParts;
            }
        }
        
        overlay.style.pointerEvents = 'all';
        
        // 缩放因子
        const getScale = () => {
            const rect = svgWrapper.getBoundingClientRect();
            return { x: rect.width / svgWrapper.offsetWidth || 1, y: rect.height / svgWrapper.offsetHeight || 1 };
        };
        
        // 框选开始
        svgWrapper.addEventListener('mousedown', (e) => {
            if (e.target.tagName.toLowerCase() === 'path') return;
            e.preventDefault();
            isSelecting = true;
            const rect = svgWrapper.getBoundingClientRect();
            const scale = getScale();
            startX = (e.clientX - rect.left) / scale.x;
            startY = (e.clientY - rect.top) / scale.y;
            selectionDiv.style.left = startX + 'px';
            selectionDiv.style.top = startY + 'px';
            selectionDiv.style.width = '0';
            selectionDiv.style.height = '0';
            selectionDiv.style.display = 'block';
        });
        
        // 框选移动
        const handleMouseMove = (e) => {
            if (!isSelecting) return;
            const rect = svgWrapper.getBoundingClientRect();
            const scale = getScale();
            const currentX = (e.clientX - rect.left) / scale.x;
            const currentY = (e.clientY - rect.top) / scale.y;
            selectionDiv.style.left = Math.min(startX, currentX) + 'px';
            selectionDiv.style.top = Math.min(startY, currentY) + 'px';
            selectionDiv.style.width = Math.abs(currentX - startX) + 'px';
            selectionDiv.style.height = Math.abs(currentY - startY) + 'px';
        };
        document.addEventListener('mousemove', handleMouseMove);
        
        // 框选结束
        const handleMouseUp = (e) => {
            if (!isSelecting) return;
            isSelecting = false;
            selectionDiv.style.display = 'none';
            
            const rect = svgWrapper.getBoundingClientRect();
            const scale = getScale();
            const endX = (e.clientX - rect.left) / scale.x;
            const endY = (e.clientY - rect.top) / scale.y;
            
            if (Math.abs(endX - startX) < 5 && Math.abs(endY - startY) < 5) return;
            
            // 转换为 viewBox 坐标
            const wrapperWidth = svgWrapper.offsetWidth;
            const wrapperHeight = svgWrapper.offsetHeight;
            const svgRatio = vbWidth / vbHeight;
            const wrapperRatio = wrapperWidth / wrapperHeight;
            
            let renderWidth, renderHeight, offsetX, offsetY;
            if (wrapperRatio > svgRatio) {
                renderHeight = wrapperHeight;
                renderWidth = renderHeight * svgRatio;
                offsetX = (wrapperWidth - renderWidth) / 2;
                offsetY = 0;
            } else {
                renderWidth = wrapperWidth;
                renderHeight = renderWidth / svgRatio;
                offsetX = 0;
                offsetY = (wrapperHeight - renderHeight) / 2;
            }
            
            const toSvgX = (px) => ((px - offsetX) / renderWidth) * vbWidth + vbMinX;
            const toSvgY = (py) => ((py - offsetY) / renderHeight) * vbHeight + vbMinY;
            
            const selLeft = Math.min(toSvgX(startX), toSvgX(endX));
            const selTop = Math.min(toSvgY(startY), toSvgY(endY));
            const selRight = Math.max(toSvgX(startX), toSvgX(endX));
            const selBottom = Math.max(toSvgY(startY), toSvgY(endY));
            
            // 检查哪些路径与选择框相交
            pathBounds.forEach((bounds, idx) => {
                if (!bounds) return;
                const intersects = !(bounds.maxX < selLeft || bounds.minX > selRight ||
                                    bounds.maxY < selTop || bounds.minY > selBottom);
                if (intersects) {
                    selectedPaths.add(idx);
                    const pathEl = allPaths[idx];
                    if (pathEl) {
                        pathEl.style.fill = 'rgba(239, 68, 68, 0.5)';
                        pathEl.style.stroke = '#ef4444';
                        pathEl.style.strokeWidth = '2';
                    }
                }
            });
            
            updateActionBar();
        };
        document.addEventListener('mouseup', handleMouseUp);
        
        // Esc 取消
        const handleKeydown = (e) => {
            if (e.key === 'Escape' && selectedPaths.size > 0) {
                selectedPaths.clear();
                allPaths.forEach(p => {
                    p.style.fill = color;
                    p.style.fillOpacity = '0.01';
                    p.style.stroke = 'transparent';
                });
                updateActionBar();
            }
        };
        document.addEventListener('keydown', handleKeydown);
        
        // 清理函数
        overlay._cleanup = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.removeEventListener('keydown', handleKeydown);
        };
        
        container.appendChild(overlay);
    },

    /**
     * 删除多个子路径
     */
    _deleteMultipleSubPaths(childLayer, indices) {
        if (!childLayer || !childLayer.svg || indices.length === 0) return;
        
        const dMatch = childLayer.svg.match(/\bd="([^"]+)"/);
        if (!dMatch) return;
        
        const d = dMatch[1];
        const subPathRegex = /M[^M]+/gi;
        const subPaths = d.match(subPathRegex) || [];
        
        const toDelete = new Set(indices);
        
        indices.forEach(idx => {
            const targetBounds = this._getPathBounds(subPaths[idx]);
            if (targetBounds) {
                for (let i = 0; i < subPaths.length; i++) {
                    if (toDelete.has(i)) continue;
                    const bounds = this._getPathBounds(subPaths[i]);
                    if (this._boundsContains(targetBounds, bounds)) {
                        toDelete.add(i);
                    }
                }
            }
        });
        
        const remaining = subPaths.filter((_, idx) => !toDelete.has(idx));
        
        if (remaining.length === 0) {
            alert('删除后图层将为空，操作取消');
            return;
        }
        
        const newD = remaining.map(p => p.trim()).join(' ');
        childLayer.svg = childLayer.svg.replace(/\bd="[^"]+"/, `d="${newD}"`);
        
        if (childLayer.originalSvg) {
            childLayer.originalSvg = childLayer.originalSvg.replace(/\bd="[^"]+"/, `d="${newD}"`);
        }
        
        this._saveHistory();
        this._render();
        this._updatePropertyPanel();
        
        const svgContainer = this.container.querySelector('.image-editor-svg-container');
        this._createPathSelectOverlay(svgContainer, childLayer);
        
        console.log(`[LayerEditor] 删除 ${toDelete.size} 个子路径，剩余 ${remaining.length} 个`);
    },

    /**
     * 从子图层中删除复合路径中的某个子路径
     */
    _deleteSubPathFromChild(childLayer, subPathIndex) {
        if (!childLayer || !childLayer.svg) return;
        
        const dMatch = childLayer.svg.match(/\bd="([^"]+)"/);
        if (!dMatch) return;
        
        const d = dMatch[1];
        const subPathRegex = /M[^M]+/gi;
        const subPaths = d.match(subPathRegex) || [];
        
        if (subPathIndex < 0 || subPathIndex >= subPaths.length) return;
        
        const targetBounds = this._getPathBounds(subPaths[subPathIndex]);
        const toDelete = new Set([subPathIndex]);
        
        if (targetBounds) {
            for (let i = 0; i < subPaths.length; i++) {
                if (i === subPathIndex) continue;
                const bounds = this._getPathBounds(subPaths[i]);
                if (this._boundsContains(targetBounds, bounds)) {
                    toDelete.add(i);
                }
            }
        }
        
        const remaining = subPaths.filter((_, idx) => !toDelete.has(idx));
        
        if (remaining.length === 0) {
            alert('删除后图层将为空，操作取消');
            return;
        }
        
        const newD = remaining.map(p => p.trim()).join(' ');
        childLayer.svg = childLayer.svg.replace(/\bd="[^"]+"/, `d="${newD}"`);
        
        if (childLayer.originalSvg) {
            childLayer.originalSvg = childLayer.originalSvg.replace(/\bd="[^"]+"/, `d="${newD}"`);
        }
        
        this._saveHistory();
        this._render();
        this._updatePropertyPanel();
        
        const svgContainer = this.container.querySelector('.image-editor-svg-container');
        this._createPathSelectOverlay(svgContainer, childLayer);
        
        console.log(`[LayerEditor] 删除 ${toDelete.size} 个子路径（含孔洞），剩余 ${remaining.length} 个`);
    },

    /**
     * 从子图层中删除指定路径（整个 path 元素）
     */
    _deletePathFromChild(childLayer, pathIndex) {
        if (!childLayer || !childLayer.svg) return;
        
        let currentIdx = 0;
        childLayer.svg = childLayer.svg.replace(/<path[^>]*\/?>(?:<\/path>)?/g, (match) => {
            if (currentIdx === pathIndex) {
                currentIdx++;
                return '';
            }
            currentIdx++;
            return match;
        });
        
        if (childLayer.originalSvg) {
            currentIdx = 0;
            childLayer.originalSvg = childLayer.originalSvg.replace(/<path[^>]*\/?>(?:<\/path>)?/g, (match) => {
                if (currentIdx === pathIndex) {
                    currentIdx++;
                    return '';
                }
                currentIdx++;
                return match;
            });
        }
        
        this._saveHistory();
        this._render();
        this._updatePropertyPanel();
        this._setupPathSelection(childLayer);
    }
};

# Paper-Burner 前端性能优化实施计划

> **创建日期**: 2025-11-12
> **目标**: 系统性提升前端性能，改善用户体验
> **原则**: 渐进式优化，充分测试，可回滚

---

## 📋 总体策略

### 优化原则
1. **安全第一**: 每个修改都要有完整的测试覆盖
2. **渐进式**: 从低风险优化开始，逐步推进
3. **可回滚**: 使用 Git 分支，保持每个优化独立
4. **可验证**: 每个优化都要有性能指标对比

### 分支策略
```
main
  └─ optimize/frontend-performance (当前分支)
      ├─ optimize/phase1-low-risk
      ├─ optimize/phase2-cache-strategy
      ├─ optimize/phase3-event-delegation
      └─ optimize/phase4-virtual-scroll
```

---

## 🎯 Phase 1: 低风险快速优化（1-2天）

### 1.1 创建性能工具模块
**文件**: `js/utils/performance-helpers.js`
**风险**: 🟢 极低（新增文件，不影响现有代码）
**预期收益**: 为后续优化提供基础工具

#### 实施步骤
1. 创建工具模块（防抖、节流、LRU缓存、安全定时器）
2. 添加单元测试
3. 在一个非关键模块试用（如设置面板）
4. 验证无问题后推广

#### 测试检查点
- [ ] 防抖函数在300ms内只执行一次
- [ ] 节流函数在滚动时按预期频率触发
- [ ] LRU缓存正确淘汰最久未使用项
- [ ] 定时器在页面卸载时全部清理

#### 回滚方案
删除新文件，无需其他操作

---

### 1.2 搜索输入防抖优化
**文件**: `js/history/history.js`
**行数**: 352-355
**风险**: 🟢 低（逻辑简单，易测试）
**预期收益**: 减少50-80%的渲染次数

#### 修改前代码
```javascript
historySearchInput.addEventListener('input', function(event) {
    historyUIState.searchQuery = event.target.value || '';
    renderHistoryList();  // 每次按键都触发
});
```

#### 修改后代码
```javascript
import { PerformanceHelpers } from '../utils/performance-helpers.js';

const debouncedRenderHistory = PerformanceHelpers.debounce(renderHistoryList, 300);

historySearchInput.addEventListener('input', function(event) {
    historyUIState.searchQuery = event.target.value || '';
    debouncedRenderHistory();
});
```

#### 测试检查点
- [ ] 快速输入"test"（4个字符），只触发1次渲染
- [ ] 输入后停顿300ms，触发渲染
- [ ] 搜索结果正确显示
- [ ] 清空搜索框，恢复完整列表

#### 性能对比
| 操作 | 优化前 | 优化后 |
|------|--------|--------|
| 输入5个字符 | 5次渲染 | 1次渲染 |
| 渲染耗时 | 450ms × 5 = 2.25s | 450ms × 1 = 450ms |

---

### 1.3 正则表达式提升优化
**文件**: `js/processing/markdown_processor_ast.js`
**行数**: 140-155
**风险**: 🟢 低（只是提升作用域，不改变逻辑）
**预期收益**: 大文档处理速度提升10-15%

#### 修改策略
```javascript
// 在模块顶部定义正则常量
const MATH_DELIMITER_PATTERNS = Object.freeze({
    dollarWithComma: /\$\\\$\s*([^\$\n]{1,200}?)\s*\\\$\s*，\s*\$/g,
    doubleDollar: /\$\\\$\s*([^\$\n]{1,200}?)\s*\\\$\$/g,
    singleDollarEnd: /\$\\\$\s*([^\$\n]{1,200}?)\s*\\\$/g,
    // ... 其他模式
});

// 每次使用前重置 lastIndex（重要！）
function normalizeMathDelimiters(text) {
    let s = text;

    MATH_DELIMITER_PATTERNS.dollarWithComma.lastIndex = 0;
    s = s.replace(MATH_DELIMITER_PATTERNS.dollarWithComma, '$$  $1  $$');

    MATH_DELIMITER_PATTERNS.doubleDollar.lastIndex = 0;
    s = s.replace(MATH_DELIMITER_PATTERNS.doubleDollar, '$$  $1  $$');

    return s;
}
```

#### 测试检查点
- [ ] 公式修复功能正常（测试文档: test-formula-issues.html）
- [ ] 行内公式识别正确
- [ ] 块公式识别正确
- [ ] 边界情况：嵌套公式、特殊字符

#### 性能对比
使用 `performance.mark()` 测量：
```javascript
performance.mark('normalize-start');
normalizeMathDelimiters(largeText);
performance.mark('normalize-end');
performance.measure('normalize', 'normalize-start', 'normalize-end');
console.log(performance.getEntriesByName('normalize')[0].duration);
```

---

### 1.4 轮询定时器优化
**文件**: `js/annotations/annotations_summary_modal.js`
**行数**: 996
**风险**: 🟡 中低（需要测试页面隐藏逻辑）
**预期收益**: 减少50%的后台CPU占用

#### 修改策略
```javascript
class ColorPollingManager {
    constructor(checkFn, interval = 1000) {
        this.checkFn = checkFn;
        this.interval = interval;
        this.timerId = null;
        this.isActive = false;

        this._setupVisibilityListener();
    }

    _setupVisibilityListener() {
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.pause();
            } else {
                this.resume();
            }
        });

        window.addEventListener('beforeunload', () => this.stop());
    }

    _poll() {
        if (!this.isActive) return;

        if (!document.hidden) {
            this.checkFn();
        }

        this.timerId = setTimeout(() => this._poll(), this.interval);
    }

    start() {
        if (this.isActive) return;
        this.isActive = true;
        this._poll();
    }

    pause() {
        if (this.timerId) {
            clearTimeout(this.timerId);
            this.timerId = null;
        }
    }

    resume() {
        if (this.isActive && !this.timerId) {
            this._poll();
        }
    }

    stop() {
        this.isActive = false;
        this.pause();
    }
}

// 使用
const colorPoller = new ColorPollingManager(checkForNewColors, 1000);
colorPoller.start();
```

#### 测试检查点
- [ ] 页面可见时，轮询正常执行
- [ ] 切换到其他标签，轮询暂停
- [ ] 切回标签，轮询恢复
- [ ] 关闭页面，定时器被清理
- [ ] 批注颜色更新功能正常

#### 性能对比
使用 Chrome DevTools Performance 监控：
- 页面隐藏时 CPU 占用应降至 0%

---

## 🔧 Phase 2: 中等风险优化（3-5天）

### 2.1 LRU 缓存实现
**文件**: `js/processing/markdown_processor_ast.js`
**行数**: 17-18
**风险**: 🟡 中（需要验证缓存命中率）
**预期收益**: 内存占用减少30-40%

#### 实施步骤

**Step 1: 创建 LRU 缓存类**
```javascript
class LRUCache {
    constructor(maxSize = 1000) {
        this.maxSize = maxSize;
        this.cache = new Map();

        // 性能指标
        this.stats = {
            hits: 0,
            misses: 0,
            evictions: 0,
            size: 0
        };
    }

    get(key) {
        if (!this.cache.has(key)) {
            this.stats.misses++;
            return undefined;
        }

        this.stats.hits++;
        const value = this.cache.get(key);

        // 移到最后（最新使用）
        this.cache.delete(key);
        this.cache.set(key, value);

        return value;
    }

    set(key, value) {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
            // 删除最久未使用的（第一个）
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
            this.stats.evictions++;
        }

        this.cache.set(key, value);
        this.stats.size = this.cache.size;
    }

    clear() {
        this.cache.clear();
        this.stats = { hits: 0, misses: 0, evictions: 0, size: 0 };
    }

    getStats() {
        return {
            ...this.stats,
            hitRate: this.stats.hits / (this.stats.hits + this.stats.misses) || 0
        };
    }
}
```

**Step 2: 替换现有缓存**
```javascript
// 替换
const renderCache = new Map();

// 为
const renderCache = new LRUCache(CONFIG.cacheSize);

// 使用方式保持不变
renderCache.get(key);
renderCache.set(key, value);
```

**Step 3: 添加监控**
```javascript
// 在控制台暴露缓存统计
if (CONFIG.debug) {
    window.__markdownCacheStats = () => renderCache.getStats();
}

// 定期打印（仅 debug 模式）
if (CONFIG.debug) {
    setInterval(() => {
        const stats = renderCache.getStats();
        console.log('[Markdown Cache]', {
            hitRate: `${(stats.hitRate * 100).toFixed(2)}%`,
            size: stats.size,
            evictions: stats.evictions
        });
    }, 30000);  // 每30秒
}
```

#### 测试检查点
- [ ] 缓存命中率 > 70%（使用 `window.__markdownCacheStats()`）
- [ ] 缓存大小稳定在配置值附近
- [ ] 渲染结果与之前完全一致
- [ ] 内存占用未异常增长

#### 性能监控
```javascript
// 添加到测试页面
async function testCachePerformance() {
    const testText = '重复的长文本...';

    console.time('首次渲染');
    await processMarkdown(testText);
    console.timeEnd('首次渲染');

    console.time('缓存命中渲染');
    await processMarkdown(testText);
    console.timeEnd('缓存命中渲染');

    console.log('缓存统计:', window.__markdownCacheStats());
}
```

---

### 2.2 批注系统 DOM 缓存优化
**文件**: `js/annotations/annotation_logic.js`
**行数**: 440-500
**风险**: 🟡 中（需要处理 DOM 更新同步）
**预期收益**: 右键响应速度提升70-85%

#### 架构设计

```javascript
/**
 * 批注 DOM 缓存管理器
 *
 * 职责：
 * 1. 缓存常用的 DOM 查询结果
 * 2. 监听 DOM 变化，自动刷新缓存
 * 3. 提供快速查找方法
 */
class AnnotationDOMCache {
    constructor(containerSelector) {
        this.containerSelector = containerSelector;
        this.container = document.querySelector(containerSelector);

        if (!this.container) {
            throw new Error(`Container not found: ${containerSelector}`);
        }

        // 缓存数据
        this.cache = {
            subBlocks: [],
            blocks: [],
            subBlockMap: new Map(),  // id -> element
            blockMap: new Map()      // index -> element
        };

        // 初始化
        this.refresh();
        this._setupObserver();
    }

    /**
     * 刷新所有缓存
     */
    refresh() {
        // 子块
        this.cache.subBlocks = Array.from(
            this.container.querySelectorAll('.sub-block[data-sub-block-id]')
        );

        // 构建 Map 索引
        this.cache.subBlockMap.clear();
        this.cache.subBlocks.forEach(block => {
            const id = block.getAttribute('data-sub-block-id');
            if (id) this.cache.subBlockMap.set(id, block);
        });

        // 块
        this.cache.blocks = Array.from(
            this.container.querySelectorAll('[data-block-index]')
        );

        this.cache.blockMap.clear();
        this.cache.blocks.forEach(block => {
            const index = block.getAttribute('data-block-index');
            if (index) this.cache.blockMap.set(index, block);
        });

        console.log('[AnnotationDOMCache] Refreshed:', {
            subBlocks: this.cache.subBlocks.length,
            blocks: this.cache.blocks.length
        });
    }

    /**
     * 监听 DOM 变化，自动刷新缓存
     */
    _setupObserver() {
        const observer = new MutationObserver((mutations) => {
            // 检查是否有结构性变化
            const hasStructuralChange = mutations.some(mutation =>
                mutation.type === 'childList' && mutation.addedNodes.length > 0
            );

            if (hasStructuralChange) {
                console.log('[AnnotationDOMCache] DOM changed, refreshing...');
                this.refresh();
            }
        });

        observer.observe(this.container, {
            childList: true,
            subtree: true
        });

        this.observer = observer;
    }

    /**
     * 根据坐标查找子块
     */
    findSubBlockAtPoint(x, y) {
        // 使用缓存的数组，而不是重新查询
        return this.cache.subBlocks.find(block => {
            const rect = block.getBoundingClientRect();
            return x >= rect.left && x <= rect.right &&
                   y >= rect.top && y <= rect.bottom;
        });
    }

    /**
     * 根据 ID 获取子块
     */
    getSubBlockById(id) {
        return this.cache.subBlockMap.get(id);
    }

    /**
     * 根据索引获取块
     */
    getBlockByIndex(index) {
        return this.cache.blockMap.get(String(index));
    }

    /**
     * 获取所有子块
     */
    getAllSubBlocks() {
        return this.cache.subBlocks;
    }

    /**
     * 获取所有块
     */
    getAllBlocks() {
        return this.cache.blocks;
    }

    /**
     * 清理
     */
    destroy() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        this.cache.subBlockMap.clear();
        this.cache.blockMap.clear();
    }
}
```

#### 集成到现有代码

**修改前**:
```javascript
mainContainer.addEventListener('contextmenu', function(event) {
    event.preventDefault();
    event.stopPropagation();

    // ❌ 每次都查询全文档
    let allSubBlocks = document.querySelectorAll('.sub-block[data-sub-block-id]');
    const blocks = document.querySelectorAll('[data-block-index]');

    // ... 查找逻辑
});
```

**修改后**:
```javascript
// 初始化缓存（在 DOMContentLoaded 时）
let domCache;

function initAnnotationDOMCache() {
    const mainContainer = document.querySelector('#mainContainer, #detail-ocr-section, #detail-translated-section');
    if (mainContainer) {
        domCache = new AnnotationDOMCache('#mainContainer, #detail-ocr-section, #detail-translated-section');
    }
}

// 使用缓存
mainContainer.addEventListener('contextmenu', function(event) {
    event.preventDefault();
    event.stopPropagation();

    // ✅ 使用缓存
    const clickedSubBlock = domCache.findSubBlockAtPoint(event.clientX, event.clientY);

    if (clickedSubBlock) {
        const subBlockId = clickedSubBlock.getAttribute('data-sub-block-id');
        // ... 后续逻辑
    }
});
```

#### 测试检查点
- [ ] 右键菜单响应速度 < 50ms
- [ ] 批注创建功能正常
- [ ] 批注高亮显示正确
- [ ] 文档切换时缓存正确刷新
- [ ] 翻译完成后缓存正确更新

#### 性能对比
```javascript
// 测试脚本
console.time('DOM查询-优化前');
for (let i = 0; i < 100; i++) {
    document.querySelectorAll('.sub-block[data-sub-block-id]');
}
console.timeEnd('DOM查询-优化前');

console.time('DOM查询-优化后');
for (let i = 0; i < 100; i++) {
    domCache.getAllSubBlocks();
}
console.timeEnd('DOM查询-优化后');
```

---

### 2.3 字符串拼接优化
**文件**: `js/chatbot/ui/chatbot-message-renderer.js`
**行数**: 95-105
**风险**: 🟢 低（局部修改）
**预期收益**: 大消息渲染速度提升15-20%

#### 修改策略
```javascript
// 修改前
let userMessageHtml = '';
contentToDisplay.forEach(part => {
    if (part.type === 'text') {
        userMessageHtml += `<div class="whitespace-pre-wrap">${escapeHtml(part.text)}</div>`;
    } else if (part.type === 'image_url') {
        userMessageHtml += `<img src="${part.image_url.url}" class="max-w-full h-auto rounded" />`;
    }
});

// 修改后
const htmlParts = contentToDisplay.map(part => {
    if (part.type === 'text') {
        return `<div class="whitespace-pre-wrap">${escapeHtml(part.text)}</div>`;
    } else if (part.type === 'image_url') {
        return `<img src="${part.image_url.url}" class="max-w-full h-auto rounded" />`;
    }
    return '';
});
const userMessageHtml = htmlParts.join('');
```

#### 测试检查点
- [ ] 消息渲染结果一致
- [ ] 图片正常显示
- [ ] 文本换行正确
- [ ] 混合内容（文本+图片）正确

---

## ⚡ Phase 3: 高风险重构（5-7天）

### 3.1 聊天消息事件委托重构
**文件**: `js/chatbot/ui/chatbot-message-renderer.js`
**风险**: 🔴 高（涉及核心交互逻辑）
**预期收益**: 内存占用减少40-60%，交互流畅度提升

#### 重构计划

**Step 1: 创建事件管理器**
```javascript
/**
 * 聊天消息事件管理器
 * 使用事件委托处理所有消息操作
 */
class ChatMessageEventManager {
    constructor(containerSelector) {
        this.container = document.querySelector(containerSelector);
        if (!this.container) {
            throw new Error(`Container not found: ${containerSelector}`);
        }

        this._setupEventDelegation();
    }

    _setupEventDelegation() {
        // 单一点击事件监听器
        this.container.addEventListener('click', (e) => {
            const target = e.target.closest('[data-action]');
            if (!target) return;

            const action = target.dataset.action;
            const index = parseInt(target.dataset.index);

            switch (action) {
                case 'delete':
                    this._handleDelete(index, e);
                    break;
                case 'resend':
                    this._handleResend(index, e);
                    break;
                case 'copy':
                    this._handleCopy(index, e);
                    break;
                case 'toggle-raw':
                    this._handleToggleRaw(index, e);
                    break;
            }
        });

        // 键盘快捷键
        this.container.addEventListener('keydown', (e) => {
            if (e.key === 'Delete' && e.target.closest('.message-item')) {
                const item = e.target.closest('.message-item');
                const index = parseInt(item.dataset.messageIndex);
                this._handleDelete(index, e);
            }
        });
    }

    _handleDelete(index, event) {
        event.stopPropagation();
        if (window.ChatbotActions && window.ChatbotActions.deleteMessage) {
            window.ChatbotActions.deleteMessage(index);
        }
    }

    _handleResend(index, event) {
        event.stopPropagation();
        if (window.ChatbotActions && window.ChatbotActions.resendUserMessage) {
            window.ChatbotActions.resendUserMessage(index);
        }
    }

    _handleCopy(index, event) {
        event.stopPropagation();
        // 复制逻辑
    }

    _handleToggleRaw(index, event) {
        event.stopPropagation();
        // 切换原始内容显示
    }
}
```

**Step 2: 修改消息渲染器**

修改前（内联事件）:
```html
<button onclick="window.ChatbotActions.deleteMessage(${index})"
        onmouseover="this.style.background='rgba(239,68,68,0.1)';">
```

修改后（数据属性 + CSS）:
```html
<button class="message-action-btn delete-btn"
        data-action="delete"
        data-index="${index}">
```

```css
/* 使用 CSS 处理 hover 效果 */
.message-action-btn {
    transition: background-color 0.2s;
}

.delete-btn:hover {
    background-color: rgba(239, 68, 68, 0.1);
}

.resend-btn:hover {
    background-color: rgba(59, 130, 246, 0.1);
}
```

**Step 3: 分阶段迁移**

```javascript
// 阶段 1: 双模式运行（兼容期）
const USE_EVENT_DELEGATION = true;  // 特性开关

function renderMessageActions(index) {
    if (USE_EVENT_DELEGATION) {
        return `
            <button class="message-action-btn delete-btn"
                    data-action="delete"
                    data-index="${index}">
                删除
            </button>
        `;
    } else {
        // 旧版本（回退）
        return `
            <button onclick="window.ChatbotActions.deleteMessage(${index})">
                删除
            </button>
        `;
    }
}

// 阶段 2: 充分测试后移除旧代码
```

#### 测试检查点
- [ ] 删除消息功能正常
- [ ] 重新发送功能正常
- [ ] 复制功能正常
- [ ] Hover 效果正常
- [ ] 键盘快捷键正常
- [ ] 多个聊天窗口（浮动模式）不冲突
- [ ] 快速连续点击不出错

#### 性能对比
```javascript
// 测试内存占用
function measureMemoryUsage() {
    if (performance.memory) {
        console.log('Heap Size:', (performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(2), 'MB');
    }
}

// 优化前：渲染 50 条消息
measureMemoryUsage();  // 例如: 45.2 MB

// 优化后：渲染 50 条消息
measureMemoryUsage();  // 预期: 28.5 MB (减少 37%)
```

---

## 🚀 Phase 4: 架构级优化（1-2周）

### 4.1 历史记录虚拟滚动实现
**文件**: `js/history/history.js`
**风险**: 🔴 高（核心功能重写）
**预期收益**: 大列表（100+）渲染速度提升80-90%

#### 架构设计

```javascript
/**
 * 虚拟滚动列表管理器
 *
 * 原理：
 * 1. 只渲染可视区域的项目
 * 2. 根据滚动位置动态更新显示项
 * 3. 使用 CSS transform 模拟滚动
 */
class VirtualScrollList {
    constructor(options) {
        this.container = options.container;          // 容器元素
        this.itemHeight = options.itemHeight;        // 每项高度（固定）
        this.renderItem = options.renderItem;        // 渲染函数
        this.items = [];                             // 所有数据

        // 可视区域计算
        this.visibleStart = 0;
        this.visibleEnd = 0;
        this.visibleCount = Math.ceil(this.container.clientHeight / this.itemHeight) + 2;

        // DOM 元素
        this.viewport = null;
        this.content = null;

        this._init();
    }

    _init() {
        // 创建虚拟滚动结构
        this.container.innerHTML = `
            <div class="virtual-scroll-viewport" style="overflow-y: auto; height: 100%;">
                <div class="virtual-scroll-content" style="position: relative;">
                    <!-- 动态内容 -->
                </div>
            </div>
        `;

        this.viewport = this.container.querySelector('.virtual-scroll-viewport');
        this.content = this.container.querySelector('.virtual-scroll-content');

        // 监听滚动
        this.viewport.addEventListener('scroll', () => this._handleScroll());
    }

    /**
     * 设置数据
     */
    setItems(items) {
        this.items = items;

        // 设置内容区域总高度
        this.content.style.height = `${items.length * this.itemHeight}px`;

        // 重新渲染
        this._render();
    }

    /**
     * 处理滚动
     */
    _handleScroll() {
        const scrollTop = this.viewport.scrollTop;
        const newVisibleStart = Math.floor(scrollTop / this.itemHeight);

        // 只在变化时重新渲染
        if (newVisibleStart !== this.visibleStart) {
            this.visibleStart = newVisibleStart;
            this.visibleEnd = Math.min(
                newVisibleStart + this.visibleCount,
                this.items.length
            );
            this._render();
        }
    }

    /**
     * 渲染可见项
     */
    _render() {
        const visibleItems = this.items.slice(this.visibleStart, this.visibleEnd);

        const html = visibleItems.map((item, index) => {
            const absoluteIndex = this.visibleStart + index;
            const top = absoluteIndex * this.itemHeight;

            return `
                <div class="virtual-item"
                     style="position: absolute;
                            top: ${top}px;
                            height: ${this.itemHeight}px;
                            left: 0;
                            right: 0;">
                    ${this.renderItem(item, absoluteIndex)}
                </div>
            `;
        }).join('');

        this.content.innerHTML = html;
    }

    /**
     * 滚动到指定项
     */
    scrollToIndex(index) {
        const targetScrollTop = index * this.itemHeight;
        this.viewport.scrollTop = targetScrollTop;
    }

    /**
     * 刷新
     */
    refresh() {
        this._render();
    }
}
```

#### 集成到历史记录页面

**Step 1: 创建适配器**
```javascript
// js/history/history-virtual-scroll.js

class HistoryVirtualList {
    constructor() {
        this.virtualList = null;
        this.ITEM_HEIGHT = 120;  // 历史项高度（需要测量）
    }

    init(containerSelector) {
        const container = document.querySelector(containerSelector);

        this.virtualList = new VirtualScrollList({
            container: container,
            itemHeight: this.ITEM_HEIGHT,
            renderItem: (record, index) => this._renderHistoryItem(record, index)
        });
    }

    _renderHistoryItem(record, index) {
        // 复用现有的 renderHistoryItem 逻辑
        const isBatch = record.batchId && record.batchChildren && record.batchChildren.length > 0;

        if (isBatch) {
            return this._renderBatchItem(record);
        } else {
            return this._renderSingleItem(record);
        }
    }

    _renderSingleItem(record) {
        // 从原有代码提取渲染逻辑
        return `
            <div class="history-item" data-id="${record.id}">
                <div class="history-item-name">${escapeHtml(record.name)}</div>
                <div class="history-item-time">${formatTime(record.time)}</div>
                <div class="history-item-actions">
                    <button data-action="view" data-id="${record.id}">查看</button>
                    <button data-action="delete" data-id="${record.id}">删除</button>
                </div>
            </div>
        `;
    }

    _renderBatchItem(record) {
        // 批次渲染逻辑
        // ...
    }

    setData(records) {
        this.virtualList.setItems(records);
    }

    scrollToTop() {
        this.virtualList.scrollToIndex(0);
    }
}

// 全局实例
window.historyVirtualList = new HistoryVirtualList();
```

**Step 2: 修改 history.js**
```javascript
// 特性开关
const USE_VIRTUAL_SCROLL = true;

function renderHistoryList() {
    // ... 获取和过滤数据

    if (USE_VIRTUAL_SCROLL) {
        // 新方法：虚拟滚动
        if (!window.historyVirtualList) {
            window.historyVirtualList = new HistoryVirtualList();
            window.historyVirtualList.init('#history-list-container');
        }
        window.historyVirtualList.setData(filteredRecords);
    } else {
        // 旧方法：直接渲染
        const fragments = filteredRecords.map(r => renderHistoryItem(r));
        listDiv.innerHTML = fragments.join('');
    }
}
```

#### 挑战和解决方案

**挑战 1: 历史项高度不固定**
- 批次项和单项高度不同
- 文件名过长时会换行

**解决方案**:
```javascript
// 方案 A: 估算平均高度
const ITEM_HEIGHT = 120;  // 平均高度

// 方案 B: 动态高度（更复杂）
class DynamicHeightVirtualScroll {
    constructor() {
        this.itemHeights = new Map();  // 缓存每项的真实高度
        this.estimatedHeight = 120;
    }

    // 渲染后测量实际高度
    _measureHeights() {
        const items = this.content.querySelectorAll('.virtual-item');
        items.forEach((item, index) => {
            const height = item.offsetHeight;
            this.itemHeights.set(this.visibleStart + index, height);
        });
    }
}
```

**挑战 2: 搜索和过滤**
- 过滤后项目数量变化

**解决方案**:
```javascript
function filterAndRender(searchQuery) {
    const filteredRecords = allRecords.filter(r =>
        r.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    // 虚拟列表自动处理数据变化
    window.historyVirtualList.setData(filteredRecords);
}
```

**挑战 3: 批次展开/收起**
- 展开批次会改变列表长度

**解决方案**:
```javascript
function toggleBatch(batchId) {
    // 更新数据模型
    const batch = allRecords.find(r => r.batchId === batchId);
    batch.expanded = !batch.expanded;

    // 重新计算扁平化列表
    const flatRecords = flattenRecords(allRecords);

    // 更新虚拟列表
    window.historyVirtualList.setData(flatRecords);
}
```

#### 测试检查点
- [ ] 100 条记录渲染时间 < 100ms
- [ ] 滚动流畅（60 FPS）
- [ ] 搜索过滤正常
- [ ] 批次展开/收起正常
- [ ] 删除记录后列表正确更新
- [ ] 跳转到最新记录功能正常
- [ ] 不同屏幕尺寸下正常工作

#### 性能对比
```javascript
// 测试脚本
async function testVirtualScrollPerformance() {
    // 生成测试数据
    const testRecords = Array.from({ length: 500 }, (_, i) => ({
        id: `test-${i}`,
        name: `测试文档 ${i}.pdf`,
        time: new Date(Date.now() - i * 60000),
        // ...
    }));

    // 优化前
    console.time('传统渲染-500项');
    listDiv.innerHTML = testRecords.map(r => renderHistoryItem(r)).join('');
    console.timeEnd('传统渲染-500项');

    // 优化后
    console.time('虚拟滚动-500项');
    window.historyVirtualList.setData(testRecords);
    console.timeEnd('虚拟滚动-500项');
}
```

预期结果:
| 项目数 | 传统渲染 | 虚拟滚动 | 提升 |
|--------|----------|----------|------|
| 50     | 180ms    | 40ms     | 78%  |
| 100    | 450ms    | 45ms     | 90%  |
| 500    | 2300ms   | 50ms     | 98%  |

---

## 📊 性能监控和测试

### 自动化性能测试套件

创建 `tests/performance/performance-suite.js`:

```javascript
/**
 * 性能测试套件
 */
class PerformanceTestSuite {
    constructor() {
        this.results = [];
    }

    /**
     * 测试渲染性能
     */
    async testRenderPerformance(testName, renderFn, iterations = 10) {
        const times = [];

        for (let i = 0; i < iterations; i++) {
            const startTime = performance.now();
            await renderFn();
            const endTime = performance.now();
            times.push(endTime - startTime);
        }

        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        const min = Math.min(...times);
        const max = Math.max(...times);

        this.results.push({
            test: testName,
            avg: avg.toFixed(2),
            min: min.toFixed(2),
            max: max.toFixed(2),
            iterations
        });

        console.log(`[${testName}] 平均: ${avg.toFixed(2)}ms, 最小: ${min.toFixed(2)}ms, 最大: ${max.toFixed(2)}ms`);
    }

    /**
     * 测试内存占用
     */
    measureMemory(testName) {
        if (performance.memory) {
            const mb = (performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(2);
            console.log(`[${testName}] 内存占用: ${mb} MB`);
            this.results.push({
                test: testName,
                memory: `${mb} MB`
            });
        }
    }

    /**
     * 测试 FPS
     */
    async measureFPS(testName, actionFn, duration = 2000) {
        let frames = 0;
        let lastTime = performance.now();

        const measure = () => {
            frames++;
            const currentTime = performance.now();

            if (currentTime - lastTime >= duration) {
                const fps = frames / (duration / 1000);
                console.log(`[${testName}] FPS: ${fps.toFixed(2)}`);
                this.results.push({
                    test: testName,
                    fps: fps.toFixed(2)
                });
                return;
            }

            requestAnimationFrame(measure);
        };

        actionFn();  // 触发操作（如滚动）
        requestAnimationFrame(measure);

        await new Promise(resolve => setTimeout(resolve, duration + 100));
    }

    /**
     * 生成报告
     */
    generateReport() {
        console.table(this.results);
        return this.results;
    }
}

// 使用示例
const perfTest = new PerformanceTestSuite();

// 测试历史列表渲染
await perfTest.testRenderPerformance('历史列表-50项', async () => {
    await renderHistoryList(generate50Records());
});

await perfTest.testRenderPerformance('历史列表-100项', async () => {
    await renderHistoryList(generate100Records());
});

// 测试内存
perfTest.measureMemory('初始加载');
await loadChatMessages(100);
perfTest.measureMemory('加载100条消息后');

// 测试滚动 FPS
await perfTest.measureFPS('历史列表滚动', () => {
    // 模拟滚动
    const container = document.querySelector('#history-list');
    let scrollTop = 0;
    const scroll = () => {
        scrollTop += 10;
        container.scrollTop = scrollTop;
        if (scrollTop < 5000) requestAnimationFrame(scroll);
    };
    scroll();
}, 2000);

// 生成报告
perfTest.generateReport();
```

---

## 🔄 回滚计划

每个 Phase 都在独立分支上开发，便于回滚：

```bash
# 如果 Phase 1 出现问题
git checkout optimize/frontend-performance
git revert <phase1-merge-commit>

# 如果某个具体优化有问题
git checkout optimize/frontend-performance
git revert <specific-commit>
git push origin optimize/frontend-performance
```

### 回滚检查清单
- [ ] 确认问题严重性（是否需要立即回滚）
- [ ] 记录问题详情和复现步骤
- [ ] 执行回滚操作
- [ ] 验证回滚后功能正常
- [ ] 通知团队成员
- [ ] 分析问题原因，修复后重新部署

---

## ✅ 验收标准

### Phase 1 验收
- [ ] 所有单元测试通过
- [ ] 搜索输入防抖生效
- [ ] 定时器在页面隐藏时暂停
- [ ] 正则表达式提升后功能正常
- [ ] 无新增 bug

### Phase 2 验收
- [ ] LRU 缓存命中率 > 70%
- [ ] DOM 缓存使右键响应 < 50ms
- [ ] 内存占用稳定
- [ ] 所有批注功能正常

### Phase 3 验收
- [ ] 事件委托重构后所有交互正常
- [ ] 内存占用减少 > 30%
- [ ] 无事件监听器泄漏
- [ ] 性能测试套件全部通过

### Phase 4 验收
- [ ] 虚拟滚动流畅度 60 FPS
- [ ] 大列表（500+）渲染 < 100ms
- [ ] 搜索、过滤、批次操作正常
- [ ] 所有浏览器兼容

---

## 📝 开发日志

### 日志模板
```markdown
## [日期] Phase X - [功能名称]

### 实施内容
- 修改了 xxx.js 的 xxx 函数
- 添加了 xxx 工具类

### 测试结果
- ✅ 功能测试通过
- ✅ 性能测试：xxx 提升 xx%
- ⚠️ 发现问题：xxx

### 遗留问题
- [ ] 问题 1
- [ ] 问题 2

### 下一步
- 继续 xxx
```

---

## 🎯 总结

本优化计划采用**渐进式、可回滚、充分测试**的策略，预期在 2-3 周内完成所有优化，实现：

- **渲染性能**: 提升 70-90%
- **内存占用**: 减少 40-60%
- **交互流畅度**: 达到 60 FPS
- **用户体验**: 显著改善

所有优化都会保持代码可维护性和可读性，不会引入复杂的依赖。

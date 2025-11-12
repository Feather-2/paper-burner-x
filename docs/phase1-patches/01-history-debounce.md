# Phase 1.2: 历史记录搜索输入防抖优化

## 文件: js/history/history.js

### 修改 1: 添加防抖函数定义

**位置**: 文件头部，第 6 行后

**添加内容**:
```javascript
/**
 * 防抖函数 - 性能优化工具
 * 在事件触发后等待指定时间才执行，如果在等待期间再次触发则重新计时
 *
 * @param {Function} fn - 要执行的函数
 * @param {number} delay - 延迟时间（毫秒）
 * @returns {Function} 防抖后的函数
 */
function debounce(fn, delay) {
    let timer = null;
    return function debounced(...args) {
        const context = this;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            fn.apply(context, args);
        }, delay);
    };
}
```

### 修改 2: 创建防抖版本的 renderHistoryList

**位置**: 第 451 行 renderHistoryList 函数定义之前

**添加内容**:
```javascript
// 创建防抖版本的渲染函数（300ms 延迟）
let debouncedRenderHistoryList;
```

### 修改 3: 在 DOMContentLoaded 中初始化防抖函数

**位置**: renderHistoryList 函数定义之后

**添加内容**:
```javascript
// 初始化防抖版本
debouncedRenderHistoryList = debounce(renderHistoryList, 300);
```

### 修改 4: 更新搜索输入事件监听器

**位置**: 约第 353-356 行

**修改前**:
```javascript
historySearchInput.addEventListener('input', function(event) {
    historyUIState.searchQuery = event.target.value || '';
    renderHistoryList();
});
```

**修改后**:
```javascript
historySearchInput.addEventListener('input', function(event) {
    historyUIState.searchQuery = event.target.value || '';
    debouncedRenderHistoryList();
});
```

## 预期效果

- 用户快速输入时，只在停止输入 300ms 后才触发渲染
- 渲染次数减少 70-90%
- 输入流畅度明显提升

## 测试步骤

1. 打开历史记录页面
2. 在搜索框中快速输入 "test"（4 个字符）
3. 观察控制台或性能监控
4. 预期：只触发 1 次 renderHistoryList，而不是 4 次

## 回滚方案

如果出现问题，将修改 4 的代码改回原样即可。

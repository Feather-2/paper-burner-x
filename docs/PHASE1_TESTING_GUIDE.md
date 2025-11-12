# Phase 1 性能优化测试指南

> **完成日期**: 2025-11-12
> **优化项目**: 防抖、正则提升、定时器优化
> **状态**: ✅ 已完成实施，待测试验证

---

## 📦 已应用的优化

### ✅ 1. 历史记录搜索防抖 (history.js)
**文件**: `js/history/history.js` (+20 lines)
**修改内容**:
- 添加了防抖函数实现
- 创建了 `debouncedRenderHistoryList` (300ms 延迟)
- 替换了搜索输入事件处理器中的直接调用

**预期效果**:
- 快速输入时减少 70-90% 的渲染次数
- 用户输入流畅度提升
- CPU 占用降低

---

### ✅ 2. 正则表达式提升 (markdown_processor_ast.js)
**文件**: `js/processing/markdown_processor_ast.js` (+16 lines)
**修改内容**:
- 将 7 个正则表达式提升到模块级常量 `MATH_DELIMITER_PATTERNS`
- 使用 `Object.freeze()` 防止意外修改
- 避免函数调用时重复编译正则表达式

**预期效果**:
- 大文档处理速度提升 10-15%
- 减少正则编译开销（特别是在循环中）

---

### ✅ 3. 轮询定时器优化 (annotations_summary_modal.js)
**文件**: `js/annotations/annotations_summary_modal.js` (+36 lines)
**修改内容**:
- 将 `setInterval` 替换为可管理的定时器
- 添加页面可见性检测 (`document.hidden`)
- 添加页面卸载时的清理逻辑

**预期效果**:
- 页面隐藏时跳过执行，减少 50% 后台 CPU 占用
- 避免定时器泄漏

---

## 🧪 测试计划

### 测试 1: 历史记录搜索防抖

#### 测试步骤
1. 打开应用主页面
2. 点击"显示历史"按钮，打开历史记录面板
3. 在搜索框中快速输入文本（如 "test"，4 个字符）
4. 打开浏览器开发者工具 Console 面板

#### 验证方法 A: 控制台计数
在 Console 中运行以下代码来监控渲染次数：

```javascript
// 监控渲染次数
(function() {
    let renderCount = 0;
    const originalRender = window.renderHistoryList;

    if (typeof originalRender !== 'undefined') {
        // 包装原函数
        const originalFunc = originalRender.bind(window);
        window.renderHistoryList = function() {
            renderCount++;
            console.log(`[Render Count] 第 ${renderCount} 次渲染`);
            return originalFunc.apply(this, arguments);
        };
    }

    // 重置计数
    window.resetRenderCount = () => {
        renderCount = 0;
        console.log('[Render Count] 已重置');
    };

    console.log('[监控已启动] 现在可以测试搜索功能了');
})();
```

**预期结果**:
- 快速输入 "test" (4个字符)
- ✅ **优化后**: 只触发 **1 次**渲染（停止输入 300ms 后）
- ❌ **优化前**: 会触发 **4 次**渲染（每次按键一次）

#### 验证方法 B: Performance API
```javascript
// 使用 Performance API 测量
performance.clearMarks();
performance.clearMeasures();

// 在搜索框中输入，然后等待 500ms，在控制台运行：
const entries = performance.getEntriesByType('measure');
console.log('性能测量:', entries);
```

#### 边界情况测试
- [ ] 快速输入后立即删除文本
- [ ] 输入中文（IME 输入法）
- [ ] 粘贴长文本
- [ ] 连续快速搜索不同关键词

---

### 测试 2: 正则表达式提升

#### 测试步骤
1. 准备一个包含大量数学公式的测试文档（如学术论文 PDF）
2. 上传文档进行 OCR 和翻译处理
3. 使用 Performance API 测量处理时间

#### 验证方法: 性能对比
在 Console 中运行以下代码来测量正则处理性能：

```javascript
// 测试正则表达式性能
(function() {
    // 模拟包含数学公式的文本
    const testText = `
这是一个测试文本，包含多个数学公式：
$$ E = mc^2 $$
行内公式 $ x^2 + y^2 = z^2 $ 和另一个 $ a + b = c $
$$
\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}
$$
`.repeat(100); // 重复 100 次，模拟大文档

    // 查找 normalizeMathDelimiters 函数
    // 注意：这需要在处理文档时才能访问到该函数
    console.log('[测试] 请上传包含数学公式的文档进行处理');
    console.log('[测试] 在处理过程中，查看 Console 是否有性能日志');
})();
```

**手动测试步骤**:
1. 上传测试文档：`tests/fixtures/math-paper.pdf`（如果存在）
2. 开始处理
3. 观察 Console 输出的处理时间
4. 对比优化前后的时间差异

**预期结果**:
- ✅ 处理速度提升 **10-15%**（特别是包含大量公式的文档）
- ✅ Console 无错误信息
- ✅ 数学公式识别和格式化正确

#### 功能回归测试
使用现有的测试页面验证公式处理功能：

```bash
# 在浏览器中打开以下测试页面
start tests/test-formula-issues.html
start tests/test-katex-fixes.html
start tests/test-katex-errors.html
```

**验证点**:
- [ ] 行内公式 `$ ... $` 正确识别
- [ ] 块公式 `$$ ... $$` 正确识别
- [ ] OCR 错误修复功能正常（如 `$\$ ... \$` → `$$ ... $$`）
- [ ] 转义序列处理正确
- [ ] 无误将普通文本识别为公式

---

### 测试 3: 轮询定时器优化

#### 测试步骤
1. 打开应用主页面
2. 打开批注功能（需要有文档内容）
3. 打开浏览器任务管理器 (Shift + Esc)
4. 切换到另一个标签页

#### 验证方法 A: 任务管理器监控
```
步骤：
1. Chrome 任务管理器 (Shift + Esc)
2. 找到 Paper-Burner 标签页
3. 观察 CPU 占用

预期结果：
- 标签页可见时：CPU 0.5-2%（正常轮询）
- 标签页隐藏时：CPU 0% 或接近 0%（跳过执行）
```

#### 验证方法 B: Console 日志
在 Console 中运行以下代码来监控轮询行为：

```javascript
// 监控轮询执行
(function() {
    let callCount = 0;
    const startTime = Date.now();

    // 包装 checkForNewColors 函数
    if (typeof checkForNewColors !== 'undefined') {
        const original = checkForNewColors;
        checkForNewColors = function() {
            callCount++;
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const isHidden = document.hidden;
            console.log(`[Polling] ${elapsed}s - 第 ${callCount} 次调用 | 页面隐藏: ${isHidden}`);
            return original.apply(this, arguments);
        };
    }

    console.log('[监控已启动] 请切换标签页测试');
})();
```

**测试场景**:
1. 页面可见 10 秒 → 应该执行约 10 次
2. 切换到其他标签 10 秒 → 应该 **0 次**执行（或日志显示"页面隐藏: true"但跳过处理）
3. 切回标签 → 恢复执行

**预期结果**:
- ✅ 页面隐藏时，轮询函数内部的逻辑被跳过
- ✅ 页面显示时，轮询正常执行
- ✅ 关闭页面时，定时器被正确清理（无 console 错误）

#### 边界情况测试
- [ ] 打开多个 Paper-Burner 标签页，只有当前标签执行轮询
- [ ] 最小化浏览器窗口
- [ ] 电脑锁屏状态
- [ ] 长时间隐藏后切回（确保恢复正常）

---

## 🎯 性能基准测试

### 基准测试套件

创建性能测试脚本 `tests/performance/phase1-benchmark.html`:

```html
<!DOCTYPE html>
<html>
<head>
    <title>Phase 1 性能基准测试</title>
</head>
<body>
    <h1>Phase 1 性能基准测试</h1>
    <div id="results"></div>

    <script>
    // 测试 1: 防抖函数性能
    async function testDebounce() {
        console.log('=== 测试防抖函数 ===');

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

        let callCount = 0;
        const testFn = debounce(() => callCount++, 300);

        // 模拟快速输入
        const startTime = performance.now();
        for (let i = 0; i < 10; i++) {
            testFn();
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        // 等待防抖完成
        await new Promise(resolve => setTimeout(resolve, 400));
        const endTime = performance.now();

        console.log(`快速触发 10 次，实际执行: ${callCount} 次`);
        console.log(`耗时: ${(endTime - startTime).toFixed(2)}ms`);

        return {
            test: '防抖函数',
            triggers: 10,
            actualCalls: callCount,
            reduction: `${((1 - callCount / 10) * 100).toFixed(0)}%`,
            time: `${(endTime - startTime).toFixed(2)}ms`
        };
    }

    // 测试 2: 正则表达式性能
    async function testRegexPerformance() {
        console.log('=== 测试正则表达式性能 ===');

        const testText = '$$ E = mc^2 $$ 和 $ x + y $ '.repeat(1000);

        // 方法 1: 每次创建新正则（优化前）
        const start1 = performance.now();
        for (let i = 0; i < 100; i++) {
            testText.replace(/\$\$/g, '$$');
        }
        const end1 = performance.now();
        const time1 = end1 - start1;

        // 方法 2: 使用预编译正则（优化后）
        const regex = /\$\$/g;
        const start2 = performance.now();
        for (let i = 0; i < 100; i++) {
            regex.lastIndex = 0;
            testText.replace(regex, '$$');
        }
        const end2 = performance.now();
        const time2 = end2 - start2;

        console.log(`动态创建正则: ${time1.toFixed(2)}ms`);
        console.log(`预编译正则: ${time2.toFixed(2)}ms`);
        console.log(`性能提升: ${((1 - time2 / time1) * 100).toFixed(1)}%`);

        return {
            test: '正则表达式',
            dynamicTime: `${time1.toFixed(2)}ms`,
            precompiledTime: `${time2.toFixed(2)}ms`,
            improvement: `${((1 - time2 / time1) * 100).toFixed(1)}%`
        };
    }

    // 运行所有测试
    async function runAllTests() {
        const results = [];

        results.push(await testDebounce());
        results.push(await testRegexPerformance());

        // 显示结果
        const resultsDiv = document.getElementById('results');
        resultsDiv.innerHTML = '<h2>测试结果</h2>' +
            '<table border="1" cellpadding="10">' +
            '<tr><th>测试项</th><th>指标</th><th>结果</th></tr>' +
            results.map(r =>
                Object.entries(r).map(([key, value]) =>
                    `<tr><td>${r.test}</td><td>${key}</td><td>${value}</td></tr>`
                ).join('')
            ).join('') +
            '</table>';

        console.log('=== 测试完成 ===');
        console.table(results);
    }

    // 页面加载后自动运行
    window.addEventListener('load', runAllTests);
    </script>
</body>
</html>
```

### 运行基准测试

```bash
# 在浏览器中打开测试页面
start tests/performance/phase1-benchmark.html

# 或者在开发者工具 Console 中直接运行测试函数
```

---

## ✅ 验收标准

### Phase 1 完成的标准

- [x] **代码质量**
  - [x] 所有修改都有清晰的注释
  - [x] 代码风格一致
  - [x] 无语法错误
  - [x] 通过 ESLint/代码审查

- [ ] **功能测试**
  - [ ] 历史记录搜索功能正常
  - [ ] 数学公式处理功能正常
  - [ ] 批注颜色更新功能正常
  - [ ] 无新增 bug

- [ ] **性能测试**
  - [ ] 搜索防抖：渲染次数减少 > 70%
  - [ ] 正则提升：处理速度提升 > 10%
  - [ ] 定时器优化：后台 CPU 占用减少 > 50%

- [ ] **兼容性测试**
  - [ ] Chrome/Edge (Chromium)
  - [ ] Firefox
  - [ ] Safari (如适用)

- [ ] **文档**
  - [x] 优化计划文档完整
  - [x] 测试指南完整
  - [ ] 性能对比数据记录

---

## 🔄 回滚计划

如果测试发现问题，可以回滚特定文件：

```bash
# 回滚单个文件
git checkout HEAD -- js/history/history.js

# 回滚所有 Phase 1 修改
git checkout HEAD -- js/history/history.js
git checkout HEAD -- js/processing/markdown_processor_ast.js
git checkout HEAD -- js/annotations/annotations_summary_modal.js

# 或者回滚整个 commit（如果已经提交）
git revert <commit-hash>
```

---

## 📊 性能数据记录表

请在测试完成后填写实际测试数据：

| 优化项 | 测试场景 | 优化前 | 优化后 | 提升 | 测试人 | 测试日期 |
|--------|----------|--------|--------|------|--------|----------|
| 搜索防抖 | 快速输入4个字符 | ___次渲染 | ___次渲染 | ___%↓ | | |
| 搜索防抖 | 输入流畅度（主观） | ___ | ___ | | | |
| 正则提升 | 处理1000行文档 | ___ms | ___ms | ___%↓ | | |
| 正则提升 | 公式识别准确率 | ___% | ___% | | | |
| 定时器优化 | 页面隐藏 CPU 占用 | ___%  | ___% | ___%↓ | | |
| 定时器优化 | 多标签页内存占用 | ___MB | ___MB | ___%↓ | | |

---

## 📝 测试日志模板

```markdown
## 测试日志 - [日期]

### 测试人员
- 姓名：
- 环境：浏览器版本 / 操作系统

### 测试结果

#### 1. 历史记录搜索防抖
- [ ] 通过
- [ ] 失败
- 问题描述：
- 性能数据：

#### 2. 正则表达式提升
- [ ] 通过
- [ ] 失败
- 问题描述：
- 性能数据：

#### 3. 轮询定时器优化
- [ ] 通过
- [ ] 失败
- 问题描述：
- 性能数据：

### 总体评价
- [ ] 建议合并
- [ ] 需要修复后重测
- [ ] 建议回滚

### 备注


```

---

## 🚀 后续步骤

Phase 1 测试通过后：

1. ✅ 将优化合并到 `optimize/frontend-performance` 分支
2. ✅ 创建详细的性能对比报告
3. ➡️ 开始 **Phase 2: 中等风险优化**（LRU 缓存、DOM 缓存）
4. ➡️ 规划 Phase 3 和 Phase 4

---

**祝测试顺利！** 🎉

如有任何问题或发现bug，请及时记录并反馈。

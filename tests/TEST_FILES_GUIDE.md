# 📚 测试文件使用指南

本指南介绍所有测试页面和文档的用途、使用方法和推荐测试顺序。

> **📂 文件位置**: 所有测试文件和相关文档都位于 `tests/` 目录中

---

## 🎯 快速开始

### 推荐测试页面（按优先级排序）

1. **`test-table-fix-visual-comparison.html`** ⭐⭐⭐⭐⭐
   - **用途**: 直观对比修复前后的表格渲染效果
   - **特点**:
     - 美观的前后对比界面
     - 三层修复机制详细说明
     - 验证清单和下一步操作指南
   - **适用场景**: 首次验证修复效果，展示给团队成员

2. **`test-renderbatch-table-fix.html`** ⭐⭐⭐⭐⭐
   - **用途**: 完整模拟实际应用的 renderBatch 渲染流程
   - **特点**:
     - 模拟 `marked.lexer()` 词法分析
     - 展示三层修复机制的执行过程
     - 详细的处理日志和每个步骤的输出
   - **适用场景**: 深入调试渲染流程，验证修复逻辑

3. **`test-all-formula-fixes.html`** ⭐⭐⭐⭐
   - **用途**: 综合测试所有公式渲染修复
   - **特点**:
     - 测试表格中的公式
     - 花括号开头公式
     - LaTeX 命令自动修正
     - 字体嵌套错误修复
   - **适用场景**: 验证公式渲染是否正常工作

---

## 📋 表格渲染测试文件

### `test-table-rendering.html`
**功能**: 基础表格渲染测试

**测试内容**:
- ✅ 测试 1-3: 正常多行表格
- ✅ 测试 4: 复杂压缩表格（Block #31）
- ✅ 测试 5: 简单压缩表格

**如何使用**:
```bash
# 从项目根目录打开
start tests/test-table-rendering.html

# 或直接在浏览器中打开 tests/test-table-rendering.html
```

**期望结果**: 所有 5 个测试都应显示为 `<table>` 元素

---

### `test-compressed-table-fix.html`
**功能**: 压缩表格修复演示（带详细说明）

**特点**:
- 展示压缩表格的原始格式
- 显示修复后的多行格式
- 详细的修复步骤说明

**适用场景**: 理解压缩表格修复算法

---

### `test-table-debug.html`
**功能**: 调试压缩表格修复逻辑

**特点**:
- 显示分隔符检测过程
- 列数识别
- 表头和数据行提取步骤
- 详细的调试日志

**适用场景**: 深入调试表格修复算法

---

### `test-compressed-debug.html`
**功能**: 压缩表格修复调试（更详细版本）

**特点**:
- 手动模拟 `fixCompressedTables` 函数
- 逐步显示提取过程
- 管道符计数和位置跟踪

**适用场景**: 排查表格修复中的边界情况

---

## 🧪 诊断和调试文件

### `test-fix-diagnostic.html` ⭐⭐⭐⭐
**功能**: 诊断页面（显示完整修复日志）

**特点**:
- 拦截所有 console.log/warn/error
- 显示 MarkdownProcessorAST 的详细处理日志
- 性能指标追踪

**如何使用**:
```bash
start tests/test-fix-diagnostic.html
```

**期望输出**:
```
[MarkdownProcessorAST] 检测到可能的压缩表格，管道符: 55
[MarkdownProcessorAST] 表头管道符: 8 / 8
[MarkdownProcessorAST] ✓ 表头提取成功
[MarkdownProcessorAST] 提取到 5 行数据
[MarkdownProcessorAST] ✓ 压缩表格修复成功
```

---

## 🔬 公式渲染测试文件

### `test-formula-issues.html`
**功能**: 测试常见公式渲染问题

**测试内容**:
- 花括号开头公式: `${1.1}\mathrm{\;m}$`
- 多逗号公式
- 嵌套括号
- 特殊符号

---

### `test-brace-issue.html`
**功能**: 专门测试花括号公式

**测试案例**:
```latex
${1.1}\mathrm{\;m}$
${10^{-3}}$
$\{x, y, z\}$
```

---

### `test-double-dollar.html`
**功能**: 测试双美元符号公式（块级公式）

**测试案例**:
```latex
$$
E = mc^2
$$
```

---

### `test-inline-formula-fix.html`
**功能**: 测试行内公式修复

**特点**:
- 测试表格中的行内公式
- 图片标题中的公式
- 段落中的公式

---

### `test-specific-formulas.html`
**功能**: 测试特定的公式案例

**适用场景**: 添加用户报告的特定公式问题

---

## 📖 文档文件

### `TABLE_RENDERING_FIX_SUMMARY.md` ⭐⭐⭐⭐⭐
**内容**:
- 问题描述
- 解决方案详解
- 完整渲染流程
- 修复前后对比
- 文件清单
- 使用方法

**如何查看**:
```bash
# 在 VSCode 中打开
code TABLE_RENDERING_FIX_SUMMARY.md

# 或在浏览器中查看 Markdown 预览
```

---

### `TEST_FILES_GUIDE.md` （本文件）
**内容**: 所有测试文件的使用指南

---

## 🔧 核心修改文件

### 1. `js/processing/markdown_processor_ast.js`
**修改内容**:
- 添加 `fixCompressedTables()` 函数 (第 568-601 行)
- 添加 `splitCompressedTable()` 函数 (第 603-665 行)
- 修复 `extractRow()` 返回对象而非字符串 (第 648-670 行)
- 修复 `extractAllRows()` 使用正确位置追踪 (第 672-699 行)

**关键修复**:
```javascript
// 修复前（错误）
return text.substring(0, endIndex).trim(); // 位置信息丢失

// 修复后（正确）
return {
    row: text.substring(0, endIndex).trim(),
    endIndex: endIndex  // 保持原始位置
};
```

---

### 2. `js/processing/sub_block_segmenter.js`
**修改内容**:
- 第 64-70 行: 主分割函数添加表格检测
- 第 288-296 行: 公式感知分割函数添加表格检测

**关键代码**:
```javascript
const hasMarkdownTableSeparator = /\|(:?-+:?\|)+/.test(rawText);
if (hasMarkdownTableSeparator) {
    console.log('[SubBlockSegmenter] 跳过分块以保持表格完整性');
    return; // 直接返回，不分割
}
```

---

### 3. `js/history/history_detail_show_tab.js`
**修改内容**:
- 第 1525-1530 行: Token 类型检测与强制转换
- 第 1533-1541 行: 优先使用 AST 渲染器
- 第 1543-1558 行: 后验检查与重新渲染

**三层修复机制**:
```javascript
// 第一层：强制修正 token 类型
if (tokens[i].type === 'paragraph' && hasTableSyntax) {
    tokens[i].type = 'table';
}

// 第二层：使用 AST 渲染器
htmlStr = MarkdownProcessorAST.render(tokenRaw, data.images);

// 第三层：后验检查
if (hasTableSyntax && htmlStr.trim().startsWith('<p')) {
    htmlStr = MarkdownProcessorAST.render(tableMarkdown);
}
```

---

### 4. `js/processing/formula_post_processor.js`
**新增文件**: 公式后处理器

**功能**:
- 移除不完整的公式块
- 60+ LaTeX 命令自动修正
- 字体嵌套错误修复
- 表格/标题中的公式渲染

---

### 5. `views/history/history_detail.html`
**修改内容**:
- 第 389 行: 添加 `formula_post_processor.js` 脚本引用

---

## 🚀 测试流程建议

### 快速验证（5 分钟）
```bash
1. start tests/test-table-fix-visual-comparison.html
   → 查看前后对比，确认视觉效果

2. 刷新实际应用（Ctrl + Shift + R）
   → 验证 Block #31 是否正确渲染

3. 打开浏览器控制台（F12）
   → 检查是否有 [renderBatch] 相关日志
```

### 深入调试（15 分钟）
```bash
1. start tests/test-renderbatch-table-fix.html
   → 查看完整渲染流程和日志

2. start tests/test-fix-diagnostic.html
   → 查看 MarkdownProcessorAST 的处理日志

3. start tests/test-all-formula-fixes.html
   → 验证公式渲染是否正常

4. 检查实际应用中的特定 Block
   → 使用浏览器开发者工具查看 HTML 结构
```

### 完整测试（30 分钟）
```bash
1. 按顺序打开所有 test-*.html 文件
2. 验证每个测试用例都通过
3. 检查控制台是否有错误或警告
4. 在实际应用中测试多个文档
5. 验证不同类型的表格（简单、复杂、压缩、带公式）
6. 测试边界情况（空单元格、特殊字符、长文本）
```

---

## 📊 验证清单

### ✅ 表格渲染
- [ ] 压缩表格正确展开为多行格式
- [ ] 所有表格渲染为 `<table>` 而非 `<p>`
- [ ] 表格不被 sub-block 分割
- [ ] 表格样式显示正常（边框、表头背景色）
- [ ] 空单元格正确显示

### ✅ 公式渲染
- [ ] 花括号开头公式正确渲染
- [ ] 表格中的公式正确显示
- [ ] LaTeX 命令错误自动修正
- [ ] 字体嵌套问题解决
- [ ] 块级公式（$$...$$）正确渲染

### ✅ 性能
- [ ] 页面加载时间正常
- [ ] 批量渲染不阻塞 UI
- [ ] 控制台无性能警告

### ✅ 兼容性
- [ ] 旧版渲染器降级支持正常
- [ ] 没有破坏现有功能
- [ ] 所有测试页面都能正常打开

---

## 🐛 故障排除

### 问题：表格仍然显示为 `<p>` 标签

**解决步骤**:
1. 清除浏览器缓存（Ctrl + Shift + R）
2. 检查脚本加载顺序（参考 TABLE_RENDERING_FIX_SUMMARY.md）
3. 打开控制台查看是否有 JavaScript 错误
4. 验证 MarkdownProcessorAST 是否正确加载:
   ```javascript
   console.log(typeof MarkdownProcessorAST); // 应该输出 'object'
   ```

### 问题：表格被分割成多个 sub-block

**解决步骤**:
1. 检查 sub_block_segmenter.js 是否包含表格检测代码
2. 启用调试模式:
   ```javascript
   localStorage.setItem('ENABLE_SUBBLOCK_DEBUG', 'true');
   ```
3. 刷新页面，查看控制台日志
4. 应该看到: `[SubBlockSegmenter] 跳过分块以保持表格完整性`

### 问题：压缩表格没有展开

**解决步骤**:
1. 打开 test-compressed-debug.html 查看修复逻辑
2. 检查管道符数量是否 >= 10
3. 验证是否包含分隔符 `|---|---|...`
4. 查看 MarkdownProcessorAST.getMetrics() 的输出

### 问题：公式渲染失败

**解决步骤**:
1. 打开 test-all-formula-fixes.html 验证
2. 检查 formula_post_processor.js 是否加载
3. 查看控制台是否有 KaTeX 错误
4. 验证 FormulaPostProcessor 是否可用:
   ```javascript
   console.log(typeof FormulaPostProcessor); // 应该输出 'object'
   ```

---

## 💡 调试技巧

### 1. 启用详细日志
```javascript
// 在浏览器控制台执行
localStorage.setItem('ENABLE_SUBBLOCK_DEBUG', 'true');
```

### 2. 查看 MarkdownProcessorAST 指标
```javascript
// 在浏览器控制台执行
console.log(MarkdownProcessorAST.getMetrics());
```

### 3. 手动测试表格渲染
```javascript
// 在浏览器控制台执行
const testTable = '| A | B ||---|---|| 1 | 2 |';
const result = MarkdownProcessorAST.render(testTable);
console.log(result);
```

### 4. 检查 token 类型
```javascript
// 在浏览器控制台执行
const tokens = marked.lexer('| A | B |\n|---|---|\n| 1 | 2 |');
console.log(tokens[0].type); // 应该是 'table'
```

---

## 📞 支持和反馈

如果遇到问题：

1. **查看文档**: 先查看 `TABLE_RENDERING_FIX_SUMMARY.md`
2. **运行测试**: 使用本指南中的测试页面进行诊断
3. **检查日志**: 打开浏览器控制台查看详细日志
4. **对比代码**: 确认修改的文件内容与文档一致

---

## 🎉 总结

本次修复包含：
- **4 个核心文件修改**
- **1 个新增核心文件**
- **15 个测试页面**
- **2 个详细文档**

所有修复都已经过测试并验证通过！✅

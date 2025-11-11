# PDF Compare View 重构测试指南

本文档说明如何测试重构后的 PDF 对比功能。

## 📋 重构概况

已将 `history_pdf_compare.js` (2606行) 拆分为：
- **TextFitting.js** (~450行) - 文本自适应渲染
- **PDFExporter.js** (~450行) - PDF导出功能
- **SegmentManager.js** (~400行) - 长画布分段管理
- **主类** (~1300行) - 协调器和核心逻辑

## 🔧 测试前准备

### 1. 确保新模块已加载
在 `index.html` 或相关HTML文件中，在加载 `history_pdf_compare.js` **之前**添加：

```html
<!-- 加载新的模块 -->
<script src="js/history/modules/TextFitting.js"></script>
<script src="js/history/modules/PDFExporter.js"></script>
<script src="js/history/modules/SegmentManager.js"></script>

<!-- 加载主类 -->
<script src="js/history/history_pdf_compare.js"></script>
```

### 2. 清除浏览器缓存
重要！使用 Ctrl+Shift+R (或 Cmd+Shift+R) 强制刷新页面。

## ✅ 测试清单

### 测试1: PDF加载和显示
**目的**: 验证PDF能正常加载和显示

1. 打开应用并选择一个PDF文件
2. 等待PDF加载完成
3. **预期结果**:
   - ✅ 左侧显示原文PDF
   - ✅ 右侧显示翻译后的PDF
   - ✅ 页面滚动流畅，无白屏
   - ✅ 控制台无错误

### 测试2: 文本自适应渲染
**目的**: 验证 TextFitting.js 模块工作正常

1. 检查右侧翻译区域的文本显示
2. **预期结果**:
   - ✅ 文本完整显示在bbox框内
   - ✅ 字号自适应，未超出边界
   - ✅ 中文和英文换行正确
   - ✅ 数学公式(如有)正确渲染

**验证代码** (在浏览器控制台):
```javascript
// 检查 TextFittingAdapter 是否加载
console.log('TextFittingAdapter:', typeof TextFittingAdapter);

// 检查主类是否使用了模块
const view = window.pdfCompareView; // 假设实例保存在这里
console.log('使用TextFittingAdapter:', view.textFittingAdapter);
```

### 测试3: 长画布分段渲染
**目的**: 验证 SegmentManager.js 模块工作正常

1. 滚动PDF页面，从第一页滚动到最后一页
2. 快速滚动和慢速滚动都要测试
3. **预期结果**:
   - ✅ 滚动流畅，无卡顿
   - ✅ 页面内容按需加载(懒加载)
   - ✅ 所有页面都能正确显示
   - ✅ 内存占用稳定(查看任务管理器)

**验证代码**:
```javascript
// 检查 SegmentManager 是否加载
console.log('SegmentManager:', typeof SegmentManager);

// 检查分段信息
const view = window.pdfCompareView;
console.log('分段数量:', view.segmentManager?.segments?.length);
console.log('页面信息:', view.segmentManager?.pageInfos?.length);
```

### 测试4: PDF导出功能
**目的**: 验证 PDFExporter.js 模块工作正常

1. 点击"导出译文PDF"按钮
2. 等待PDF生成和下载
3. 打开下载的PDF文件
4. **预期结果**:
   - ✅ PDF成功下载
   - ✅ 译文文本正确显示在原文位置
   - ✅ 文本大小与Canvas显示一致
   - ✅ 文本未超出bbox边界
   - ✅ 中文字体正确显示

**验证代码**:
```javascript
// 检查 PDFExporter 是否加载
console.log('PDFExporter:', typeof PDFExporter);

// 手动触发导出(如果需要)
const view = window.pdfCompareView;
view.pdfExporter?.exportStructuredTranslation(
  view.originalPdfBase64,
  view.translatedContentList,
  showNotification
);
```

### 测试5: 交互功能
**目的**: 验证用户交互功能未受影响

1. 点击左侧PDF的文本块
2. **预期结果**:
   - ✅ 左侧bbox高亮
   - ✅ 右侧对应区域高亮
   - ✅ 高亮颜色正确(紫红色)

3. 测试滚动联动
4. **预期结果**:
   - ✅ 左右侧滚动保持同步
   - ✅ 滚动流畅无延迟

### 测试6: 内存泄漏检测
**目的**: 验证事件监听器正确清理

1. 打开浏览器开发者工具 → Performance → Memory
2. 加载PDF，滚动几次
3. 切换到其他页面或关闭PDF视图
4. 点击"Collect garbage"按钮
5. **预期结果**:
   - ✅ 内存使用量下降
   - ✅ 没有持续增长的内存占用

**验证代码**:
```javascript
// 检查事件监听器是否被清理
const view = window.pdfCompareView;
view.segmentManager?.destroy();

// 验证清理后的状态
console.log('Segments:', view.segmentManager?.segments?.length); // 应该为 0
console.log('Handlers:', view.segmentManager?._originalScrollHandler); // 应该为 null
```

## 🐛 常见问题排查

### 问题1: 控制台报错 "TextFittingAdapter is not defined"
**原因**: 模块未正确加载
**解决**:
1. 检查HTML中的script标签顺序
2. 确保模块文件路径正确
3. 清除浏览器缓存

### 问题2: 文本大小与预期不符
**原因**: PDF导出和Canvas渲染的公式不一致
**解决**:
1. 检查是否使用了最新的修复版本
2. 确认PDFExporter.js中的文本高度公式为 `mid * 1.2`

### 问题3: 滚动时内存持续增长
**原因**: 事件监听器未正确清理
**解决**:
1. 确认SegmentManager.js的destroy方法正确实现
2. 检查事件处理函数是否保存了引用

### 问题4: 页面加载缓慢或白屏
**原因**: 懒加载未生效
**解决**:
1. 检查SegmentManager的配置
2. 验证maxSegmentPixels设置是否合理

## 📊 性能对比

重构前后性能对比：

| 指标 | 重构前 | 重构后 | 改进 |
|------|--------|--------|------|
| 代码行数 | 2606行 | 1300行+1270行(模块) | 模块化 ✅ |
| 首次加载时间 | 测试中 | 测试中 | - |
| 滚动帧率 | 测试中 | 测试中 | - |
| 内存占用 | 测试中 | 测试中 | - |
| 导出时间 | 测试中 | 测试中 | - |

## 🔍 调试技巧

### 启用详细日志
在浏览器控制台运行：
```javascript
// 设置日志级别
localStorage.setItem('debug', 'true');
location.reload();
```

### 查看模块状态
```javascript
const view = window.pdfCompareView;

// 检查所有模块
console.log('TextFittingAdapter:', view.textFittingAdapter);
console.log('PDFExporter:', view.pdfExporter);
console.log('SegmentManager:', view.segmentManager);

// 查看缓存
console.log('Font cache size:', view.textFittingAdapter?.globalFontSizeCache?.size);
console.log('Formula cache size:', view.textFittingAdapter?._formulaCache?.size);
```

### 性能分析
```javascript
// 测量渲染时间
console.time('render-segment');
await view.segmentManager.renderSegment(view.segmentManager.segments[0]);
console.timeEnd('render-segment');

// 测量导出时间
console.time('export-pdf');
await view.pdfExporter.exportStructuredTranslation(...);
console.timeEnd('export-pdf');
```

## 📝 测试报告模板

完成测试后，请填写以下报告：

```markdown
## 测试环境
- 浏览器: [Chrome 120 / Firefox 121 / Safari 17]
- 操作系统: [Windows 11 / macOS 14 / Linux]
- PDF文件大小: [XX MB, XX页]
- 测试时间: [YYYY-MM-DD HH:MM]

## 测试结果
- [ ] 测试1: PDF加载和显示 - [通过/失败]
- [ ] 测试2: 文本自适应渲染 - [通过/失败]
- [ ] 测试3: 长画布分段渲染 - [通过/失败]
- [ ] 测试4: PDF导出功能 - [通过/失败]
- [ ] 测试5: 交互功能 - [通过/失败]
- [ ] 测试6: 内存泄漏检测 - [通过/失败]

## 发现的问题
1. [问题描述]
   - 重现步骤:
   - 预期结果:
   - 实际结果:
   - 控制台错误:

## 总体评价
- 功能完整性: [0-100%]
- 性能表现: [优秀/良好/一般/较差]
- 稳定性: [优秀/良好/一般/较差]
- 建议:
```

## 🚀 回滚方案

如果测试发现严重问题，可以快速回滚到原始版本：

```bash
# 查看最近的提交
git log --oneline -5

# 回滚到重构前的版本
git checkout <commit-hash> -- js/history/history_pdf_compare.js

# 或者切换到main分支
git checkout main
```

## 📞 支持

如有问题，请：
1. 查看浏览器控制台的详细错误信息
2. 检查本文档的"常见问题排查"部分
3. 提供完整的测试报告和错误日志

---

**测试重点**: 确保重构后的功能与原始版本**完全一致**，无功能退化。

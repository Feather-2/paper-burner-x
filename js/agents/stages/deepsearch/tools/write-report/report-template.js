/**
 * Report template for write-report tool.
 */
const REPORT_TEMPLATE = `
## 报告结构要求

### 必需章节
1. **摘要** (100-200字)
   - 研究目标
   - 核心发现（1-3句）
   - 主要结论

2. **核心发现** (按重要性排序)
   - 每个发现必须有证据引用 [来源:页码]
   - 标注置信度：高(多源印证)/中(单源)/低(推测)
   - 区分事实和观点

3. **共识与分歧** (wider/deeper 必需)
   - 不同来源的一致观点
   - 存在分歧的观点及原因分析
   - 矛盾点的处理说明

4. **信息缺口** (必需)
   - 文档未覆盖的关键问题
   - 需要进一步调查的领域
   - 数据不足的地方

5. **结论与建议**
   - 基于发现的结论
   - 可操作的下一步建议
   - 研究局限性说明

### 学术规范
- 每个结论必须有证据支撑
- 推测性内容必须标注
- 使用 [来源:页码] 格式引用
- 置信度标注：🟢高 🟡中 🔴低
`;

export function renderReportTemplate() {
  return REPORT_TEMPLATE;
}

export { REPORT_TEMPLATE };

export default {
  REPORT_TEMPLATE,
  renderReportTemplate,
};

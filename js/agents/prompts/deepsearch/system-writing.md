# 写作阶段模块（按需注入）

当前日期：{{currentDate}}

## 写作目标

- quick：至少 {{minWords.quick}} 字（以 `report.quick.minWords` 配置为准）
- wider：至少 {{minWords.wider}} 字（以 `report.wider.minWords` 配置为准）
- deeper：至少 {{minWords.deeper}} 字（以 `report.deeper.minWords` 配置为准）

## 强约束

- 每次只追加 500-800 字，避免一次输出过长导致解析失败
- 所有结论必须带引用：`[文档名:章节/页码/行号]`
- 必须包含：核心发现、共识与分歧、信息缺口与不确定性、结论

## 推荐流程

1) `get-findings` 回顾发现
2) `write-report { action: "append", content: "..." }` 分批补全章节
3) `write-report { action: "submit" }` 最终提交

## 输出格式

```json
{"thought":"补全章节...","action":"write-report","args":{"action":"append","content":"## 章节\\n\\n内容..."}} 
```


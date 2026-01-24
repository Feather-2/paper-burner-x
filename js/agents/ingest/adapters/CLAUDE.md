# adapters (ingest) - 文档适配器

多格式文档解析适配器。

## 最近变更

- **AudioAdapter**: 增加 `maxFileSize`（默认 50MB）与 `fileLikeFromPath`（Node 环境）支持，降低超大音频导致的内存/费用风险
- **AudioAdapter**: 增强 Whisper API 兼容性（自动适配 `transcribe` / `transcribeAudio`），并统一 segment 时间字段（ms/us/sec → sec）
- **BaseAdapter**: 增加输入流归一化（AsyncIterable / Iterable / Web ReadableStream → AsyncIterable），并新增 `safeDocId` 辅助函数
- **BaseAdapter._validateChunks**: 允许省略 options 参数，避免未传入时的解构错误

## 适配器列表

| 适配器 | 文件 | 支持格式 |
|--------|------|----------|
| BaseAdapter | `base.js` | 基类 |
| PdfAdapter | `pdf.js` | PDF |
| DocxAdapter | `docx.js` | Word (.docx) |
| PptxAdapter | `pptx.js` | PowerPoint (.pptx) |
| HtmlAdapter | `html.js` | HTML |
| MarkdownAdapter | `markdown.js` | Markdown |
| EpubAdapter | `epub.js` | 电子书 (.epub) |
| AudioAdapter | `audio.js` | 音频 (Whisper) |
| VideoAdapter | `video.js` | 视频 (帧+音频) |
| CodeAdapter | `code.js` | 代码文件 |
| RawTextAdapter | `raw-text.js` | 纯文本 |
| HistoryAdapter | `history.js` | 对话历史 |

## 扩展适配器

```javascript
import { BaseAdapter } from 'js/agents/ingest/adapters/base.js';

class CustomAdapter extends BaseAdapter {
  static mimeTypes = ['application/x-custom'];
  static extensions = ['.custom'];

  async parse(buffer, options) {
    const text = await this.decode(buffer);
    return {
      markdown: this.toMarkdown(text),
      assets: [],
      metadata: { format: 'custom' },
    };
  }
}
```

## 适配器选择

```javascript
import { IngestStage } from 'js/agents/ingest';

const stage = new IngestStage();
const adapter = stage.selectAdapter('application/pdf');
// → PdfAdapter
```

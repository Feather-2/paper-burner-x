# ingest - 文档摄取

多格式文档解析和资产提取，支持 PDF、Office、音视频等。

## 核心文件

| 文件 | 职责 |
|------|------|
| `ingest-stage.js` | IngestStage 主流程 |
| `asset-manager.js` | 资产（图片/表格）管理 |
| `asset-understanding.js` | 资产理解（OCR/描述） |
| `chunked-loader.js` | 分块加载大文件 |
| `extract-assets.js` | 从 Markdown 提取资产 |
| `constants.js` | 常量定义 |

## 适配器 (adapters/)

| 适配器 | 支持格式 |
|--------|----------|
| `pdf.js` | PDF 文档 |
| `docx.js` | Word 文档 (.docx) |
| `pptx.js` | PowerPoint (.pptx) |
| `html.js` | HTML 网页 |
| `markdown.js` | Markdown |
| `epub.js` | 电子书 (.epub) |
| `audio.js` | 音频 (需 Whisper) |
| `video.js` | 视频 (帧提取 + 音频) |
| `code.js` | 代码文件 |
| `raw-text.js` | 纯文本 |
| `history.js` | 对话历史 |
| `base.js` | BaseAdapter 基类 |

## 使用示例

```javascript
import { IngestStage, PdfAdapter, AssetManager } from 'js/agents/ingest';

const stage = new IngestStage({
  adapters: [new PdfAdapter()],
  assetManager: new AssetManager(),
});

const result = await stage.process(fileBuffer, { type: 'application/pdf' });
// → { markdown, assets, metadata }
```

## 扩展适配器

```javascript
import { BaseAdapter } from 'js/agents/ingest';

class CustomAdapter extends BaseAdapter {
  static mimeTypes = ['application/x-custom'];

  async parse(buffer, options) {
    // 返回 { markdown, assets }
  }
}
```

本目录用于存放本地化的第三方前端依赖（替代 CDN）。

建议使用仓库根目录的脚本 `scripts/fetch-vendors.sh` 一键下载所需版本。

包含（版本建议）：
- tailwindcdn.js（来自 https://cdn.tailwindcss.com）
- axios@1.x（axios.min.js）
- chart.js@4.x（chart.umd.min.js）
- iconify-icon@2.x（iconify-icon.min.js）
- js-base64@3.7.5（base64.min.js）
- file-saver@2.0.5（FileSaver.min.js）
- jszip@3.10.1（jszip.min.js）
- docx-preview@0.3.7（docx-preview.min.js）
- katex@0.16.9（katex.min.css、katex.min.js）
- marked@^11（marked.min.js）
- animejs@3.2.1（anime.min.js）
- mammoth@1.4.21（mammoth.browser.min.js）
- turndown@7.1.2（turndown.min.js）
- pdfjs-dist@3.11.174（pdf.min.js、pdf.worker.min.js）
- html2pdf.js@0.10.1（html2pdf.bundle.min.js）
- mermaid@10.9.0（mermaid.min.js）

下载完成后，对应页面会优先加载本地文件，避免 CSP/杀软拦截与离线不可用问题。

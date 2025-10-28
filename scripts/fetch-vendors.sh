#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR_DIR="$BASE_DIR/public/vendor"

mkdir -p "$VENDOR_DIR" \
  "$VENDOR_DIR/tailwindcss" \
  "$VENDOR_DIR/axios" \
  "$VENDOR_DIR/chart.js" \
  "$VENDOR_DIR/iconify" \
  "$VENDOR_DIR/js-base64" \
  "$VENDOR_DIR/file-saver" \
  "$VENDOR_DIR/jszip" \
  "$VENDOR_DIR/docx-preview" \
  "$VENDOR_DIR/katex" \
  "$VENDOR_DIR/marked" \
  "$VENDOR_DIR/animejs" \
  "$VENDOR_DIR/mammoth" \
  "$VENDOR_DIR/turndown" \
  "$VENDOR_DIR/pdfjs" \
  "$VENDOR_DIR/html2pdf" \
  "$VENDOR_DIR/mermaid"

echo "Downloading vendor assets into: $VENDOR_DIR"

curl -fsSL https://cdn.tailwindcss.com -o "$VENDOR_DIR/tailwindcss/tailwindcdn.js"
curl -fsSL https://cdn.jsdelivr.net/npm/axios/dist/axios.min.js -o "$VENDOR_DIR/axios/axios.min.js"
curl -fsSL https://cdn.jsdelivr.net/npm/chart.js/dist/chart.umd.min.js -o "$VENDOR_DIR/chart.js/chart.umd.min.js"
curl -fsSL https://gcore.jsdelivr.net/npm/iconify-icon@2.0.0/dist/iconify-icon.min.js -o "$VENDOR_DIR/iconify/iconify-icon.min.js"
curl -fsSL https://gcore.jsdelivr.net/npm/js-base64@3.7.5/base64.min.js -o "$VENDOR_DIR/js-base64/base64.min.js"
curl -fsSL https://gcore.jsdelivr.net/npm/file-saver@2.0.5/dist/FileSaver.min.js -o "$VENDOR_DIR/file-saver/FileSaver.min.js"
curl -fsSL https://gcore.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js -o "$VENDOR_DIR/jszip/jszip.min.js"
curl -fsSL https://gcore.jsdelivr.net/npm/docx-preview@0.3.7/dist/docx-preview.min.js -o "$VENDOR_DIR/docx-preview/docx-preview.min.js"
curl -fsSL https://gcore.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css -o "$VENDOR_DIR/katex/katex.min.css"
curl -fsSL https://gcore.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js -o "$VENDOR_DIR/katex/katex.min.js"
curl -fsSL https://gcore.jsdelivr.net/npm/marked/marked.min.js -o "$VENDOR_DIR/marked/marked.min.js"
curl -fsSL https://cdnjs.cloudflare.com/ajax/libs/animejs/3.2.1/anime.min.js -o "$VENDOR_DIR/animejs/anime.min.js"
curl -fsSL https://gcore.jsdelivr.net/npm/mammoth@1.4.21/mammoth.browser.min.js -o "$VENDOR_DIR/mammoth/mammoth.browser.min.js"
curl -fsSL https://gcore.jsdelivr.net/npm/turndown@7.1.2/dist/turndown.min.js -o "$VENDOR_DIR/turndown/turndown.min.js"
curl -fsSL https://gcore.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js -o "$VENDOR_DIR/pdfjs/pdf.min.js"
curl -fsSL https://gcore.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js -o "$VENDOR_DIR/pdfjs/pdf.worker.min.js"
curl -fsSL https://gcore.jsdelivr.net/npm/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js -o "$VENDOR_DIR/html2pdf/html2pdf.bundle.min.js"
curl -fsSL https://gcore.jsdelivr.net/npm/mermaid@10.9.0/dist/mermaid.min.js -o "$VENDOR_DIR/mermaid/mermaid.min.js"

echo "Done."

(()=>{
  window.PPTDashboard = window.PPTDashboard || {};
  const NS = window.PPTDashboard;
  NS.paste = NS.paste || {};
  Object.assign(NS.paste, {
    openPasteDocumentModal() {
        const modalId = 'pptPasteDocumentModal';
        const existing = document.getElementById(modalId);
        if (existing) {
            existing.classList.add('open');
            return;
        }

        const overlay = document.createElement('div');
        overlay.id = modalId;
        overlay.className = 'ppt-modal-overlay open';
        overlay.innerHTML = `
            <div class="ppt-modal" style="width: min(900px, 90vw); max-height: 80vh; display: flex; flex-direction: column;">
                <div class="ppt-modal-header">
                    <div class="ppt-modal-title" id="pptPasteDocumentModalTitle">粘贴文档内容</div>
                    <button class="ppt-modal-close" onclick="window.PPTGenerator.closePasteDocumentModal()" aria-label="关闭">
                        <iconify-icon icon="carbon:close"></iconify-icon>
                    </button>
                </div>
                <div class="ppt-modal-body" style="flex: 1; min-height: 0;">
                    <div id="pasteDocumentEditor" style="min-height: 360px;"></div>
                    <div id="pasteDocumentFallback" style="display: none;">
                        <textarea id="pasteDocumentTextarea" class="ppt-input-field" style="width: 100%; min-height: 360px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; line-height: 1.5;" placeholder="在此粘贴 Markdown/纯文本内容..."></textarea>
                    </div>
                </div>
                <div class="ppt-modal-footer">
                    <button class="ppt-btn-secondary" onclick="window.PPTGenerator.closePasteDocumentModal()">取消</button>
                    <button class="ppt-btn-primary" onclick="window.PPTGenerator.confirmPasteDocument()">
                        <iconify-icon icon="carbon:rocket"></iconify-icon> 开始生成
                    </button>
                </div>
            </div>
        `;

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.closePasteDocumentModal();
        });

        this._pasteDocumentModalKeyHandler = (e) => {
            if (e.key === 'Escape') this.closePasteDocumentModal();
        };
        document.addEventListener('keydown', this._pasteDocumentModalKeyHandler);

        const host = this.elements?.overlay || document.body;
        host.appendChild(overlay);

        this._pasteDocumentModalTimer = setTimeout(() => {
            const fallback = document.getElementById('pasteDocumentFallback');
            const textarea = document.getElementById('pasteDocumentTextarea');

            if (typeof VditorAdapter !== 'undefined' && VditorAdapter.isAvailable()) {
                const mounted = VditorAdapter.mount({
                    container: 'pasteDocumentEditor',
                    value: '',
                    onInput: () => {},
                    mode: 'ir'
                });
                if (mounted) {
                    if (fallback) fallback.style.display = 'none';
                } else if (fallback && textarea) {
                    fallback.style.display = 'block';
                    textarea.focus?.();
                }
            } else if (fallback && textarea) {
                fallback.style.display = 'block';
                textarea.focus?.();
            }
        }, 100);
    },


    closePasteDocumentModal() {
        if (this._pasteDocumentModalTimer) {
            clearTimeout(this._pasteDocumentModalTimer);
            this._pasteDocumentModalTimer = null;
        }

        if (this._pasteDocumentModalKeyHandler) {
            document.removeEventListener('keydown', this._pasteDocumentModalKeyHandler);
            this._pasteDocumentModalKeyHandler = null;
        }

        if (typeof VditorAdapter !== 'undefined') {
            try {
                VditorAdapter.destroy();
            } catch (e) {
                // ignore
            }
        }

        const modal = document.getElementById('pptPasteDocumentModal');
        if (modal) {
            modal.classList.remove('open');
            setTimeout(() => modal.remove(), 300);
        }
    },


    confirmPasteDocument() {
        let content = '';

        if (typeof VditorAdapter !== 'undefined' && VditorAdapter.isAvailable()) {
            content = VditorAdapter.getValue();
        } else {
            content = document.getElementById('pasteDocumentTextarea')?.value || '';
        }

        if (typeof this.startFromPastedText === 'function') {
            this.startFromPastedText(content);
        } else {
            console.warn('[PPTGenerator] startFromPastedText() not implemented yet (Task 4).');
        }

        this.closePasteDocumentModal();
    },
  });
})();


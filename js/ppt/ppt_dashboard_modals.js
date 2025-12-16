(()=>{
  window.PPTDashboard = window.PPTDashboard || {};
  const NS = window.PPTDashboard;
  NS.modals = NS.modals || {};
  Object.assign(NS.modals, {
    _getModalHost() {
        return this.elements?.overlay || document.getElementById('pptGeneratorOverlay') || document.body;
    },

    _closeModalById(modalId) {
        const el = document.getElementById(modalId);
        if (!el) return;
        el.classList.remove('open');
        setTimeout(() => el.remove(), 280);
    },

    _openOrCreateModal({ id, className = '', titleHtml = '', bodyHtml = '', footerHtml = '', onMount } = {}) {
        if (!id) return null;
        let overlay = document.getElementById(id);
        if (overlay) {
            overlay.classList.add('open');
            try { onMount?.(overlay); } catch { /* ignore */ }
            return overlay;
        }

        overlay = document.createElement('div');
        overlay.id = id;
        overlay.className = `ppt-modal-overlay open ${className}`.trim();
        overlay.innerHTML = `
            <div class="ppt-modal">
                <div class="ppt-modal-header">
                    <div class="ppt-modal-title">${titleHtml}</div>
                    <button class="ppt-modal-close" aria-label="关闭" onclick="document.getElementById('${id}')?.classList.remove('open')">
                        <iconify-icon icon="carbon:close"></iconify-icon>
                    </button>
                </div>
                <div class="ppt-modal-body">${bodyHtml}</div>
                ${footerHtml ? `<div class="ppt-modal-footer">${footerHtml}</div>` : ''}
            </div>
        `;

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.classList.remove('open');
        });

        const host = this._getModalHost();
        host.appendChild(overlay);
        try { onMount?.(overlay); } catch { /* ignore */ }
        return overlay;
    },

    confirmDialog({ title = '确认', message = '确定继续？', confirmText = '确认', cancelText = '取消' } = {}) {
        return new Promise((resolve) => {
            const id = `pptConfirmModal_${Date.now()}_${Math.random().toString(16).slice(2)}`;
            const footer = `
                <button class="ppt-btn ppt-btn-secondary" onclick="window.PPTGenerator._closeModalById('${id}')">${this._escapeHtml?.(cancelText) ?? cancelText}</button>
                <button class="ppt-btn ppt-btn-primary" onclick="window.PPTGenerator._resolveConfirm('${id}', true)">${this._escapeHtml?.(confirmText) ?? confirmText}</button>
            `;

            this._resolveConfirm = (modalId, ok) => {
                try { this._closeModalById(modalId); } catch { /* ignore */ }
                resolve(Boolean(ok));
            };

            this._openOrCreateModal({
                id,
                className: 'ppt-confirm-modal',
                titleHtml: this._escapeHtml?.(title) ?? title,
                bodyHtml: `<div style=\"padding: 4px 0; line-height: 1.6;\">${this._escapeHtml?.(message) ?? message}</div>`,
                footerHtml: footer,
            });
        });
    },
  });
})();

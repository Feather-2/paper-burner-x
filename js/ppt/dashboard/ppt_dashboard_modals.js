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

    _openOrCreateModal({ id, className = '', titleHtml = '', bodyHtml = '', footerHtml = '', onMount, actions } = {}) {
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
                    <button class="ppt-modal-close" aria-label="关闭" data-action="closeModal" data-modal-id="${id}">
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
        if (window.PPTUIActions?.bindActions) {
            const mergedActions = {
                closeModal: () => this._closeModalById(id),
                ...(actions && typeof actions === 'object' ? actions : {}),
            };
            window.PPTUIActions.bindActions(overlay, mergedActions);
        }
        try { onMount?.(overlay); } catch { /* ignore */ }
        return overlay;
    },

    confirmDialog({ title = '确认', message = '确定继续？', confirmText = '确认', cancelText = '取消' } = {}) {
        return new Promise((resolve) => {
            const id = `pptConfirmModal_${Date.now()}_${Math.random().toString(16).slice(2)}`;
            const footer = `
                <button class="ppt-btn ppt-btn-secondary" data-action="resolveConfirm" data-ok="false">${this._escapeHtml?.(cancelText) ?? cancelText}</button>
                <button class="ppt-btn ppt-btn-primary" data-action="resolveConfirm" data-ok="true">${this._escapeHtml?.(confirmText) ?? confirmText}</button>
            `;

            const handleResolve = (ok) => {
                try { this._closeModalById(id); } catch { /* ignore */ }
                resolve(Boolean(ok));
            };

            this._openOrCreateModal({
                id,
                className: 'ppt-confirm-modal',
                titleHtml: this._escapeHtml?.(title) ?? title,
                bodyHtml: `<div style=\"padding: 4px 0; line-height: 1.6;\">${this._escapeHtml?.(message) ?? message}</div>`,
                footerHtml: footer,
                actions: {
                    resolveConfirm: ({ payload }) => handleResolve(payload.ok),
                },
            });
        });
    },
  });
})();

// ESM 导出

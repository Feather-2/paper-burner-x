// ESM 导入核心类以确保 mixin 安装时类已存在
import PPTGeneratorCtor from './ppt_generator_core.js';

const PPTGeneratorDeletion = {
    confirmDeleteProject(id) {
        console.log('[Deletion] confirmDeleteProject called with id:', id);
        this.projectToDelete = id;
        this.deleteStep = 1;
        this._renderDeleteModal();
    },

    _renderDeleteModal() {
        let modal = document.getElementById('pptDeleteModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'pptDeleteModal';
            modal.className = 'ppt-modal-overlay';
            document.body.appendChild(modal);
        }

        // Bind events once (event delegation).
        if (!modal.__pptDeleteModalBound) {
            modal.__pptDeleteModalBound = true;
            modal.addEventListener('click', (event) => {
                if (event.target === modal) {
                    this.closeDeleteModal();
                    return;
                }
                const actionEl = event.target.closest('[data-delete-action]');
                if (!actionEl) return;
                event.preventDefault();
                const action = actionEl.getAttribute('data-delete-action');
                if (action === 'close') {
                    this.closeDeleteModal();
                } else if (action === 'advance') {
                    this.advanceDeleteStep();
                } else if (action === 'execute') {
                    this.executeDelete();
                }
            });
        }

        const btnBase = 'padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s;';
        const btnSecondary = `${btnBase} background: #f3f4f6; border: 1px solid #e5e7eb; color: #374151;`;
        const btnDanger = `${btnBase} background: #ef4444; border: none; color: white;`;
        const btnDisabled = `${btnBase} background: #fca5a5; border: none; color: white; cursor: not-allowed;`;
        const inputStyle = 'width: 100%; padding: 12px 16px; border: 1px solid #e5e7eb; border-radius: 8px; font-size: 14px; margin-top: 12px; outline: none;';

        let content = '';
        if (this.deleteStep === 1) {
            content = `
                <div class="ppt-modal" style="min-width: 400px;">
                    <div class="ppt-modal-header">
                        <h3 style="margin: 0; font-size: 18px; display: flex; align-items: center; gap: 8px;">
                            <iconify-icon icon="carbon:warning-alt" style="color: #f59e0b; font-size: 24px;"></iconify-icon>
                            确认删除
                        </h3>
                    </div>
                    <div class="ppt-modal-body">
	                        <p style="margin: 0; color: #6b7280;">您确定要删除此项目吗？此操作不可恢复。</p>
	                    </div>
	                    <div class="ppt-modal-footer">
	                        <button type="button" style="${btnSecondary}" data-delete-action="close">取消</button>
	                        <button type="button" style="${btnDanger}" data-delete-action="advance">继续删除</button>
	                    </div>
	                </div>
	            `;
	        } else if (this.deleteStep === 2) {
	            content = `
                <div class="ppt-modal" style="min-width: 400px;">
                    <div class="ppt-modal-header">
                        <h3 style="margin: 0; font-size: 18px; display: flex; align-items: center; gap: 8px;">
                            <iconify-icon icon="carbon:warning-filled" style="color: #ef4444; font-size: 24px;"></iconify-icon>
                            最终确认
                        </h3>
                    </div>
                    <div class="ppt-modal-body">
	                        <p style="margin: 0; color: #6b7280;">请输入 <strong>"确认删除"</strong> 以永久删除此项目。</p>
	                        <input type="text" id="pptDeleteConfirmInput" style="${inputStyle}" placeholder="输入: 确认删除">
	                    </div>
	                    <div class="ppt-modal-footer">
	                        <button type="button" style="${btnSecondary}" data-delete-action="close">取消</button>
	                        <button type="button" style="${btnDisabled}" id="pptFinalDeleteBtn" disabled data-delete-action="execute">永久删除</button>
	                    </div>
	                </div>
	            `;
	        }

        modal.innerHTML = content;
        modal.classList.add('open');

        if (this.deleteStep === 2) {
            const input = document.getElementById('pptDeleteConfirmInput');
            const btn = document.getElementById('pptFinalDeleteBtn');
            const enabledStyle = 'padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s; background: #ef4444; border: none; color: white;';
            const disabledStyle = 'padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: not-allowed; transition: all 0.2s; background: #fca5a5; border: none; color: white;';
            input.addEventListener('input', (e) => {
                const match = e.target.value === '确认删除';
                btn.disabled = !match;
                btn.style.cssText = match ? enabledStyle : disabledStyle;
            });
            input.focus();
        }
    },

    advanceDeleteStep() {
        this.deleteStep = 2;
        this._renderDeleteModal();
    },

    closeDeleteModal() {
        const modal = document.getElementById('pptDeleteModal');
        if (modal) {
            modal.classList.remove('open');
            setTimeout(() => modal.remove(), 300); // Allow for fade out
        }
        this.projectToDelete = null;
        this.deleteStep = 0;
    },

    async executeDelete() {
        if (this.projectToDelete && window.pptStorage) {
            await window.pptStorage.deleteProject(this.projectToDelete);
            this.closeDeleteModal();
            this.showProjectList(); // Refresh list
        }
    }
};

// Mixin install (legacy scripts + ESM entrypoints).
(() => {
    try {
        const g = (typeof globalThis !== 'undefined') ? globalThis : null;
        const w = (typeof window !== 'undefined') ? window : null;
        const ctor =
            (g && g.PPTGenerator?.prototype) ? g.PPTGenerator :
            (w && w.PPTGenerator?.prototype) ? w.PPTGenerator :
            (g && g.PPTGeneratorCtor?.prototype) ? g.PPTGeneratorCtor :
            (w && w.PPTGeneratorCtor?.prototype) ? w.PPTGeneratorCtor :
            (PPTGeneratorCtor?.prototype) ? PPTGeneratorCtor :
            null;

        if (!ctor?.prototype) return;
        Object.assign(ctor.prototype, PPTGeneratorDeletion);
    } catch {
        // ignore
    }
})();

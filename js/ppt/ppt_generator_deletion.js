const PPTGeneratorDeletion = {
    confirmDeleteProject(id) {
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

        let content = '';
        if (this.deleteStep === 1) {
            content = `
                <div class="ppt-modal-card">
                    <div class="ppt-modal-header">
                        <h3><iconify-icon icon="carbon:warning-alt" style="color: var(--ppt-warning)"></iconify-icon> 确认删除</h3>
                    </div>
                    <div class="ppt-modal-body">
                        <p>您确定要删除此项目吗？此操作不可恢复。</p>
                    </div>
                    <div class="ppt-modal-footer">
                        <button class="ppt-btn-secondary" onclick="window.PPTGenerator.closeDeleteModal()">取消</button>
                        <button class="ppt-btn-danger" onclick="window.PPTGenerator.advanceDeleteStep()">继续删除</button>
                    </div>
                </div>
            `;
        } else if (this.deleteStep === 2) {
            content = `
                <div class="ppt-modal-card">
                    <div class="ppt-modal-header">
                        <h3><iconify-icon icon="carbon:warning-filled" style="color: #ef4444"></iconify-icon> 最终确认</h3>
                    </div>
                    <div class="ppt-modal-body">
                        <p>请输入 <strong>"确认删除"</strong> 以永久删除此项目。</p>
                        <input type="text" id="pptDeleteConfirmInput" class="ppt-input-field" placeholder="确认删除">
                    </div>
                    <div class="ppt-modal-footer">
                        <button class="ppt-btn-secondary" onclick="window.PPTGenerator.closeDeleteModal()">取消</button>
                        <button class="ppt-btn-danger" id="pptFinalDeleteBtn" disabled onclick="window.PPTGenerator.executeDelete()">永久删除</button>
                    </div>
                </div>
            `;
        }

        modal.innerHTML = content;
        modal.classList.remove('hidden');

        if (this.deleteStep === 2) {
            const input = document.getElementById('pptDeleteConfirmInput');
            const btn = document.getElementById('pptFinalDeleteBtn');
            input.addEventListener('input', (e) => {
                btn.disabled = e.target.value !== '确认删除';
            });
        }
    },

    advanceDeleteStep() {
        this.deleteStep = 2;
        this._renderDeleteModal();
    },

    closeDeleteModal() {
        const modal = document.getElementById('pptDeleteModal');
        if (modal) {
            modal.classList.add('hidden');
            setTimeout(() => modal.remove(), 200); // Allow for fade out if added
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

Object.assign(PPTGenerator.prototype, PPTGeneratorDeletion);

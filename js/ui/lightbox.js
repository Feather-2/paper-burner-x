/**
 * @file js/ui/lightbox.js
 * @description 图片灯箱功能，用于全屏查看文档中的图片。
 */

(function() {
  let lightboxOverlay = null;
  let lightboxImage = null;
  let lightboxCaption = null;
  let lightboxSpinner = null;

  /**
   * 创建灯箱的 DOM 结构
   */
  function createLightboxDom() {
    if (document.querySelector('.lightbox-overlay')) return;

    lightboxOverlay = document.createElement('div');
    lightboxOverlay.className = 'lightbox-overlay';

    lightboxOverlay.innerHTML = `
      <div class="lightbox-spinner"></div>
      <div class="lightbox-content">
        <button class="lightbox-close-btn" aria-label="关闭">
          <i class="fas fa-times"></i>
        </button>
        <img class="lightbox-image" src="" alt="Lightbox image">
        <div class="lightbox-caption"></div>
      </div>
    `;

    document.body.appendChild(lightboxOverlay);

    lightboxImage = lightboxOverlay.querySelector('.lightbox-image');
    lightboxCaption = lightboxOverlay.querySelector('.lightbox-caption');
    lightboxSpinner = lightboxOverlay.querySelector('.lightbox-spinner');
    const closeBtn = lightboxOverlay.querySelector('.lightbox-close-btn');

    // 绑定关闭事件
    closeBtn.addEventListener('click', closeLightbox);
    lightboxOverlay.addEventListener('click', (e) => {
      if (e.target === lightboxOverlay) {
        closeLightbox();
      }
    });

    // 图片加载完成或失败时隐藏加载动画
    lightboxImage.addEventListener('load', () => {
      lightboxSpinner.style.display = 'none';
      lightboxImage.style.opacity = '1';
    });

    lightboxImage.addEventListener('error', () => {
      lightboxSpinner.style.display = 'none';
      // 可以显示一个错误占位图
    });
  }

  /**
   * 打开灯箱
   * @param {string} src 图片地址
   * @param {string} alt 图片描述
   */
  function openLightbox(src, alt) {
    if (!lightboxOverlay) createLightboxDom();

    // 显示加载动画，暂时隐藏旧图片
    lightboxSpinner.style.display = 'block';
    lightboxImage.style.opacity = '0.5';

    lightboxImage.src = src;
    lightboxImage.alt = alt || '';
    lightboxCaption.textContent = alt || '';

    lightboxOverlay.classList.add('active');
    document.body.style.overflow = 'hidden'; // 防止背景滚动
  }

  /**
   * 关闭灯箱
   */
  function closeLightbox() {
    if (lightboxOverlay) {
      lightboxOverlay.classList.remove('active');
      document.body.style.overflow = ''; // 恢复背景滚动
      
      // 清理 src 以避免下次打开时显示旧图
      setTimeout(() => {
        if (!lightboxOverlay.classList.contains('active')) {
            lightboxImage.src = '';
        }
      }, 300);
    }
  }

  /**
   * 初始化全局事件监听
   * 使用事件委托来处理动态加载的内容
   */
  function initLightbox() {
    createLightboxDom();

    // 监听 ESC 键关闭
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && lightboxOverlay && lightboxOverlay.classList.contains('active')) {
        closeLightbox();
      }
    });

    // 使用事件委托监听所有内容区域的图片点击
    document.body.addEventListener('click', (e) => {
      // 查找最近的 img 标签
      const img = e.target.closest('img');
      if (!img) return;

      // 排除一些不需要灯箱的图片（如图标、头像等）
      if (img.classList.contains('icon') || 
          img.closest('.dock-stat-item-wrapper-img') || // 排除 Dock 栏图标
          img.closest('button') || // 排除按钮内的图片
          img.closest('.lightbox-content')) { // 排除灯箱自己的图片
        return;
      }

      // 确保图片在主要内容区域内
      if (img.closest('.tab-content') || img.closest('.markdown-body') || img.closest('#immersive-main-content-area')) {
         e.preventDefault();
         openLightbox(img.src, img.alt || img.title);
      }
    });
  }

  // 页面加载完成后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLightbox);
  } else {
    initLightbox();
  }

})();
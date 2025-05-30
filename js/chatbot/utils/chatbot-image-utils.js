// js/chatbot/chatbot-image-utils.js

/**
 * ChatbotImageUtils 聊天机器人图片工具集
 *
 * 主要功能：
 * 1. 管理用户在聊天输入中选择的图片（预览、选择、压缩等）。
 * 2. 支持图片选择弹窗、图片压缩、图片预览弹窗等操作。
 * 3. 限制图片选择数量，处理图片压缩失败等异常。
 */
window.ChatbotImageUtils = {
  /**
   * 当前已选中的图片信息数组。
   * 每个元素包含 originalSrc、fullBase64、thumbnailBase64。
   */
  selectedChatbotImages: [],

  /**
   * 更新聊天输入区已选图片的预览区域。
   *
   * 主要逻辑：
   * 1. 获取预览容器元素。
   * 2. 清空之前的预览内容。
   * 3. 若有已选图片，则依次生成缩略图并展示。
   * 4. 若无已选图片，则隐藏预览区域。
   */
  updateSelectedImagesPreview: function() {
    const previewContainer = document.getElementById('chatbot-selected-images-preview');
    if (!previewContainer) {
      // console.error('ChatbotImageUtils: chatbot-selected-images-preview element not found.');
      return;
    }
    previewContainer.innerHTML = ''; // 清空之前的预览
    if (this.selectedChatbotImages && this.selectedChatbotImages.length > 0) {
      previewContainer.style.display = 'flex';
      previewContainer.style.flexWrap = 'wrap';
      previewContainer.style.gap = '8px';
      previewContainer.style.paddingBottom = '8px';

      this.selectedChatbotImages.forEach(imgInfo => {
        const imgElement = document.createElement('img');
        imgElement.src = imgInfo.thumbnailBase64 || imgInfo.fullBase64; // 优先使用缩略图
        imgElement.alt = 'Selected image';
        imgElement.style.width = '50px';
        imgElement.style.height = '50px';
        imgElement.style.objectFit = 'cover';
        imgElement.style.borderRadius = '4px';
        previewContainer.appendChild(imgElement);
      });
    } else {
      previewContainer.style.display = 'none';
    }
  },

  /**
   * 打开图片选择弹窗，允许用户从文档图片中选择。
   *
   * 主要逻辑：
   * 1. 若弹窗不存在则动态创建。
   * 2. 展示所有可选图片，支持点击选择/取消选择。
   * 3. 限制最多选择5张图片。
   * 4. 选择后自动压缩图片并生成缩略图。
   * 5. 选择完成后关闭弹窗并刷新预览。
   */
  openImageSelectionModal: function() {
    let modal = document.getElementById('chatbot-image-selection-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'chatbot-image-selection-modal';
      modal.style.position = 'fixed';
      modal.style.top = '0';
      modal.style.left = '0';
      modal.style.width = '100vw';
      modal.style.height = '100vh';
      modal.style.backgroundColor = 'rgba(0,0,0,0.5)';
      modal.style.zIndex = '100002';
      modal.style.display = 'flex';
      modal.style.alignItems = 'center';
      modal.style.justifyContent = 'center';
      // 点击遮罩关闭弹窗
      modal.onclick = function(e) { if (e.target === modal) modal.style.display = 'none'; };

      const contentDiv = document.createElement('div');
      contentDiv.style.background = 'white';
      contentDiv.style.padding = '20px';
      contentDiv.style.borderRadius = '8px';
      contentDiv.style.maxWidth = '80vw';
      contentDiv.style.maxHeight = '80vh';
      contentDiv.style.overflowY = 'auto';
      // 阻止内容区点击冒泡到遮罩
      contentDiv.onclick = function(e) { e.stopPropagation(); };

      const title = document.createElement('h3');
      title.textContent = '选择要添加到消息的图片';
      title.style.marginTop = '0';
      contentDiv.appendChild(title);

      const imageGrid = document.createElement('div');
      imageGrid.id = 'chatbot-doc-image-grid';
      imageGrid.style.display = 'grid';
      imageGrid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(120px, 1fr))';
      imageGrid.style.gap = '10px';
      imageGrid.style.marginTop = '15px';
      contentDiv.appendChild(imageGrid);

      const footer = document.createElement('div');
      footer.style.marginTop = '20px';
      footer.style.textAlign = 'right';

      const closeBtn = document.createElement('button');
      closeBtn.textContent = '完成选择';
      closeBtn.style.padding = '8px 16px';
      closeBtn.style.border = 'none';
      closeBtn.style.background = '#3b82f6';
      closeBtn.style.color = 'white';
      closeBtn.style.borderRadius = '6px';
      closeBtn.style.cursor = 'pointer';
      const self = this; // 用于回调中访问this
      closeBtn.onclick = function() {
        modal.style.display = 'none';
        self.updateSelectedImagesPreview();
      };
      footer.appendChild(closeBtn);
      contentDiv.appendChild(footer);
      modal.appendChild(contentDiv);
      document.body.appendChild(modal);
    }

    const imageGrid = modal.querySelector('#chatbot-doc-image-grid');
    imageGrid.innerHTML = ''; // 清空之前的图片

    // 获取文档图片数据
    const docImages = (window.data && window.data.images) ? window.data.images : [];

    if (docImages.length === 0) {
      imageGrid.innerHTML = '<p>当前文档没有图片可供选择。</p>';
    } else {
      const self = this; // 用于异步回调
      docImages.forEach((imgData, index) => {
        const imgContainer = document.createElement('div');
        imgContainer.style.position = 'relative';
        imgContainer.style.border = '2px solid transparent';
        imgContainer.style.borderRadius = '6px';
        imgContainer.style.cursor = 'pointer';
        imgContainer.style.transition = 'border-color 0.2s';

        // 判断当前图片是否已被选中
        const isSelected = self.selectedChatbotImages.some(sImg => sImg.originalSrc === (imgData.name || `doc-img-${index}`));
        if (isSelected) {
          imgContainer.style.borderColor = '#3b82f6';
        }

        const imgElement = document.createElement('img');
        let imgSrc = '';
        if(imgData.data && imgData.data.startsWith('data:image')) {
          imgSrc = imgData.data;
        } else if (imgData.data) {
          imgSrc = 'data:image/png;base64,' + imgData.data;
        }
        imgElement.src = imgSrc;
        imgElement.style.width = '100%';
        imgElement.style.height = 'auto';
        imgElement.style.maxHeight = '120px';
        imgElement.style.objectFit = 'contain';
        imgElement.style.display = 'block';
        imgElement.style.borderRadius = '4px';

        imgContainer.appendChild(imgElement);

        // 压缩参数
        const MAX_IMAGE_SIZE_BYTES = 1 * 1024 * 1024; // 1MB
        const MAX_THUMBNAIL_SIZE_BYTES = 60 * 1024; // 60KB
        const MAX_DIMENSION = 1024;
        const THUMB_DIMENSION = 200;

        // 点击图片选择/取消选择
        imgContainer.onclick = async function() {
          const originalSrcIdentifier = imgData.name || `doc-img-${index}`;
          const selectedIndex = self.selectedChatbotImages.findIndex(sImg => sImg.originalSrc === originalSrcIdentifier);

          if (selectedIndex > -1) {
            // 已选中则取消选择
            self.selectedChatbotImages.splice(selectedIndex, 1);
            imgContainer.style.borderColor = 'transparent';
          } else {
            // 限制最多选择5张
            if (self.selectedChatbotImages.length >= 5) {
              if (typeof ChatbotUtils !== 'undefined' && ChatbotUtils.showToast) {
                ChatbotUtils.showToast('最多选择 5 张图片。');
              } else {
                alert('最多选择 5 张图片。');
              }
              return;
            }
            imgContainer.style.borderColor = '#3b82f6';
            try {
              // 压缩原图和缩略图
              const fullBase64 = await self.compressImage(imgSrc, MAX_IMAGE_SIZE_BYTES, MAX_DIMENSION, 0.85);
              const thumbnailBase64 = await self.compressImage(imgSrc, MAX_THUMBNAIL_SIZE_BYTES, THUMB_DIMENSION, 0.7);

              self.selectedChatbotImages.push({
                originalSrc: originalSrcIdentifier,
                fullBase64: fullBase64,
                thumbnailBase64: thumbnailBase64,
              });
            } catch (error) {
              if (typeof ChatbotUtils !== 'undefined' && ChatbotUtils.showToast) {
                 ChatbotUtils.showToast('图片处理失败: ' + error.message);
              } else {
                alert('图片处理失败: ' + error.message);
              }
              imgContainer.style.borderColor = 'transparent';
            }
          }
        };
        imageGrid.appendChild(imgContainer);
      });
    }
    modal.style.display = 'flex';
  },

  /**
   * 压缩图片到目标大小和尺寸。
   *
   * 主要逻辑：
   * 1. 加载图片并按最大宽高等比缩放。
   * 2. 通过 canvas 反复调整压缩质量，直到文件大小不超过目标值或达到最小质量。
   * 3. 返回压缩后的 base64 数据。
   *
   * @param {string} base64Src - base64 编码的图片数据。
   * @param {number} targetSizeBytes - 目标文件大小（字节）。
   * @param {number} maxDimension - 最大宽/高。
   * @param {number} initialQuality - 初始压缩质量（0-1）。
   * @returns {Promise<string>} - 压缩后的 base64 图片数据。
   */
  compressImage: async function(base64Src, targetSizeBytes, maxDimension, initialQuality = 0.85) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let canvas = document.createElement('canvas');
        let ctx = canvas.getContext('2d');
        let width = img.width;
        let height = img.height;

        // 按最大宽高等比缩放
        if (width > height) {
          if (width > maxDimension) {
            height = Math.round(height * (maxDimension / width));
            width = maxDimension;
          }
        } else {
          if (height > maxDimension) {
            width = Math.round(width * (maxDimension / height));
            height = maxDimension;
          }
        }
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);

        let quality = initialQuality;
        let compressedBase64 = canvas.toDataURL('image/jpeg', quality);
        let iterations = 0;
        const maxIterations = 10;

        // 反复降低质量直到满足大小或达到最小质量
        while (compressedBase64.length * 0.75 > targetSizeBytes && quality > 0.1 && iterations < maxIterations) {
          quality -= 0.1;
          compressedBase64 = canvas.toDataURL('image/jpeg', Math.max(0.1, quality));
          iterations++;
        }

        if (compressedBase64.length * 0.75 > targetSizeBytes && targetSizeBytes < 100 * 1024) {
           console.warn(`Image compression for small target (${targetSizeBytes}B) resulted in ${Math.round(compressedBase64.length * 0.75 / 1024)}KB. Quality: ${quality.toFixed(2)}`);
        }
        resolve(compressedBase64);
      };
      img.onerror = (err) => {
        console.error("Image loading error for compression:", err, base64Src.substring(0,100));
        reject(new Error('无法加载图片进行压缩'));
      };
      img.src = base64Src;
    });
  },

  /**
   * 显示图片大图预览弹窗。
   *
   * 主要逻辑：
   * 1. 若弹窗不存在则动态创建。
   * 2. 设置图片内容并展示。
   * 3. 支持点击遮罩或关闭按钮关闭弹窗。
   *
   * @param {string} imageSrc - 要显示的图片（URL 或 base64）。
   */
  showImageModal: function(imageSrc) {
    let modal = document.getElementById('chatbot-image-display-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'chatbot-image-display-modal';
      modal.style.position = 'fixed';
      modal.style.top = '0';
      modal.style.left = '0';
      modal.style.width = '100vw';
      modal.style.height = '100vh';
      modal.style.backgroundColor = 'rgba(0,0,0,0.75)';
      modal.style.zIndex = '100003';
      modal.style.display = 'flex';
      modal.style.alignItems = 'center';
      modal.style.justifyContent = 'center';
      modal.style.cursor = 'pointer';
      // 点击遮罩或关闭按钮关闭弹窗
      modal.onclick = function(e) {
        if (e.target === modal || e.target.id === 'chatbot-image-display-close-btn') {
          modal.style.display = 'none';
        }
      };

      const imageContainer = document.createElement('div');
      imageContainer.style.position = 'relative';
      imageContainer.style.maxWidth = '90vw';
      imageContainer.style.maxHeight = '90vh';

      const imgElement = document.createElement('img');
      imgElement.id = 'chatbot-displayed-image';
      imgElement.style.display = 'block';
      imgElement.style.maxWidth = '100%';
      imgElement.style.maxHeight = '100%';
      imgElement.style.borderRadius = '8px';
      imgElement.style.boxShadow = '0 5px 25px rgba(0,0,0,0.3)';
      imgElement.style.objectFit = 'contain';
      imgElement.style.cursor = 'default';
      // 阻止图片点击冒泡到遮罩
      imgElement.onclick = function(e) { e.stopPropagation(); };

      const closeButton = document.createElement('button');
      closeButton.id = 'chatbot-image-display-close-btn';
      closeButton.textContent = '×';
      closeButton.style.position = 'absolute';
      closeButton.style.top = '10px';
      closeButton.style.right = '10px';
      closeButton.style.background = 'rgba(0,0,0,0.5)';
      closeButton.style.color = 'white';
      closeButton.style.border = 'none';
      closeButton.style.borderRadius = '50%';
      closeButton.style.width = '30px';
      closeButton.style.height = '30px';
      closeButton.style.fontSize = '20px';
      closeButton.style.lineHeight = '30px';
      closeButton.style.textAlign = 'center';
      closeButton.style.cursor = 'pointer';

      imageContainer.appendChild(closeButton);
      imageContainer.appendChild(imgElement);
      modal.appendChild(imageContainer);
      document.body.appendChild(modal);
    }

    const displayedImage = modal.querySelector('#chatbot-displayed-image');
    if (displayedImage) {
      displayedImage.src = imageSrc;
    }
    modal.style.display = 'flex';
  }
};
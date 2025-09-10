// 沉浸模式布局修复工具
(function() {
  'use strict';
  
  /**
   * 强制修复沉浸模式下的布局问题
   */
  function fixImmersiveLayout() {
    if (!window.ImmersiveLayout || !window.ImmersiveLayout.isActive()) {
      return; // 不在沉浸模式下，不需要修复
    }
    
    const immersiveMainArea = document.getElementById('immersive-main-content-area');
    if (!immersiveMainArea) return;
    
    const container = immersiveMainArea.querySelector('.container');
    if (!container) return;
    
    console.log('[ImmersiveLayoutFix] 正在修复沉浸模式布局...');
    
    // 强制container为flex布局
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.height = '100%';
    container.style.boxSizing = 'border-box';
    
    const tabContent = container.querySelector('.tab-content');
    if (!tabContent) return;
    
    // 强制tab-content正确填充
    tabContent.style.display = 'flex';
    tabContent.style.flexDirection = 'column';
    tabContent.style.flex = '1';
    tabContent.style.minHeight = '0';
    tabContent.style.overflow = 'hidden';
    tabContent.style.height = 'auto';
    tabContent.style.padding = '0'; // 移除原始padding
    tabContent.style.marginTop = '0'; // 移除原始margin-top
    tabContent.style.background = 'transparent'; // 移除背景
    
    // 处理不同类型的内容容器
    const contentWrapper = tabContent.querySelector('.content-wrapper');
    const chunkCompareContainer = tabContent.querySelector('.chunk-compare-container');
    
    if (contentWrapper) {
      contentWrapper.style.flex = '1';
      contentWrapper.style.overflowY = 'auto';
      contentWrapper.style.minHeight = '0';
      contentWrapper.style.margin = '0';
      contentWrapper.style.height = 'auto';
      contentWrapper.style.padding = '20px'; // 恢复必要的内边距
      console.log('[ImmersiveLayoutFix] 修复了 content-wrapper');
    }
    
    if (chunkCompareContainer) {
      chunkCompareContainer.style.flex = '1';
      chunkCompareContainer.style.overflowY = 'auto';
      chunkCompareContainer.style.minHeight = '0';
      chunkCompareContainer.style.height = 'auto';
      chunkCompareContainer.style.padding = '0'; // chunk-compare有自己的内部间距
      console.log('[ImmersiveLayoutFix] 修复了 chunk-compare-container');
    }
    
    // 确保h3标题不参与flex计算
    const h3Title = tabContent.querySelector('h3');
    if (h3Title) {
      h3Title.style.flex = 'none';
      h3Title.style.flexShrink = '0';
      h3Title.style.marginTop = '0';
      h3Title.style.marginBottom = '16px';
    }
    
    // 强制重新计算布局
    container.offsetHeight;
    tabContent.offsetHeight;
    
    console.log('[ImmersiveLayoutFix] 布局修复完成');
  }
  
  // 监听沉浸模式变化事件
  document.addEventListener('immersiveModeEntered', function() {
    setTimeout(fixImmersiveLayout, 350);
  });
  
  // 监听tab切换（通过MutationObserver）
  function observeTabChanges() {
    const tabContent = document.getElementById('tabContent');
    if (!tabContent) return;
    
    const observer = new MutationObserver(function(mutations) {
      let shouldFix = false;
      mutations.forEach(function(mutation) {
        if (mutation.type === 'childList' || mutation.type === 'subtree') {
          shouldFix = true;
        }
      });
      
      if (shouldFix && window.ImmersiveLayout && window.ImmersiveLayout.isActive()) {
        setTimeout(fixImmersiveLayout, 100);
      }
    });
    
    observer.observe(tabContent, {
      childList: true,
      subtree: true
    });
  }
  
  // 页面加载完成后开始监听
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observeTabChanges);
  } else {
    observeTabChanges();
  }
  
  // 暴露修复函数到全局，供手动调用
  window.fixImmersiveLayout = fixImmersiveLayout;
  
})();
// Phase 2 诊断脚本
// 在浏览器控制台粘贴并运行

console.log('===== Phase 2 优化诊断 =====\n');

// 1. 检查 AnnotationDOMCache 是否存在
console.log('1️⃣ 检查 AnnotationDOMCache 对象:');
if (typeof window.AnnotationDOMCache === 'undefined') {
    console.error('❌ AnnotationDOMCache 未定义！');
    console.log('   → 可能原因: annotation_logic.js 没有加载');
} else {
    console.log('✅ AnnotationDOMCache 已定义');
    console.log('   - initialized:', window.AnnotationDOMCache.initialized);
    console.log('   - subBlocks:', window.AnnotationDOMCache.subBlocks);
    console.log('   - subBlockMap:', window.AnnotationDOMCache.subBlockMap);

    if (!window.AnnotationDOMCache.initialized) {
        console.warn('⚠️ AnnotationDOMCache 未初始化');
        console.log('   → 可能原因: 内容渲染完成后没有调用 init()');

        // 尝试手动初始化
        console.log('\n🔧 尝试手动初始化...');
        try {
            window.AnnotationDOMCache.init();
            console.log('✅ 手动初始化成功');
        } catch (e) {
            console.error('❌ 手动初始化失败:', e);
        }
    } else {
        console.log('✅ AnnotationDOMCache 已初始化');
        console.log(`   → 已缓存 ${window.AnnotationDOMCache.subBlocks.length} 个 sub-block`);
    }
}

console.log('\n2️⃣ 检查 DOM_CACHE 对象:');
if (typeof DOM_CACHE === 'undefined') {
    console.error('❌ DOM_CACHE 未定义！');
    console.log('   → 可能原因: history_detail_show_tab.js 作用域问题');
} else {
    console.log('✅ DOM_CACHE 已定义');
    console.log('   - tabs.ocr:', DOM_CACHE.tabs.ocr);
    console.log('   - tabs.translation:', DOM_CACHE.tabs.translation);
    console.log('   - tabs.chunkCompare:', DOM_CACHE.tabs.chunkCompare);
}

console.log('\n3️⃣ 检查 window.contentReady 标志:');
console.log('   - contentReady:', window.contentReady);
if (!window.contentReady) {
    console.warn('⚠️ 内容尚未加载完成');
    console.log('   → 等待内容加载完成后再测试');
}

console.log('\n4️⃣ 检查页面上的 sub-block 元素:');
const subBlocks = document.querySelectorAll('.sub-block[data-sub-block-id]');
console.log(`   → 页面上有 ${subBlocks.length} 个 sub-block 元素`);

if (subBlocks.length === 0) {
    console.warn('⚠️ 页面上没有 sub-block 元素');
    console.log('   → 可能原因: 内容还没渲染，或者使用的是 PDF 对照模式');
}

console.log('\n5️⃣ 检查 showTab 函数:');
if (typeof showTab === 'undefined') {
    console.error('❌ showTab 函数未定义！');
} else {
    console.log('✅ showTab 函数已定义');
    // 检查是否是防抖版本
    const funcStr = showTab.toString();
    if (funcStr.includes('showTabDebounceTimer')) {
        console.log('✅ showTab 包含防抖逻辑');
    } else {
        console.warn('⚠️ showTab 可能没有防抖逻辑');
    }
}

console.log('\n===== 诊断完成 =====');
console.log('\n📋 总结:');
console.log('如果看到任何 ❌ 或 ⚠️，说明优化可能没有正确应用');
console.log('建议: 刷新页面后重新运行此脚本');

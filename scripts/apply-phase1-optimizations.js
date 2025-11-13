/**
 * Phase 1 性能优化自动应用脚本
 *
 * 使用方式: node scripts/apply-phase1-optimizations.js
 */

const fs = require('fs');
const path = require('path');

console.log('开始应用 Phase 1 性能优化...\n');

// ============================================
// 优化 1.2: 历史记录搜索防抖
// ============================================
console.log('[1/3] 应用历史记录搜索防抖优化...');

const historyJsPath = path.join(__dirname, '../js/history/history.js');
let historyContent = fs.readFileSync(historyJsPath, 'utf8');

// 检查是否已经应用过
if (historyContent.includes('debouncedRenderHistoryList')) {
    console.log('  ⚠️  历史记录防抖优化已存在，跳过');
} else {
    // 在搜索输入事件监听器前添加防抖函数
    const searchOld = `    const historySearchInput = document.getElementById('historySearchInput');
    const historyFolderSelectMobile = document.getElementById('historyFolderSelectMobile');
    if (historySearchInput) {
        historySearchInput.addEventListener('input', function(event) {
            historyUIState.searchQuery = event.target.value || '';
            renderHistoryList();
        });
    }`;

    const searchNew = `    const historySearchInput = document.getElementById('historySearchInput');
    const historyFolderSelectMobile = document.getElementById('historyFolderSelectMobile');

    // 性能优化：防抖函数（减少频繁的渲染调用）
    function debounce(fn, delay) {
        let timer = null;
        return function debounced(...args) {
            const context = this;
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                timer = null;
                fn.apply(context, args);
            }, delay);
        };
    }

    // 创建防抖版本的渲染函数（300ms 延迟）
    const debouncedRenderHistoryList = debounce(function() {
        renderHistoryList();
    }, 300);

    if (historySearchInput) {
        historySearchInput.addEventListener('input', function(event) {
            historyUIState.searchQuery = event.target.value || '';
            debouncedRenderHistoryList();  // 使用防抖版本，减少渲染次数
        });
    }`;

    if (historyContent.includes(searchOld)) {
        historyContent = historyContent.replace(searchOld, searchNew);
        fs.writeFileSync(historyJsPath, historyContent, 'utf8');
        console.log('  ✅ 历史记录搜索防抖优化已应用');
    } else {
        console.log('  ❌ 未找到预期的代码模式，请手动检查');
    }
}

// ============================================
// 优化 1.3: 正则表达式提升
// ============================================
console.log('\n[2/3] 应用正则表达式提升优化...');

const markdownAstPath = path.join(__dirname, '../js/processing/markdown_processor_ast.js');
let markdownContent = fs.readFileSync(markdownAstPath, 'utf8');

// 检查是否已经应用过
if (markdownContent.includes('MATH_DELIMITER_PATTERNS')) {
    console.log('  ⚠️  正则表达式提升优化已存在，跳过');
} else {
    // 在 normalizeMathDelimiters 函数前添加正则常量
    const regexOld = `function normalizeMathDelimiters(text) {`;
    const regexNew = `// 性能优化：提升正则表达式到模块级（避免重复编译）
const MATH_DELIMITER_PATTERNS = Object.freeze({
    dollarWithComma: /\$\\\$\s*([^\$\n]{1,200}?)\s*\\\$\s*，\s*\$/g,
    doubleDollar: /\$\\\$\s*([^\$\n]{1,200}?)\s*\\\$\$/g,
    singleDollarEnd: /\$\\\$\s*([^\$\n]{1,200}?)\s*\\\$/g,
    dollarSpaceDollar: /\$\s+\$/g,
    dollarDollarSpace: /\$\$\s+/g,
    spaceDollarDollar: /\s+\$\$/g,
    doubleDollarEOL: /\$\$\$/g
});

function normalizeMathDelimiters(text) {`;

    if (markdownContent.includes(regexOld)) {
        markdownContent = markdownContent.replace(regexOld, regexNew);

        // 替换函数内部的正则使用
        markdownContent = markdownContent.replace(
            /s = s\.replace\(\/\\\$\\\\\\\$\\s\*\(\[\\^\\\$\\n\]\{1,200\}\?\)\\s\*\\\\\\\$\\s\*，\\s\*\\\$\/g,/g,
            'MATH_DELIMITER_PATTERNS.dollarWithComma.lastIndex = 0;\n    s = s.replace(MATH_DELIMITER_PATTERNS.dollarWithComma,'
        );

        fs.writeFileSync(markdownAstPath, markdownContent, 'utf8');
        console.log('  ✅ 正则表达式提升优化已应用');
    } else {
        console.log('  ⚠️  未找到 normalizeMathDelimiters 函数，可能已经被重构');
    }
}

// ============================================
// 优化 1.4: 轮询定时器优化
// ============================================
console.log('\n[3/3] 应用轮询定时器优化...');

const annotationsPath = path.join(__dirname, '../js/annotations/annotations_summary_modal.js');

if (!fs.existsSync(annotationsPath)) {
    console.log('  ⚠️  annotations_summary_modal.js 不存在，跳过');
} else {
    let annotationsContent = fs.readFileSync(annotationsPath, 'utf8');

    if (annotationsContent.includes('ColorPollingManager')) {
        console.log('  ⚠️  轮询定时器优化已存在，跳过');
    } else {
        // 查找 setInterval(checkForNewColors
        if (annotationsContent.includes('setInterval(checkForNewColors')) {
            const pollerOld = `setInterval(checkForNewColors, 1000)`;
            const pollerNew = `// 性能优化：页面隐藏时暂停轮询
(function() {
    let timerId = null;
    let isActive = false;

    function poll() {
        if (!isActive) return;
        if (!document.hidden) {
            checkForNewColors();
        }
        timerId = setTimeout(poll, 1000);
    }

    function start() {
        if (isActive) return;
        isActive = true;
        poll();
    }

    function stop() {
        isActive = false;
        if (timerId) {
            clearTimeout(timerId);
            timerId = null;
        }
    }

    document.addEventListener('visibilitychange', () => {
        // 页面隐藏/显示时无需额外操作，poll 函数会自动跳过
    });

    window.addEventListener('beforeunload', stop);

    start();
})()`;

            annotationsContent = annotationsContent.replace(pollerOld, pollerNew);
            fs.writeFileSync(annotationsPath, annotationsContent, 'utf8');
            console.log('  ✅ 轮询定时器优化已应用');
        } else {
            console.log('  ⚠️  未找到 setInterval(checkForNewColors)，可能已经被重构');
        }
    }
}

console.log('\n✅ Phase 1 性能优化应用完成！\n');
console.log('建议：');
console.log('1. 运行 git diff 查看所有更改');
console.log('2. 在浏览器中测试所有修改功能');
console.log('3. 使用性能工具验证优化效果');
console.log('4. 如有问题，使用 git checkout -- <file> 回滚特定文件\n');

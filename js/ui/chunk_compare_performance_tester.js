/**
 * 分块对比性能测试脚本
 * 用于测试和验证分块对比预览的性能改进
 */

class ChunkComparePerformanceTester {
    constructor() {
        this.testResults = [];
        this.isRunning = false;
    }

    /**
     * 运行完整的性能测试套件
     */
    async runFullTestSuite() {
        if (this.isRunning) {
            console.warn('[PerformanceTest] 测试正在进行中，请等待完成');
            return;
        }

        this.isRunning = true;
        console.log('[PerformanceTest] 开始运行性能测试套件');

        try {
            const results = {
                testTime: new Date().toISOString(),
                browser: this.getBrowserInfo(),
                device: this.getDeviceInfo(),
                tests: {}
            };

            // 测试不同数量的分块
            const chunkCounts = [5, 10, 20, 50, 100];
            
            for (const count of chunkCounts) {
                console.log(`[PerformanceTest] 测试 ${count} 个分块的性能`);
                results.tests[`chunks_${count}`] = await this.testChunkRendering(count);
                
                // 让浏览器有时间清理
                await this.delay(1000);
            }

            // 测试内存使用情况
            results.memoryTest = this.testMemoryUsage();

            // 测试滚动性能
            results.scrollTest = await this.testScrollPerformance();

            // 生成测试报告
            this.generateTestReport(results);

            console.log('[PerformanceTest] 性能测试套件完成');
            return results;

        } catch (error) {
            console.error('[PerformanceTest] 测试过程中出错:', error);
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * 测试分块渲染性能
     */
    async testChunkRendering(chunkCount) {
        const testData = this.generateTestData(chunkCount);
        const container = this.createTestContainer();
        
        // 测试原有渲染方法
        const originalResult = await this.testOriginalRendering(testData, container);
        
        // 清理
        container.innerHTML = '';
        await this.delay(100);
        
        // 测试优化后的渲染方法
        const optimizedResult = await this.testOptimizedRendering(testData, container);
        
        // 清理
        container.remove();
        
        const improvement = {
            renderTime: {
                original: originalResult.renderTime,
                optimized: optimizedResult.renderTime,
                improvement: ((originalResult.renderTime - optimizedResult.renderTime) / originalResult.renderTime * 100).toFixed(2) + '%'
            },
            memoryUsage: {
                original: originalResult.memoryUsage,
                optimized: optimizedResult.memoryUsage,
                reduction: originalResult.memoryUsage > 0 ? ((originalResult.memoryUsage - optimizedResult.memoryUsage) / originalResult.memoryUsage * 100).toFixed(2) + '%' : 'N/A'
            },
            domNodes: {
                original: originalResult.domNodes,
                optimized: optimizedResult.domNodes,
                reduction: ((originalResult.domNodes - optimizedResult.domNodes) / originalResult.domNodes * 100).toFixed(2) + '%'
            }
        };

        console.log(`[PerformanceTest] ${chunkCount}个分块测试结果:`, improvement);
        return improvement;
    }

    /**
     * 生成测试数据
     */
    generateTestData(chunkCount) {
        const ocrChunks = [];
        const translatedChunks = [];

        for (let i = 0; i < chunkCount; i++) {
            // 生成不同长度的测试内容
            const contentLength = Math.floor(Math.random() * 1000) + 200; // 200-1200字符
            
            const ocrContent = this.generateTestContent(contentLength, 'ocr', i);
            const transContent = this.generateTestContent(contentLength, 'translation', i);
            
            ocrChunks.push(ocrContent);
            translatedChunks.push(transContent);
        }

        return {
            ocrChunks,
            translatedChunks,
            images: []
        };
    }

    /**
     * 生成测试内容
     */
    generateTestContent(length, type, index) {
        const headings = [
            '# 主要标题',
            '## 次要标题', 
            '### 三级标题'
        ];
        
        const paragraphs = [
            '这是一段测试文本，用于验证分块对比功能的性能表现。',
            '本段包含**粗体文字**和*斜体文字*，以及`代码片段`。',
            '测试内容包括数学公式：$E = mc^2$，以及更复杂的公式：$$\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}$$',
            '这里有一个代码块：\n```javascript\nfunction test() {\n  console.log("Hello World");\n}\n```',
            '列表项目：\n- 第一项\n- 第二项\n- 第三项',
            '表格测试：\n| 列1 | 列2 | 列3 |\n|-----|-----|-----|\n| 值1 | 值2 | 值3 |'
        ];

        let content = `${headings[index % headings.length]} (${type} #${index + 1})\n\n`;
        
        while (content.length < length) {
            content += paragraphs[Math.floor(Math.random() * paragraphs.length)] + '\n\n';
        }

        return content.substring(0, length);
    }

    /**
     * 创建测试容器
     */
    createTestContainer() {
        const container = document.createElement('div');
        container.id = 'performance-test-container';
        container.style.cssText = `
            position: absolute;
            top: -10000px;
            left: -10000px;
            width: 1000px;
            height: 600px;
            overflow: hidden;
        `;
        document.body.appendChild(container);
        return container;
    }

    /**
     * 测试原有渲染方法
     */
    async testOriginalRendering(testData, container) {
        const startTime = performance.now();
        const startMemory = this.getMemoryUsage();

        // 模拟原有的同步渲染
        let html = '<div class="chunk-compare-container">';
        
        for (let i = 0; i < testData.ocrChunks.length; i++) {
            html += `
                <div class="chunk-pair">
                    <div class="block-outer" id="block-${i}">
                        <h4>分块 ${i + 1}</h4>
                        <div class="original-chunk-content">
                            <div class="ocr-content">${this.renderMarkdownSync(testData.ocrChunks[i])}</div>
                            <div class="trans-content">${this.renderMarkdownSync(testData.translatedChunks[i])}</div>
                        </div>
                    </div>
                </div>
            `;
        }
        
        html += '</div>';
        container.innerHTML = html;

        const endTime = performance.now();
        const endMemory = this.getMemoryUsage();
        const domNodes = container.querySelectorAll('*').length;

        return {
            renderTime: endTime - startTime,
            memoryUsage: endMemory - startMemory,
            domNodes: domNodes
        };
    }

    /**
     * 测试优化后的渲染方法
     */
    async testOptimizedRendering(testData, container) {
        const startTime = performance.now();
        const startMemory = this.getMemoryUsage();

        // 使用优化器进行渲染
        if (window.ChunkCompareOptimizer && window.ChunkCompareOptimizer.instance) {
            const optimizedHTML = window.ChunkCompareOptimizer.instance.optimizeChunkComparison(
                testData.ocrChunks,
                testData.translatedChunks,
                { images: testData.images, isOriginalFirst: true }
            );
            container.innerHTML = optimizedHTML;

            // 等待异步渲染完成
            await this.waitForOptimizedRendering(container);
        } else {
            // 回退到预览模式
            let html = '<div class="chunk-compare-container">';
            
            for (let i = 0; i < Math.min(testData.ocrChunks.length, 5); i++) {
                html += `
                    <div class="chunk-pair optimized-chunk">
                        <div class="chunk-header">
                            <h4>分块 ${i + 1}</h4>
                        </div>
                        <div class="chunk-preview-container" data-lazy-load="true">
                            <div class="chunk-preview">${this.getContentPreview(testData.ocrChunks[i])}</div>
                            <div class="load-full-content-btn">点击加载完整内容</div>
                        </div>
                    </div>
                `;
            }
            
            html += '</div>';
            container.innerHTML = html;
        }

        const endTime = performance.now();
        const endMemory = this.getMemoryUsage();
        const domNodes = container.querySelectorAll('*').length;

        return {
            renderTime: endTime - startTime,
            memoryUsage: endMemory - startMemory,
            domNodes: domNodes
        };
    }

    /**
     * 等待优化后的渲染完成
     */
    async waitForOptimizedRendering(container) {
        let maxWait = 5000; // 最多等待5秒
        const interval = 100;
        
        while (maxWait > 0) {
            const loadingIndicators = container.querySelectorAll('.chunk-loading-indicator');
            if (loadingIndicators.length === 0) {
                break;
            }
            
            await this.delay(interval);
            maxWait -= interval;
        }
    }

    /**
     * 同步渲染Markdown（简化版）
     */
    renderMarkdownSync(content) {
        if (!content) return '';
        
        // 简化的Markdown渲染，避免复杂的异步操作
        return content
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`(.*?)`/g, '<code>$1</code>')
            .replace(/\n/g, '<br>');
    }

    /**
     * 获取内容预览
     */
    getContentPreview(content) {
        if (!content) return '(空内容)';
        return content.length > 100 ? content.substring(0, 100) + '...' : content;
    }

    /**
     * 测试内存使用情况
     */
    testMemoryUsage() {
        if (!performance.memory) {
            return { 
                error: '浏览器不支持内存监控',
                supported: false 
            };
        }

        const memory = performance.memory;
        return {
            supported: true,
            usedJSHeapSize: (memory.usedJSHeapSize / 1024 / 1024).toFixed(2) + ' MB',
            totalJSHeapSize: (memory.totalJSHeapSize / 1024 / 1024).toFixed(2) + ' MB',
            jsHeapSizeLimit: (memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2) + ' MB',
            usage: ((memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100).toFixed(2) + '%'
        };
    }

    /**
     * 测试滚动性能
     */
    async testScrollPerformance() {
        const container = document.querySelector('.chunk-compare-container');
        if (!container) {
            return { error: '未找到分块对比容器' };
        }

        const scrollTests = [];
        const scrollDistance = 100;
        const testCount = 10;

        for (let i = 0; i < testCount; i++) {
            const startTime = performance.now();
            
            // 模拟滚动
            container.scrollTop += scrollDistance;
            
            // 等待渲染完成
            await new Promise(resolve => requestAnimationFrame(resolve));
            
            const endTime = performance.now();
            scrollTests.push(endTime - startTime);
        }

        // 重置滚动位置
        container.scrollTop = 0;

        const avgScrollTime = scrollTests.reduce((a, b) => a + b, 0) / scrollTests.length;
        const maxScrollTime = Math.max(...scrollTests);
        const minScrollTime = Math.min(...scrollTests);

        return {
            averageTime: avgScrollTime.toFixed(2) + 'ms',
            maxTime: maxScrollTime.toFixed(2) + 'ms',
            minTime: minScrollTime.toFixed(2) + 'ms',
            testCount: testCount
        };
    }

    /**
     * 获取内存使用量
     */
    getMemoryUsage() {
        if (performance.memory) {
            return performance.memory.usedJSHeapSize;
        }
        return 0;
    }

    /**
     * 获取浏览器信息
     */
    getBrowserInfo() {
        const ua = navigator.userAgent;
        let browser = 'Unknown';
        
        if (ua.indexOf('Chrome') > -1) browser = 'Chrome';
        else if (ua.indexOf('Firefox') > -1) browser = 'Firefox';
        else if (ua.indexOf('Safari') > -1) browser = 'Safari';
        else if (ua.indexOf('Edge') > -1) browser = 'Edge';
        
        return {
            name: browser,
            userAgent: ua,
            vendor: navigator.vendor,
            language: navigator.language
        };
    }

    /**
     * 获取设备信息
     */
    getDeviceInfo() {
        return {
            platform: navigator.platform,
            hardwareConcurrency: navigator.hardwareConcurrency || 'Unknown',
            deviceMemory: navigator.deviceMemory || 'Unknown',
            screenResolution: `${screen.width}x${screen.height}`,
            viewportSize: `${window.innerWidth}x${window.innerHeight}`
        };
    }

    /**
     * 生成测试报告
     */
    generateTestReport(results) {
        console.group('[PerformanceTest] 性能测试报告');
        
        console.log('测试时间:', results.testTime);
        console.log('浏览器信息:', results.browser);
        console.log('设备信息:', results.device);
        
        console.group('分块渲染测试结果:');
        Object.entries(results.tests).forEach(([testName, result]) => {
            console.group(testName);
            console.log('渲染时间改善:', result.renderTime.improvement);
            console.log('内存使用减少:', result.memoryUsage.reduction);
            console.log('DOM节点减少:', result.domNodes.reduction);
            console.groupEnd();
        });
        console.groupEnd();
        
        console.log('内存测试:', results.memoryTest);
        console.log('滚动性能测试:', results.scrollTest);
        
        console.groupEnd();

        // 将结果保存到 localStorage
        localStorage.setItem('chunkComparePerformanceResults', JSON.stringify(results));
        
        // 显示用户友好的报告
        this.showUserReport(results);
    }

    /**
     * 显示用户友好的测试报告
     */
    showUserReport(results) {
        const reportEl = document.createElement('div');
        reportEl.className = 'performance-report-modal';
        reportEl.innerHTML = `
            <div class="report-overlay">
                <div class="report-content">
                    <h3>分块对比性能测试报告</h3>
                    <div class="report-summary">
                        <div class="summary-item">
                            <span class="label">测试时间:</span>
                            <span class="value">${new Date(results.testTime).toLocaleString()}</span>
                        </div>
                        <div class="summary-item">
                            <span class="label">浏览器:</span>
                            <span class="value">${results.browser.name}</span>
                        </div>
                        <div class="summary-item">
                            <span class="label">总体评价:</span>
                            <span class="value performance-grade">${this.calculateOverallGrade(results)}</span>
                        </div>
                    </div>
                    <div class="test-results">
                        <h4>性能改进详情</h4>
                        ${this.generateResultsHTML(results.tests)}
                    </div>
                    <div class="report-actions">
                        <button id="close-performance-report">关闭</button>
                        <button id="export-performance-report">导出报告</button>
                    </div>
                </div>
            </div>
        `;
        
        // 添加样式
        const style = document.createElement('style');
        style.id = 'performance-report-style'; // 添加ID以便后续清理
        style.textContent = `
            .performance-report-modal {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                z-index: 10000;
            }
            .report-overlay {
                background: rgba(0,0,0,0.5);
                width: 100%;
                height: 100%;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .report-content {
                background: white;
                max-width: 600px;
                max-height: 80vh;
                overflow-y: auto;
                border-radius: 8px;
                padding: 24px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            }
            .report-summary {
                margin: 16px 0;
                border: 1px solid #e2e8f0;
                border-radius: 6px;
                padding: 16px;
            }
            .summary-item {
                display: flex;
                justify-content: space-between;
                margin-bottom: 8px;
            }
            .performance-grade {
                font-weight: bold;
                color: #059669;
            }
            .test-results {
                margin: 16px 0;
            }
            .result-item {
                padding: 8px;
                border-bottom: 1px solid #f1f5f9;
            }
            .report-actions {
                display: flex;
                gap: 12px;
                justify-content: flex-end;
                margin-top: 20px;
            }
            .report-actions button {
                padding: 8px 16px;
                border: 1px solid #d1d5db;
                border-radius: 4px;
                background: white;
                cursor: pointer;
            }
            .report-actions button:first-child {
                background: #f3f4f6;
            }
            .report-actions button:last-child {
                background: #3b82f6;
                color: white;
                border-color: #3b82f6;
            }
        `;
        
        document.head.appendChild(style);
        document.body.appendChild(reportEl);
        
        // 添加事件监听器
        const closeBtn = document.getElementById('close-performance-report');
        const exportBtn = document.getElementById('export-performance-report');
        const overlay = reportEl.querySelector('.report-overlay');
        
        // 关闭按钮事件
        closeBtn.addEventListener('click', () => {
            this.closeReport();
        });
        
        // 导出按钮事件
        exportBtn.addEventListener('click', () => {
            this.exportReport();
        });
        
        // 点击遮罩层关闭
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                this.closeReport();
            }
        });
        
        // ESC键关闭
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                this.closeReport();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
    }
    
    /**
     * 关闭性能报告
     */
    closeReport() {
        const reportEl = document.querySelector('.performance-report-modal');
        const styleEl = document.getElementById('performance-report-style');
        
        if (reportEl) {
            reportEl.remove();
        }
        
        if (styleEl) {
            styleEl.remove();
        }
    }

    /**
     * 计算总体评分
     */
    calculateOverallGrade(results) {
        let totalImprovement = 0;
        let testCount = 0;

        Object.values(results.tests).forEach(test => {
            const improvement = parseFloat(test.renderTime.improvement);
            if (!isNaN(improvement)) {
                totalImprovement += improvement;
                testCount++;
            }
        });

        const avgImprovement = testCount > 0 ? totalImprovement / testCount : 0;

        if (avgImprovement >= 50) return '优秀 (A)';
        if (avgImprovement >= 30) return '良好 (B)';
        if (avgImprovement >= 10) return '一般 (C)';
        return '需改进 (D)';
    }

    /**
     * 生成结果HTML
     */
    generateResultsHTML(tests) {
        return Object.entries(tests).map(([testName, result]) => `
            <div class="result-item">
                <strong>${testName.replace('chunks_', '')}个分块:</strong>
                <div>渲染速度提升: ${result.renderTime.improvement}</div>
                <div>内存使用减少: ${result.memoryUsage.reduction}</div>
                <div>DOM节点减少: ${result.domNodes.reduction}</div>
            </div>
        `).join('');
    }

    /**
     * 导出测试报告
     */
    exportReport() {
        const results = localStorage.getItem('chunkComparePerformanceResults');
        if (!results) {
            alert('没有可导出的测试结果');
            return;
        }

        const blob = new Blob([results], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `chunk-compare-performance-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /**
     * 延迟函数
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// 创建全局测试实例
window.ChunkComparePerformanceTester = new ChunkComparePerformanceTester();

// 添加控制台快捷命令
console.log('%c分块对比性能测试器已加载', 'color: #059669; font-weight: bold');
console.log('使用 window.ChunkComparePerformanceTester.runFullTestSuite() 运行完整测试');

// 如果在开发环境，自动运行测试
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    // 页面加载完成后自动运行测试
    window.addEventListener('load', () => {
        setTimeout(() => {
            if (document.querySelector('.chunk-compare-container')) {
                console.log('[PerformanceTest] 检测到分块对比页面，自动运行性能测试');
                window.ChunkComparePerformanceTester.runFullTestSuite();
            }
        }, 2000);
    });
}
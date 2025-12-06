/**
 * Potrace Core - 向后兼容层
 * 
 * 实际实现已模块化至 potrace-core/ 目录
 * @see ./potrace-core/index.js
 *
 * 使用方法：
 * - 新代码推荐使用 ES Module:
 *   import { PotraceCore, vectorize } from './potrace-core/index.js';
 * 
 * - 旧代码可继续使用全局对象:
 *   window.PotraceCore.vectorize(imageData, options)
 */

(function(global) {
    'use strict';

    // 异步加载模块化版本
    let moduleLoaded = false;
    let PotraceModule = null;

    async function ensureModule() {
        if (moduleLoaded) return PotraceModule;
        
        try {
            // 动态导入模块化版本
            PotraceModule = await import('./potrace-core/index.js');
            moduleLoaded = true;
            console.log('[PotraceCore] 模块化版本加载成功');
            return PotraceModule;
        } catch (e) {
            console.error('[PotraceCore] 模块加载失败:', e);
            throw new Error('PotraceCore 模块加载失败，请确保 potrace-core/ 目录存在');
        }
    }

    // 兼容层 API
    const PotraceCore = {
        /**
         * 主矢量化函数
         */
        async vectorize(imageData, options = {}) {
            const mod = await ensureModule();
            return mod.vectorize(imageData, options);
        },

        /**
         * 使用预设进行矢量化
         */
        async vectorizeWithPreset(imageData, presetName = 'auto') {
            const mod = await ensureModule();
            return mod.vectorizeWithPreset(imageData, presetName);
        },

        /**
         * 分析图片颜色特征
         */
        async analyzeImageColors(imageData, clusterThreshold = 25) {
            const mod = await ensureModule();
            return mod.analyzeImageColors(imageData, clusterThreshold);
        },

        /**
         * K-Means++ 颜色量化
         */
        async kMeansQuantize(imageData, maxColors = 16, maxIterations = 10) {
            const mod = await ensureModule();
            return mod.kMeansQuantize(imageData, maxColors, maxIterations);
        },

        /**
         * Median Cut 颜色量化
         */
        async medianCutQuantize(imageData, maxColors = 16) {
            const mod = await ensureModule();
            return mod.medianCutQuantize(imageData, maxColors);
        },

        /**
         * 连通区域标记
         */
        async labelConnectedComponents(bitmap) {
            const mod = await ensureModule();
            return mod.labelConnectedComponents(bitmap);
        },

        /**
         * Marching Squares 轮廓追踪
         */
        async marchingSquaresContour(bitmap, ccResult = null, regionLabel = null, grayscaleData = null) {
            const mod = await ensureModule();
            return mod.marchingSquaresContour(bitmap, ccResult, regionLabel, grayscaleData);
        },

        /**
         * 路径简化
         */
        async simplifyPath(points, options = {}) {
            const mod = await ensureModule();
            return mod.simplifyPath(points, options);
        },

        /**
         * 贝塞尔曲线拟合
         */
        async fitBezier(points, maxError = 2.5, cornerAngle = 60) {
            const mod = await ensureModule();
            return mod.fitBezier(points, maxError, cornerAngle);
        },

        /**
         * 获取预设配置
         */
        get PRESETS() {
            // 同步返回预设（预设是静态数据）
            return {
                logo: {
                    numColors: 16,
                    colorTolerance: 20,
                    pathTolerance: 0.3,
                    smoothness: 0.8,
                    minPathLength: 16,
                    mode: 'spline',
                    blurSigma: 1.0
                },
                illustration: {
                    numColors: 32,
                    colorTolerance: 25,
                    pathTolerance: 0.5,
                    smoothness: 1.0,
                    minPathLength: 16,
                    mode: 'spline',
                    blurSigma: 1.0
                },
                lineart: {
                    numColors: 2,
                    colorTolerance: 60,
                    pathTolerance: 0.2,
                    smoothness: 0.5,
                    minPathLength: 16,
                    mode: 'spline',
                    binaryMode: true,
                    blurSigma: 0.5,
                    morphology: true
                },
                photo: {
                    numColors: 64,
                    colorTolerance: 35,
                    pathTolerance: 1.0,
                    smoothness: 2.0,
                    minPathLength: 64,
                    mode: 'spline',
                    blurSigma: 1.5
                },
                pixel: {
                    numColors: 16,
                    colorTolerance: 45,
                    pathTolerance: 0.5,
                    smoothness: 0.3,
                    minPathLength: 1,
                    mode: 'spline',
                    blurSigma: 0,
                    morphology: false
                },
                simple: {
                    numColors: 8,
                    colorTolerance: 40,
                    pathTolerance: 2.0,
                    smoothness: 4.0,
                    minPathLength: 32,
                    mode: 'polygon',
                    blurSigma: 0
                }
            };
        }
    };

    // 暴露到全局
    global.PotraceCore = PotraceCore;

})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);

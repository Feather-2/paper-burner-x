/**
 * Potrace Core - 预设配置模块
 */

export const PRESETS = {
    logo: {
        numColors: 12,          // 减少颜色，合并边缘抗锯齿
        colorTolerance: 30,
        pathTolerance: 0.5,
        smoothness: 3,
        minPathLength: 16,
        mode: 'spline',
        blurSigma: 1.5           // 增加模糊
    },
    illustration: {
        numColors: 24,
        colorTolerance: 30,
        pathTolerance: 0.5,
        smoothness: 2,
        minPathLength: 16,
        mode: 'spline',
        blurSigma: 1.5
    },
    lineart: {
        numColors: 2,
        colorTolerance: 60,
        pathTolerance: 0.5,
        smoothness: 1.0,
        minPathLength: 16,
        mode: 'spline',
        binaryMode: true,
        blurSigma: 2.0,        // 增大模糊获得平滑边缘
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
        preset: 'pixel',       // 标记预设名称
        numColors: 16,         // 减少颜色数，避免相似色分裂
        colorTolerance: 45,    // 适中容差
        pathTolerance: 0.2,    // 极高精度
        smoothness: 0,         // 关闭平滑
        minPathLength: 1,      // 不过滤任何区域
        mode: 'polygon',       // 使用多边形模式
        blurSigma: 0,          // 关闭模糊，保留锐利边缘
        morphology: false      // 不做形态学处理
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

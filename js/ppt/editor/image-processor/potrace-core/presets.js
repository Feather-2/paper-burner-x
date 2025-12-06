/**
 * Potrace Core - 预设配置模块
 */

export const PRESETS = {
    logo: {
        numColors: 16,
        colorTolerance: 20,
        pathTolerance: 0.5,
        smoothness: 3,         // 平滑迭代次数（越大边缘越平滑）
        minPathLength: 16,
        mode: 'spline',
        blurSigma: 1.0
    },
    illustration: {
        numColors: 32,
        colorTolerance: 25,
        pathTolerance: 0.5,
        smoothness: 2,
        minPathLength: 16,
        mode: 'spline',
        blurSigma: 1.0
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
        numColors: 16,         // 减少颜色数，避免相似色分裂
        colorTolerance: 45,    // 适中容差
        pathTolerance: 0.5,    // 保留细节
        smoothness: 0.3,       // 极少平滑
        minPathLength: 1,      // 不过滤任何区域
        mode: 'spline',
        blurSigma: 1.5,        // 模糊边缘获得更平滑的轮廓
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

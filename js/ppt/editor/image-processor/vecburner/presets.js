/**
 * Potrace Core - 预设配置模块
 */

export const PRESETS = {
    logo: {
        preset: 'logo',
        numColors: 12,          // 减少颜色，合并边缘抗锯齿
        colorTolerance: 40,
        pathTolerance: 0.5,
        smoothness: 1,         // 降低平滑度 (3 -> 1)，防止文字变圆润/变形
        minPathLength: 16,
        mode: 'spline',
        blurSigma: 0.5          // 进一步降低模糊，避免边缘外扩
    },
    illustration: {
        preset: 'illustration',
        numColors: 24,
        colorTolerance: 30,
        pathTolerance: 0.5,
        smoothness: 1.5,         // 降低平滑度 (2 -> 1.5)
        minPathLength: 16,
        mode: 'spline',
        blurSigma: 0.5           // 降低模糊 (1.5 -> 0.5)
    },
    lineart: {
        preset: 'lineart',
        numColors: 2,
        colorTolerance: 60,
        pathTolerance: 0.5,    // 高精度追踪
        smoothness: 1.5,       // 适度平滑，避免过度圆润
        minPathLength: 16,     // 过滤噪点
        mode: 'spline',
        binaryMode: true,
        blurSigma: 0.5,        // 进一步降低模糊
        morphology: false,     // 关闭形态学，避免线条变粗
        contourMethod: 'vtracer'  // 'vtracer' 实验中，暂用 marching
    },
    photo: {
        preset: 'photo',
        numColors: 64,
        colorTolerance: 35,
        pathTolerance: 1.0,
        smoothness: 1.0,       // 降低平滑度 (2.0 -> 1.0)，防止建筑/窗户等几何图形圆角化
        minPathLength: 64,
        mode: 'spline',
        blurSigma: 0.5         // 进一步降低模糊
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
        preset: 'simple',
        numColors: 8,
        colorTolerance: 35,    // 降低容差，保留更多颜色细节
        pathTolerance: 0.5,    // 提高精度 (1.0 -> 0.5)
        smoothness: 1.0,       // 降低平滑 (2.0 -> 1.0)，保持形状
        minPathLength: 16,     // 降低最小路径长度，保留更多细节
        mode: 'spline',        // 改用 spline 模式，曲线更平滑
        blurSigma: 0.5         // 轻微模糊减少噪点
    }
};

    /**
 * Landing Page 展示用示例 - Paper Burner X 风格
 * 主色：#4f46e5 (Indigo) | 白色底 + 淡蓝紫渐变
 */
const PPT_LANDING_SAMPLE_HTML = `
    <!-- 1. 封面页 - 复杂三维价值模型 -->
    <section data-type="freeform" id="landing-1" data-bg="#ffffff">
        <!-- 背景渐变装饰 -->
        <div data-el="svg" data-x="0%" data-y="0%" data-w="100%" data-h="100%">
            <svg viewBox="0 0 960 540" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <radialGradient id="bg1" cx="20%" cy="30%" r="50%">
                        <stop offset="0%" style="stop-color:#4f46e5;stop-opacity:0.06"/>
                        <stop offset="100%" style="stop-color:#4f46e5;stop-opacity:0"/>
                    </radialGradient>
                    <radialGradient id="bg2" cx="80%" cy="70%" r="40%">
                        <stop offset="0%" style="stop-color:#818cf8;stop-opacity:0.05"/>
                        <stop offset="100%" style="stop-color:#818cf8;stop-opacity:0"/>
                    </radialGradient>
                </defs>
                <rect width="960" height="540" fill="url(#bg1)"/>
                <rect width="960" height="540" fill="url(#bg2)"/>
            </svg>
        </div>
        
        <!-- 顶部色条 -->
        <div data-el="shape" data-shape="rect" data-x="0%" data-y="0%" data-w="100%" data-h="1.2%" data-fill="#4f46e5"></div>
        
        <!-- 标题区 -->
        <div data-el="text" data-x="3%" data-y="3%" data-w="70%" data-h="auto" data-font="9" data-color="#4f46e5" data-bold="true">STRATEGIC FRAMEWORK</div>
        <div data-el="text" data-x="3%" data-y="6%" data-w="94%" data-h="auto" data-font="18" data-color="#0F172A" data-bold="true">AI演示文稿生成的三维价值模型：效率-质量-成本的动态平衡</div>
        
        <!-- 右上角 Logo -->
        <div data-el="image" data-x="80%" data-y="3%" data-w="18%" data-h="7%" data-src="public/h_with_name.svg" data-fit="contain"></div>
        
        <!-- 分隔线 -->
        <div data-el="line" data-x1="3%" data-y1="11%" data-x2="97%" data-y2="11%" data-stroke="#e0e7ff" data-stroke-width="1"></div>
        
        <!-- 复杂三角框架 SVG -->
        <div data-el="svg" data-x="5%" data-y="13%" data-w="55%" data-h="75%">
            <svg viewBox="0 0 550 420" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <linearGradient id="g1" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" style="stop-color:#6366f1;stop-opacity:0.1"/>
                        <stop offset="100%" style="stop-color:#4f46e5;stop-opacity:0.3"/>
                    </linearGradient>
                    <linearGradient id="g2" x1="0%" y1="100%" x2="100%" y2="0%">
                        <stop offset="0%" style="stop-color:#4f46e5;stop-opacity:0.15"/>
                        <stop offset="100%" style="stop-color:#a5b4fc;stop-opacity:0.4"/>
                    </linearGradient>
                </defs>
                
                <!-- 外层大三角 -->
                <polygon points="275,25 520,380 30,380" fill="url(#g1)" stroke="#4f46e5" stroke-width="2"/>
                
                <!-- 中层三角 -->
                <polygon points="275,80 450,330 100,330" fill="url(#g2)" stroke="#4f46e5" stroke-width="1.5" stroke-dasharray="8,4"/>
                
                <!-- 内层核心三角 -->
                <polygon points="275,140 380,280 170,280" fill="#4f46e5" opacity="0.2" stroke="#4f46e5" stroke-width="1"/>
                
                <!-- 核心圆 -->
                <circle cx="275" cy="230" r="35" fill="#ffffff" stroke="#4f46e5" stroke-width="2"/>
                <text x="275" y="225" text-anchor="middle" fill="#4f46e5" font-size="11" font-weight="bold">AI</text>
                <text x="275" y="240" text-anchor="middle" fill="#4f46e5" font-size="9">Core</text>
                
                <!-- 顶点标签框 -->
                <rect x="225" y="0" width="100" height="28" fill="#4f46e5" rx="3"/>
                <text x="275" y="18" text-anchor="middle" fill="#ffffff" font-size="11" font-weight="bold">生成效率</text>
                
                <!-- 左下标签框 -->
                <rect x="0" y="365" width="90" height="28" fill="#4f46e5" rx="3"/>
                <text x="45" y="383" text-anchor="middle" fill="#ffffff" font-size="11" font-weight="bold">内容质量</text>
                
                <!-- 右下标签框 -->
                <rect x="460" y="365" width="90" height="28" fill="#4f46e5" rx="3"/>
                <text x="505" y="383" text-anchor="middle" fill="#ffffff" font-size="11" font-weight="bold">使用成本</text>
                
                <!-- 连接虚线 -->
                <line x1="275" y1="28" x2="275" y2="140" stroke="#4f46e5" stroke-width="1" stroke-dasharray="4,2"/>
                <line x1="45" y1="365" x2="170" y2="280" stroke="#4f46e5" stroke-width="1" stroke-dasharray="4,2"/>
                <line x1="505" y1="365" x2="380" y2="280" stroke="#4f46e5" stroke-width="1" stroke-dasharray="4,2"/>
                
                <!-- 数据点标注 -->
                <circle cx="275" cy="100" r="6" fill="#4f46e5"/>
                <text x="295" y="95" fill="#64748B" font-size="9">30秒/份</text>
                <text x="295" y="107" fill="#64748B" font-size="8">vs 传统2小时</text>
                
                <circle cx="130" cy="310" r="6" fill="#4f46e5"/>
                <text x="65" y="305" fill="#64748B" font-size="9">98%满意度</text>
                <text x="65" y="317" fill="#64748B" font-size="8">专业设计标准</text>
                
                <circle cx="420" cy="310" r="6" fill="#4f46e5"/>
                <text x="430" y="305" fill="#64748B" font-size="9">成本降低</text>
                <text x="430" y="317" fill="#64748B" font-size="8">100% (免费)</text>
                
                <!-- 层级标注 -->
                <text x="275" y="60" text-anchor="middle" fill="#94A3B8" font-size="8">外层：战略目标</text>
                <text x="275" y="120" text-anchor="middle" fill="#94A3B8" font-size="8">中层：执行路径</text>
                <text x="275" y="175" text-anchor="middle" fill="#94A3B8" font-size="8">核心：AI引擎</text>
            </svg>
        </div>
        
        <!-- 右侧说明区 -->
        <div data-el="shape" data-shape="rect" data-x="62%" data-y="14%" data-w="36%" data-h="8%" data-fill="#eef2ff" data-radius="3" data-stroke="#c7d2fe"></div>
        <div data-el="text" data-x="63%" data-y="15.5%" data-w="34%" data-h="auto" data-font="9" data-color="#4f46e5" data-bold="true">EXECUTIVE SUMMARY</div>
        <div data-el="text" data-x="63%" data-y="19%" data-w="34%" data-h="auto" data-font="8" data-color="#64748B">三维价值模型实现效率、质量、成本的最优平衡</div>
        
        <!-- 关键指标卡片 -->
        <div data-el="shape" data-shape="rect" data-x="62%" data-y="24%" data-w="17%" data-h="18%" data-fill="#ffffff" data-radius="3" data-stroke="#E2E8F0"></div>
        <div data-el="text" data-x="63%" data-y="26%" data-w="15%" data-h="auto" data-font="8" data-color="#94A3B8">效率提升</div>
        <div data-el="text" data-x="63%" data-y="32%" data-w="15%" data-h="auto" data-font="22" data-color="#4f46e5" data-bold="true">240x</div>
        <div data-el="text" data-x="63%" data-y="39%" data-w="15%" data-h="auto" data-font="7" data-color="#64748B">vs 传统方式</div>
        
        <div data-el="shape" data-shape="rect" data-x="81%" data-y="24%" data-w="17%" data-h="18%" data-fill="#ffffff" data-radius="3" data-stroke="#E2E8F0"></div>
        <div data-el="text" data-x="82%" data-y="26%" data-w="15%" data-h="auto" data-font="8" data-color="#94A3B8">质量达标率</div>
        <div data-el="text" data-x="82%" data-y="32%" data-w="15%" data-h="auto" data-font="22" data-color="#4f46e5" data-bold="true">98%</div>
        <div data-el="text" data-x="82%" data-y="39%" data-w="15%" data-h="auto" data-font="7" data-color="#64748B">专业设计标准</div>
        
        <div data-el="shape" data-shape="rect" data-x="62%" data-y="44%" data-w="17%" data-h="18%" data-fill="#ffffff" data-radius="3" data-stroke="#E2E8F0"></div>
        <div data-el="text" data-x="63%" data-y="46%" data-w="15%" data-h="auto" data-font="8" data-color="#94A3B8">成本节省</div>
        <div data-el="text" data-x="63%" data-y="52%" data-w="15%" data-h="auto" data-font="22" data-color="#4f46e5" data-bold="true">100%</div>
        <div data-el="text" data-x="63%" data-y="59%" data-w="15%" data-h="auto" data-font="7" data-color="#64748B">完全免费</div>
        
        <div data-el="shape" data-shape="rect" data-x="81%" data-y="44%" data-w="17%" data-h="18%" data-fill="#ffffff" data-radius="3" data-stroke="#E2E8F0"></div>
        <div data-el="text" data-x="82%" data-y="46%" data-w="15%" data-h="auto" data-font="8" data-color="#94A3B8">累计生成</div>
        <div data-el="text" data-x="82%" data-y="52%" data-w="15%" data-h="auto" data-font="22" data-color="#4f46e5" data-bold="true">50K+</div>
        <div data-el="text" data-x="82%" data-y="59%" data-w="15%" data-h="auto" data-font="7" data-color="#64748B">演示文稿</div>
        
        <!-- 右侧要点列表 -->
        <div data-el="text" data-x="62%" data-y="65%" data-w="36%" data-h="auto" data-font="9" data-color="#4f46e5" data-bold="true">KEY INSIGHTS</div>
        <div data-el="text" data-x="62%" data-y="70%" data-w="36%" data-h="auto" data-font="8" data-color="#0F172A">• 外层战略目标定义价值边界</div>
        <div data-el="text" data-x="62%" data-y="74%" data-w="36%" data-h="auto" data-font="8" data-color="#0F172A">• 中层执行路径确保落地可行</div>
        <div data-el="text" data-x="62%" data-y="78%" data-w="36%" data-h="auto" data-font="8" data-color="#0F172A">• 核心AI引擎驱动自动化生成</div>
        <div data-el="text" data-x="62%" data-y="82%" data-w="36%" data-h="auto" data-font="8" data-color="#0F172A">• 三维平衡实现帕累托最优解</div>
        
        <!-- 底部来源 -->
        <div data-el="line" data-x1="3%" data-y1="92%" data-x2="97%" data-y2="92%" data-stroke="#E2E8F0" data-stroke-width="1"></div>
        <div data-el="text" data-x="3%" data-y="94%" data-w="60%" data-h="auto" data-font="7" data-color="#94A3B8">Source: Paper Burner X Internal Analytics, 2024 Q4 | Methodology: User satisfaction survey (n=5,000+)</div>
        <div data-el="text" data-x="85%" data-y="94%" data-w="12%" data-h="auto" data-font="7" data-color="#94A3B8" data-align="right">Page 1 of 5</div>
    </section>

    <!-- 2. 2x2矩阵分析 - 复杂版 -->
    <section data-type="freeform" id="landing-2" data-bg="#ffffff">
        <!-- 背景渐变 -->
        <div data-el="svg" data-x="0%" data-y="0%" data-w="100%" data-h="100%">
            <svg viewBox="0 0 960 540" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <radialGradient id="bg2a" cx="70%" cy="20%" r="45%">
                        <stop offset="0%" style="stop-color:#818cf8;stop-opacity:0.05"/>
                        <stop offset="100%" style="stop-color:#818cf8;stop-opacity:0"/>
                    </radialGradient>
                    <radialGradient id="bg2b" cx="10%" cy="80%" r="40%">
                        <stop offset="0%" style="stop-color:#4f46e5;stop-opacity:0.04"/>
                        <stop offset="100%" style="stop-color:#4f46e5;stop-opacity:0"/>
                    </radialGradient>
                </defs>
                <rect width="960" height="540" fill="url(#bg2a)"/>
                <rect width="960" height="540" fill="url(#bg2b)"/>
            </svg>
        </div>
        
        <!-- 顶部色条 -->
        <div data-el="shape" data-shape="rect" data-x="0%" data-y="0%" data-w="100%" data-h="1.2%" data-fill="#4f46e5"></div>
        
        <!-- 标题区 -->
        <div data-el="text" data-x="3%" data-y="3%" data-w="70%" data-h="auto" data-font="9" data-color="#4f46e5" data-bold="true">COMPETITIVE POSITIONING MATRIX</div>
        <div data-el="text" data-x="3%" data-y="6%" data-w="94%" data-h="auto" data-font="18" data-color="#0F172A" data-bold="true">市场定位分析：效率-质量四象限矩阵与竞争格局</div>
        
        <!-- 右上角 Logo -->
        <div data-el="image" data-x="80%" data-y="3%" data-w="18%" data-h="7%" data-src="public/h_with_name.svg" data-fit="contain"></div>
        
        <!-- 分隔线 -->
        <div data-el="line" data-x1="3%" data-y1="11%" data-x2="97%" data-y2="11%" data-stroke="#E2E8F0" data-stroke-width="1"></div>
        
        <!-- 2x2 矩阵 SVG -->
        <div data-el="svg" data-x="3%" data-y="13%" data-w="60%" data-h="75%">
            <svg viewBox="0 0 600 420" xmlns="http://www.w3.org/2000/svg">
                <!-- 坐标轴 -->
                <line x1="80" y1="380" x2="580" y2="380" stroke="#334155" stroke-width="2"/>
                <line x1="80" y1="380" x2="80" y2="30" stroke="#334155" stroke-width="2"/>
                
                <!-- 箭头 -->
                <polygon points="580,380 565,373 565,387" fill="#334155"/>
                <polygon points="80,30 73,45 87,45" fill="#334155"/>
                
                <!-- 轴标签 -->
                <text x="330" y="410" text-anchor="middle" fill="#334155" font-size="12" font-weight="bold">生成效率 →</text>
                <text x="35" y="205" text-anchor="middle" fill="#334155" font-size="12" font-weight="bold" transform="rotate(-90,35,205)">输出质量 →</text>
                
                <!-- 象限背景 -->
                <rect x="80" y="30" width="250" height="175" fill="#FEF3C7" opacity="0.4"/>
                <rect x="330" y="30" width="250" height="175" fill="#D1FAE5" opacity="0.5"/>
                <rect x="80" y="205" width="250" height="175" fill="#FEE2E2" opacity="0.4"/>
                <rect x="330" y="205" width="250" height="175" fill="#DBEAFE" opacity="0.4"/>
                
                <!-- 象限虚线 -->
                <line x1="330" y1="30" x2="330" y2="380" stroke="#94A3B8" stroke-width="1" stroke-dasharray="6,3"/>
                <line x1="80" y1="205" x2="580" y2="205" stroke="#94A3B8" stroke-width="1" stroke-dasharray="6,3"/>
                
                <!-- 象限标签 -->
                <text x="205" y="55" text-anchor="middle" fill="#B45309" font-size="10" font-weight="bold">高质量 / 低效率</text>
                <text x="205" y="70" text-anchor="middle" fill="#92400E" font-size="9">传统设计师</text>
                
                <text x="455" y="55" text-anchor="middle" fill="#4338ca" font-size="10" font-weight="bold">高质量 / 高效率</text>
                <text x="455" y="70" text-anchor="middle" fill="#3730a3" font-size="9">Paper Burner</text>
                
                <text x="205" y="230" text-anchor="middle" fill="#B91C1C" font-size="10" font-weight="bold">低质量 / 低效率</text>
                <text x="205" y="245" text-anchor="middle" fill="#991B1B" font-size="9">手动制作</text>
                
                <text x="455" y="230" text-anchor="middle" fill="#1D4ED8" font-size="10" font-weight="bold">低质量 / 高效率</text>
                <text x="455" y="245" text-anchor="middle" fill="#1E40AF" font-size="9">模板工具</text>
                
                <!-- 竞争者位置 -->
                <circle cx="180" cy="100" r="20" fill="#F59E0B" opacity="0.7"/>
                <text x="180" y="105" text-anchor="middle" fill="#fff" font-size="9" font-weight="bold">A</text>
                
                <circle cx="150" cy="300" r="18" fill="#EF4444" opacity="0.7"/>
                <text x="150" y="305" text-anchor="middle" fill="#fff" font-size="9" font-weight="bold">B</text>
                
                <circle cx="420" cy="280" r="22" fill="#3B82F6" opacity="0.7"/>
                <text x="420" y="285" text-anchor="middle" fill="#fff" font-size="9" font-weight="bold">C</text>
                
                <circle cx="500" cy="320" r="16" fill="#6366F1" opacity="0.7"/>
                <text x="500" y="325" text-anchor="middle" fill="#fff" font-size="9" font-weight="bold">D</text>
                
                <!-- Paper Burner 位置 - 高亮 -->
                <circle cx="480" cy="90" r="35" fill="#4f46e5" opacity="0.9"/>
                <text x="480" y="85" text-anchor="middle" fill="#fff" font-size="11" font-weight="bold">Paper</text>
                <text x="480" y="100" text-anchor="middle" fill="#fff" font-size="11" font-weight="bold">Burner</text>
                
                <!-- 移动路径箭头 -->
                <path d="M180,100 Q280,60 440,90" stroke="#4f46e5" stroke-width="2" fill="none" stroke-dasharray="8,4"/>
                <polygon points="440,90 425,82 428,97" fill="#4f46e5"/>
            </svg>
        </div>
        
        <!-- 右侧图例和分析 -->
        <div data-el="text" data-x="65%" data-y="14%" data-w="32%" data-h="auto" data-font="9" data-color="#4f46e5" data-bold="true">LEGEND</div>
        
        <div data-el="shape" data-shape="circle" data-x="65%" data-y="18%" data-w="2%" data-h="3.5%" data-fill="#F59E0B"></div>
        <div data-el="text" data-x="68%" data-y="18.5%" data-w="28%" data-h="auto" data-font="8" data-color="#0F172A">A - 专业设计师 (2h+/份)</div>
        
        <div data-el="shape" data-shape="circle" data-x="65%" data-y="23%" data-w="2%" data-h="3.5%" data-fill="#EF4444"></div>
        <div data-el="text" data-x="68%" data-y="23.5%" data-w="28%" data-h="auto" data-font="8" data-color="#0F172A">B - 手动制作 (4h+/份)</div>
        
        <div data-el="shape" data-shape="circle" data-x="65%" data-y="28%" data-w="2%" data-h="3.5%" data-fill="#3B82F6"></div>
        <div data-el="text" data-x="68%" data-y="28.5%" data-w="28%" data-h="auto" data-font="8" data-color="#0F172A">C - 传统模板 (15min/份)</div>
        
        <div data-el="shape" data-shape="circle" data-x="65%" data-y="33%" data-w="2%" data-h="3.5%" data-fill="#6366F1"></div>
        <div data-el="text" data-x="68%" data-y="33.5%" data-w="28%" data-h="auto" data-font="8" data-color="#0F172A">D - 在线工具 (10min/份)</div>
        
        <div data-el="shape" data-shape="circle" data-x="65%" data-y="38%" data-w="2%" data-h="3.5%" data-fill="#4f46e5"></div>
        <div data-el="text" data-x="68%" data-y="38.5%" data-w="28%" data-h="auto" data-font="8" data-color="#0F172A" data-bold="true">Paper Burner X (30s/份)</div>
        
        <!-- 分析区 -->
        <div data-el="shape" data-shape="rect" data-x="65%" data-y="45%" data-w="32%" data-h="28%" data-fill="#eef2ff" data-radius="3" data-stroke="#c7d2fe"></div>
        <div data-el="text" data-x="66%" data-y="47%" data-w="30%" data-h="auto" data-font="9" data-color="#4f46e5" data-bold="true">STRATEGIC IMPLICATIONS</div>
        <div data-el="text" data-x="66%" data-y="52%" data-w="30%" data-h="auto" data-font="8" data-color="#0F172A">1. Paper Burner X 占据最优象限</div>
        <div data-el="text" data-x="66%" data-y="56%" data-w="30%" data-h="auto" data-font="8" data-color="#0F172A">2. 效率提升 240x (vs 传统)</div>
        <div data-el="text" data-x="66%" data-y="60%" data-w="30%" data-h="auto" data-font="8" data-color="#0F172A">3. 质量达专业设计师水平</div>
        <div data-el="text" data-x="66%" data-y="64%" data-w="30%" data-h="auto" data-font="8" data-color="#0F172A">4. 成本降低 100% (免费)</div>
        <div data-el="text" data-x="66%" data-y="68%" data-w="30%" data-h="auto" data-font="8" data-color="#0F172A">5. 颠覆性创新定位</div>
        
        <!-- 关键结论框 -->
        <div data-el="shape" data-shape="rect" data-x="65%" data-y="75%" data-w="32%" data-h="13%" data-fill="#4f46e5" data-radius="3"></div>
        <div data-el="text" data-x="66%" data-y="77%" data-w="30%" data-h="auto" data-font="8" data-color="#a5b4fc" data-bold="true">KEY TAKEAWAY</div>
        <div data-el="text" data-x="66%" data-y="82%" data-w="30%" data-h="auto" data-font="9" data-color="#ffffff" data-bold="true">Paper Burner X 实现了效率与质量的双重突破，重新定义行业标准</div>
        
        <!-- 底部来源 -->
        <div data-el="line" data-x1="3%" data-y1="92%" data-x2="97%" data-y2="92%" data-stroke="#E2E8F0" data-stroke-width="1"></div>
        <div data-el="text" data-x="3%" data-y="94%" data-w="60%" data-h="auto" data-font="7" data-color="#94A3B8">Source: Competitive analysis based on market research, 2024 | Note: Circle size represents market share</div>
        <div data-el="text" data-x="85%" data-y="94%" data-w="12%" data-h="auto" data-font="7" data-color="#94A3B8" data-align="right">Page 2 of 5</div>
    </section>

    <!-- 3. 瀑布流程图 - 复杂版 -->
    <section data-type="freeform" id="landing-3" data-bg="#ffffff">
        <!-- 背景渐变 -->
        <div data-el="svg" data-x="0%" data-y="0%" data-w="100%" data-h="100%">
            <svg viewBox="0 0 960 540" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <radialGradient id="bg3a" cx="30%" cy="60%" r="50%">
                        <stop offset="0%" style="stop-color:#6366f1;stop-opacity:0.05"/>
                        <stop offset="100%" style="stop-color:#6366f1;stop-opacity:0"/>
                    </radialGradient>
                </defs>
                <rect width="960" height="540" fill="url(#bg3a)"/>
            </svg>
        </div>
        
        <!-- 顶部色条 -->
        <div data-el="shape" data-shape="rect" data-x="0%" data-y="0%" data-w="100%" data-h="1.2%" data-fill="#4f46e5"></div>
        
        <!-- 标题区 -->
        <div data-el="text" data-x="3%" data-y="3%" data-w="70%" data-h="auto" data-font="9" data-color="#4f46e5" data-bold="true">VALUE CREATION WATERFALL</div>
        <div data-el="text" data-x="3%" data-y="6%" data-w="94%" data-h="auto" data-font="18" data-color="#0F172A" data-bold="true">价值创造瀑布图：从传统方式到AI驱动的效率跃迁</div>
        
        <!-- 右上角 Logo -->
        <div data-el="image" data-x="80%" data-y="3%" data-w="18%" data-h="7%" data-src="public/h_with_name.svg" data-fit="contain"></div>
        
        <!-- 分隔线 -->
        <div data-el="line" data-x1="3%" data-y1="11%" data-x2="97%" data-y2="11%" data-stroke="#E2E8F0" data-stroke-width="1"></div>
        
        <!-- 瀑布图 SVG -->
        <div data-el="svg" data-x="3%" data-y="13%" data-w="94%" data-h="55%">
            <svg viewBox="0 0 940 300" xmlns="http://www.w3.org/2000/svg">
                <!-- Y轴 -->
                <line x1="80" y1="280" x2="80" y2="20" stroke="#334155" stroke-width="1"/>
                <text x="40" y="30" fill="#64748B" font-size="9">时间(分钟)</text>
                
                <!-- Y轴刻度 -->
                <text x="70" y="55" fill="#94A3B8" font-size="8" text-anchor="end">120</text>
                <line x1="75" y1="50" x2="80" y2="50" stroke="#94A3B8" stroke-width="1"/>
                <text x="70" y="105" fill="#94A3B8" font-size="8" text-anchor="end">90</text>
                <line x1="75" y1="100" x2="80" y2="100" stroke="#94A3B8" stroke-width="1"/>
                <text x="70" y="155" fill="#94A3B8" font-size="8" text-anchor="end">60</text>
                <line x1="75" y1="150" x2="80" y2="150" stroke="#94A3B8" stroke-width="1"/>
                <text x="70" y="205" fill="#94A3B8" font-size="8" text-anchor="end">30</text>
                <line x1="75" y1="200" x2="80" y2="200" stroke="#94A3B8" stroke-width="1"/>
                <text x="70" y="255" fill="#94A3B8" font-size="8" text-anchor="end">0</text>
                <line x1="75" y1="250" x2="920" y2="250" stroke="#E2E8F0" stroke-width="1"/>
                
                <!-- 传统方式起始柱 -->
                <rect x="100" y="50" width="80" height="200" fill="#EF4444" opacity="0.8"/>
                <text x="140" y="45" text-anchor="middle" fill="#EF4444" font-size="10" font-weight="bold">120min</text>
                <text x="140" y="270" text-anchor="middle" fill="#334155" font-size="9">传统方式</text>
                
                <!-- 减少：内容整理 -->
                <rect x="200" y="50" width="80" height="30" fill="#F97316" opacity="0.8"/>
                <line x1="180" y1="50" x2="200" y2="50" stroke="#94A3B8" stroke-width="1" stroke-dasharray="4,2"/>
                <text x="240" y="40" text-anchor="middle" fill="#F97316" font-size="9">-25min</text>
                <text x="240" y="270" text-anchor="middle" fill="#334155" font-size="8">智能解析</text>
                
                <!-- 减少：布局设计 -->
                <rect x="300" y="80" width="80" height="40" fill="#F59E0B" opacity="0.8"/>
                <line x1="280" y1="80" x2="300" y2="80" stroke="#94A3B8" stroke-width="1" stroke-dasharray="4,2"/>
                <text x="340" y="70" text-anchor="middle" fill="#F59E0B" font-size="9">-35min</text>
                <text x="340" y="270" text-anchor="middle" fill="#334155" font-size="8">自动排版</text>
                
                <!-- 减少：视觉美化 -->
                <rect x="400" y="120" width="80" height="35" fill="#EAB308" opacity="0.8"/>
                <line x1="380" y1="120" x2="400" y2="120" stroke="#94A3B8" stroke-width="1" stroke-dasharray="4,2"/>
                <text x="440" y="110" text-anchor="middle" fill="#EAB308" font-size="9">-30min</text>
                <text x="440" y="270" text-anchor="middle" fill="#334155" font-size="8">智能配色</text>
                
                <!-- 减少：配图选择 -->
                <rect x="500" y="155" width="80" height="25" fill="#84CC16" opacity="0.8"/>
                <line x1="480" y1="155" x2="500" y2="155" stroke="#94A3B8" stroke-width="1" stroke-dasharray="4,2"/>
                <text x="540" y="145" text-anchor="middle" fill="#84CC16" font-size="9">-20min</text>
                <text x="540" y="270" text-anchor="middle" fill="#334155" font-size="8">AI配图</text>
                
                <!-- 减少：反复修改 -->
                <rect x="600" y="180" width="80" height="20" fill="#22C55E" opacity="0.8"/>
                <line x1="580" y1="180" x2="600" y2="180" stroke="#94A3B8" stroke-width="1" stroke-dasharray="4,2"/>
                <text x="640" y="170" text-anchor="middle" fill="#22C55E" font-size="9">-9.5min</text>
                <text x="640" y="270" text-anchor="middle" fill="#334155" font-size="8">一键生成</text>
                
                <!-- 最终结果柱 -->
                <rect x="720" y="245" width="80" height="5" fill="#4f46e5"/>
                <line x1="680" y1="200" x2="720" y2="245" stroke="#4f46e5" stroke-width="2" stroke-dasharray="6,3"/>
                <text x="760" y="235" text-anchor="middle" fill="#4f46e5" font-size="11" font-weight="bold">0.5min</text>
                <text x="760" y="270" text-anchor="middle" fill="#4f46e5" font-size="9" font-weight="bold">Paper Burner</text>
                
                <!-- 效率提升标注 -->
                <line x1="820" y1="50" x2="820" y2="245" stroke="#4f46e5" stroke-width="2"/>
                <line x1="815" y1="50" x2="825" y2="50" stroke="#4f46e5" stroke-width="2"/>
                <line x1="815" y1="245" x2="825" y2="245" stroke="#4f46e5" stroke-width="2"/>
                <rect x="830" y="130" width="90" height="30" fill="#4f46e5" rx="3"/>
                <text x="875" y="150" text-anchor="middle" fill="#fff" font-size="11" font-weight="bold">效率提升 240x</text>
            </svg>
        </div>
        
        <!-- 底部流程说明 -->
        <div data-el="text" data-x="3%" data-y="70%" data-w="94%" data-h="auto" data-font="9" data-color="#4f46e5" data-bold="true">PROCESS BREAKDOWN</div>
        
        <!-- 流程步骤 -->
        <div data-el="shape" data-shape="rect" data-x="3%" data-y="74%" data-w="18%" data-h="14%" data-fill="#eef2ff" data-radius="3" data-stroke="#c7d2fe"></div>
        <div data-el="text" data-x="4%" data-y="76%" data-w="16%" data-h="auto" data-font="8" data-color="#4f46e5" data-bold="true">Step 1: 上传</div>
        <div data-el="text" data-x="4%" data-y="80%" data-w="16%" data-h="auto" data-font="7" data-color="#64748B">拖拽或粘贴文档</div>
        <div data-el="text" data-x="4%" data-y="84%" data-w="16%" data-h="auto" data-font="9" data-color="#4f46e5" data-bold="true">~5s</div>
        
        <div data-el="shape" data-shape="rect" data-x="22%" data-y="74%" data-w="18%" data-h="14%" data-fill="#eef2ff" data-radius="3" data-stroke="#c7d2fe"></div>
        <div data-el="text" data-x="23%" data-y="76%" data-w="16%" data-h="auto" data-font="8" data-color="#4f46e5" data-bold="true">Step 2: 解析</div>
        <div data-el="text" data-x="23%" data-y="80%" data-w="16%" data-h="auto" data-font="7" data-color="#64748B">AI语义理解</div>
        <div data-el="text" data-x="23%" data-y="84%" data-w="16%" data-h="auto" data-font="9" data-color="#4f46e5" data-bold="true">~8s</div>
        
        <div data-el="shape" data-shape="rect" data-x="41%" data-y="74%" data-w="18%" data-h="14%" data-fill="#eef2ff" data-radius="3" data-stroke="#c7d2fe"></div>
        <div data-el="text" data-x="42%" data-y="76%" data-w="16%" data-h="auto" data-font="8" data-color="#4f46e5" data-bold="true">Step 3: 生成</div>
        <div data-el="text" data-x="42%" data-y="80%" data-w="16%" data-h="auto" data-font="7" data-color="#64748B">自动排版配色</div>
        <div data-el="text" data-x="42%" data-y="84%" data-w="16%" data-h="auto" data-font="9" data-color="#4f46e5" data-bold="true">~15s</div>
        
        <div data-el="shape" data-shape="rect" data-x="60%" data-y="74%" data-w="18%" data-h="14%" data-fill="#eef2ff" data-radius="3" data-stroke="#c7d2fe"></div>
        <div data-el="text" data-x="61%" data-y="76%" data-w="16%" data-h="auto" data-font="8" data-color="#4f46e5" data-bold="true">Step 4: 微调</div>
        <div data-el="text" data-x="61%" data-y="80%" data-w="16%" data-h="auto" data-font="7" data-color="#64748B">可视化编辑</div>
        <div data-el="text" data-x="61%" data-y="84%" data-w="16%" data-h="auto" data-font="9" data-color="#4f46e5" data-bold="true">可选</div>
        
        <div data-el="shape" data-shape="rect" data-x="79%" data-y="74%" data-w="18%" data-h="14%" data-fill="#4f46e5" data-radius="3"></div>
        <div data-el="text" data-x="80%" data-y="76%" data-w="16%" data-h="auto" data-font="8" data-color="#a5b4fc" data-bold="true">Step 5: 导出</div>
        <div data-el="text" data-x="80%" data-y="80%" data-w="16%" data-h="auto" data-font="7" data-color="#c7d2fe">一键下载PPTX</div>
        <div data-el="text" data-x="80%" data-y="84%" data-w="16%" data-h="auto" data-font="9" data-color="#ffffff" data-bold="true">~2s</div>
        
        <!-- 底部来源 -->
        <div data-el="line" data-x1="3%" data-y1="92%" data-x2="97%" data-y2="92%" data-stroke="#E2E8F0" data-stroke-width="1"></div>
        <div data-el="text" data-x="3%" data-y="94%" data-w="70%" data-h="auto" data-font="7" data-color="#94A3B8">Source: Time-motion study comparing traditional PPT creation vs Paper Burner, 2024 | Sample size: 500+ users</div>
        <div data-el="text" data-x="85%" data-y="94%" data-w="12%" data-h="auto" data-font="7" data-color="#94A3B8" data-align="right">Page 3 of 5</div>
    </section>

    <!-- 4. 雷达图能力分析 - 复杂版 -->
    <section data-type="freeform" id="landing-4" data-bg="#ffffff">
        <!-- 背景渐变 -->
        <div data-el="svg" data-x="0%" data-y="0%" data-w="100%" data-h="100%">
            <svg viewBox="0 0 960 540" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <radialGradient id="bg4a" cx="80%" cy="40%" r="45%">
                        <stop offset="0%" style="stop-color:#a5b4fc;stop-opacity:0.06"/>
                        <stop offset="100%" style="stop-color:#a5b4fc;stop-opacity:0"/>
                    </radialGradient>
                    <radialGradient id="bg4b" cx="15%" cy="70%" r="35%">
                        <stop offset="0%" style="stop-color:#4f46e5;stop-opacity:0.04"/>
                        <stop offset="100%" style="stop-color:#4f46e5;stop-opacity:0"/>
                    </radialGradient>
                </defs>
                <rect width="960" height="540" fill="url(#bg4a)"/>
                <rect width="960" height="540" fill="url(#bg4b)"/>
            </svg>
        </div>
        
        <!-- 顶部色条 -->
        <div data-el="shape" data-shape="rect" data-x="0%" data-y="0%" data-w="100%" data-h="1.2%" data-fill="#4f46e5"></div>
        
        <!-- 标题区 -->
        <div data-el="text" data-x="3%" data-y="3%" data-w="70%" data-h="auto" data-font="9" data-color="#4f46e5" data-bold="true">CAPABILITY ASSESSMENT</div>
        <div data-el="text" data-x="3%" data-y="6%" data-w="94%" data-h="auto" data-font="18" data-color="#0F172A" data-bold="true">六维能力雷达图：Paper Burner X vs 传统方案全方位对比</div>
        
        <!-- 右上角 Logo -->
        <div data-el="image" data-x="80%" data-y="3%" data-w="18%" data-h="7%" data-src="public/h_with_name.svg" data-fit="contain"></div>
        
        <!-- 分隔线 -->
        <div data-el="line" data-x1="3%" data-y1="11%" data-x2="97%" data-y2="11%" data-stroke="#E2E8F0" data-stroke-width="1"></div>
        
        <!-- 雷达图 SVG -->
        <div data-el="svg" data-x="3%" data-y="13%" data-w="55%" data-h="75%">
            <svg viewBox="0 0 550 420" xmlns="http://www.w3.org/2000/svg">
                <!-- 六边形网格 -->
                <polygon points="275,50 445,130 445,290 275,370 105,290 105,130" fill="none" stroke="#E2E8F0" stroke-width="1"/>
                <polygon points="275,90 405,150 405,270 275,330 145,270 145,150" fill="none" stroke="#E2E8F0" stroke-width="1"/>
                <polygon points="275,130 365,170 365,250 275,290 185,250 185,170" fill="none" stroke="#E2E8F0" stroke-width="1"/>
                <polygon points="275,170 325,190 325,230 275,250 225,230 225,190" fill="none" stroke="#E2E8F0" stroke-width="1"/>
                
                <!-- 轴线 -->
                <line x1="275" y1="210" x2="275" y2="50" stroke="#94A3B8" stroke-width="1"/>
                <line x1="275" y1="210" x2="445" y2="130" stroke="#94A3B8" stroke-width="1"/>
                <line x1="275" y1="210" x2="445" y2="290" stroke="#94A3B8" stroke-width="1"/>
                <line x1="275" y1="210" x2="275" y2="370" stroke="#94A3B8" stroke-width="1"/>
                <line x1="275" y1="210" x2="105" y2="290" stroke="#94A3B8" stroke-width="1"/>
                <line x1="275" y1="210" x2="105" y2="130" stroke="#94A3B8" stroke-width="1"/>
                
                <!-- 传统方案数据 (灰色) -->
                <polygon points="275,150 325,175 325,245 275,270 225,245 225,175" fill="#94A3B8" opacity="0.3" stroke="#64748B" stroke-width="2"/>
                
                <!-- Paper Burner 数据 (青绿色) -->
                <polygon points="275,60 435,135 435,285 275,360 115,285 115,135" fill="#4f46e5" opacity="0.25" stroke="#4f46e5" stroke-width="2"/>
                
                <!-- 数据点 - Paper Burner -->
                <circle cx="275" cy="60" r="6" fill="#4f46e5"/>
                <circle cx="435" cy="135" r="6" fill="#4f46e5"/>
                <circle cx="435" cy="285" r="6" fill="#4f46e5"/>
                <circle cx="275" cy="360" r="6" fill="#4f46e5"/>
                <circle cx="115" cy="285" r="6" fill="#4f46e5"/>
                <circle cx="115" cy="135" r="6" fill="#4f46e5"/>
                
                <!-- 数据点 - 传统方案 -->
                <circle cx="275" cy="150" r="4" fill="#64748B"/>
                <circle cx="325" cy="175" r="4" fill="#64748B"/>
                <circle cx="325" cy="245" r="4" fill="#64748B"/>
                <circle cx="275" cy="270" r="4" fill="#64748B"/>
                <circle cx="225" cy="245" r="4" fill="#64748B"/>
                <circle cx="225" cy="175" r="4" fill="#64748B"/>
                
                <!-- 维度标签 -->
                <text x="275" y="35" text-anchor="middle" fill="#0F172A" font-size="11" font-weight="bold">生成速度</text>
                <text x="275" y="47" text-anchor="middle" fill="#4f46e5" font-size="9">98分</text>
                
                <text x="465" y="130" text-anchor="start" fill="#0F172A" font-size="11" font-weight="bold">内容质量</text>
                <text x="465" y="142" text-anchor="start" fill="#4f46e5" font-size="9">95分</text>
                
                <text x="465" y="295" text-anchor="start" fill="#0F172A" font-size="11" font-weight="bold">设计美感</text>
                <text x="465" y="307" text-anchor="start" fill="#4f46e5" font-size="9">92分</text>
                
                <text x="275" y="395" text-anchor="middle" fill="#0F172A" font-size="11" font-weight="bold">易用性</text>
                <text x="275" y="407" text-anchor="middle" fill="#4f46e5" font-size="9">99分</text>
                
                <text x="85" y="295" text-anchor="end" fill="#0F172A" font-size="11" font-weight="bold">成本效益</text>
                <text x="85" y="307" text-anchor="end" fill="#4f46e5" font-size="9">100分</text>
                
                <text x="85" y="130" text-anchor="end" fill="#0F172A" font-size="11" font-weight="bold">兼容性</text>
                <text x="85" y="142" text-anchor="end" fill="#4f46e5" font-size="9">95分</text>
            </svg>
        </div>
        
        <!-- 右侧图例 -->
        <div data-el="text" data-x="60%" data-y="14%" data-w="37%" data-h="auto" data-font="9" data-color="#4f46e5" data-bold="true">LEGEND</div>
        
        <div data-el="shape" data-shape="rect" data-x="60%" data-y="18%" data-w="3%" data-h="2.5%" data-fill="#4f46e5" data-opacity="0.6"></div>
        <div data-el="text" data-x="64%" data-y="18.5%" data-w="33%" data-h="auto" data-font="8" data-color="#0F172A" data-bold="true">Paper Burner</div>
        
        <div data-el="shape" data-shape="rect" data-x="60%" data-y="22%" data-w="3%" data-h="2.5%" data-fill="#94A3B8" data-opacity="0.5"></div>
        <div data-el="text" data-x="64%" data-y="22.5%" data-w="33%" data-h="auto" data-font="8" data-color="#0F172A">传统方案</div>
        
        <!-- 详细分数表 -->
        <div data-el="text" data-x="60%" data-y="28%" data-w="37%" data-h="auto" data-font="9" data-color="#4f46e5" data-bold="true">DETAILED SCORES</div>
        
        <div data-el="shape" data-shape="rect" data-x="60%" data-y="32%" data-w="37%" data-h="45%" data-fill="#F8FAFC" data-radius="3" data-stroke="#E2E8F0"></div>
        
        <!-- 表头 -->
        <div data-el="text" data-x="61%" data-y="34%" data-w="15%" data-h="auto" data-font="8" data-color="#64748B" data-bold="true">维度</div>
        <div data-el="text" data-x="77%" data-y="34%" data-w="8%" data-h="auto" data-font="8" data-color="#4f46e5" data-bold="true">PB</div>
        <div data-el="text" data-x="86%" data-y="34%" data-w="8%" data-h="auto" data-font="8" data-color="#64748B" data-bold="true">传统</div>
        <div data-el="text" data-x="93%" data-y="34%" data-w="5%" data-h="auto" data-font="8" data-color="#64748B" data-bold="true">Δ</div>
        
        <div data-el="line" data-x1="61%" data-y1="37%" data-x2="96%" data-y2="37%" data-stroke="#E2E8F0" data-stroke-width="1"></div>
        
        <!-- 数据行 -->
        <div data-el="text" data-x="61%" data-y="40%" data-w="15%" data-h="auto" data-font="8" data-color="#0F172A">生成速度</div>
        <div data-el="text" data-x="77%" data-y="40%" data-w="8%" data-h="auto" data-font="8" data-color="#4f46e5" data-bold="true">98</div>
        <div data-el="text" data-x="86%" data-y="40%" data-w="8%" data-h="auto" data-font="8" data-color="#64748B">35</div>
        <div data-el="text" data-x="93%" data-y="40%" data-w="5%" data-h="auto" data-font="8" data-color="#4f46e5" data-bold="true">+63</div>
        
        <div data-el="text" data-x="61%" data-y="45%" data-w="15%" data-h="auto" data-font="8" data-color="#0F172A">内容质量</div>
        <div data-el="text" data-x="77%" data-y="45%" data-w="8%" data-h="auto" data-font="8" data-color="#4f46e5" data-bold="true">95</div>
        <div data-el="text" data-x="86%" data-y="45%" data-w="8%" data-h="auto" data-font="8" data-color="#64748B">60</div>
        <div data-el="text" data-x="93%" data-y="45%" data-w="5%" data-h="auto" data-font="8" data-color="#4f46e5" data-bold="true">+35</div>
        
        <div data-el="text" data-x="61%" data-y="50%" data-w="15%" data-h="auto" data-font="8" data-color="#0F172A">设计美感</div>
        <div data-el="text" data-x="77%" data-y="50%" data-w="8%" data-h="auto" data-font="8" data-color="#4f46e5" data-bold="true">92</div>
        <div data-el="text" data-x="86%" data-y="50%" data-w="8%" data-h="auto" data-font="8" data-color="#64748B">45</div>
        <div data-el="text" data-x="93%" data-y="50%" data-w="5%" data-h="auto" data-font="8" data-color="#4f46e5" data-bold="true">+47</div>
        
        <div data-el="text" data-x="61%" data-y="55%" data-w="15%" data-h="auto" data-font="8" data-color="#0F172A">易用性</div>
        <div data-el="text" data-x="77%" data-y="55%" data-w="8%" data-h="auto" data-font="8" data-color="#4f46e5" data-bold="true">99</div>
        <div data-el="text" data-x="86%" data-y="55%" data-w="8%" data-h="auto" data-font="8" data-color="#64748B">50</div>
        <div data-el="text" data-x="93%" data-y="55%" data-w="5%" data-h="auto" data-font="8" data-color="#4f46e5" data-bold="true">+49</div>
        
        <div data-el="text" data-x="61%" data-y="60%" data-w="15%" data-h="auto" data-font="8" data-color="#0F172A">成本效益</div>
        <div data-el="text" data-x="77%" data-y="60%" data-w="8%" data-h="auto" data-font="8" data-color="#4f46e5" data-bold="true">100</div>
        <div data-el="text" data-x="86%" data-y="60%" data-w="8%" data-h="auto" data-font="8" data-color="#64748B">20</div>
        <div data-el="text" data-x="93%" data-y="60%" data-w="5%" data-h="auto" data-font="8" data-color="#4f46e5" data-bold="true">+80</div>
        
        <div data-el="text" data-x="61%" data-y="65%" data-w="15%" data-h="auto" data-font="8" data-color="#0F172A">兼容性</div>
        <div data-el="text" data-x="77%" data-y="65%" data-w="8%" data-h="auto" data-font="8" data-color="#4f46e5" data-bold="true">95</div>
        <div data-el="text" data-x="86%" data-y="65%" data-w="8%" data-h="auto" data-font="8" data-color="#64748B">70</div>
        <div data-el="text" data-x="93%" data-y="65%" data-w="5%" data-h="auto" data-font="8" data-color="#4f46e5" data-bold="true">+25</div>
        
        <div data-el="line" data-x1="61%" data-y1="69%" data-x2="96%" data-y2="69%" data-stroke="#E2E8F0" data-stroke-width="1"></div>
        
        <div data-el="text" data-x="61%" data-y="72%" data-w="15%" data-h="auto" data-font="8" data-color="#0F172A" data-bold="true">平均分</div>
        <div data-el="text" data-x="77%" data-y="72%" data-w="8%" data-h="auto" data-font="9" data-color="#4f46e5" data-bold="true">96.5</div>
        <div data-el="text" data-x="86%" data-y="72%" data-w="8%" data-h="auto" data-font="9" data-color="#64748B" data-bold="true">46.7</div>
        <div data-el="text" data-x="93%" data-y="72%" data-w="5%" data-h="auto" data-font="9" data-color="#4f46e5" data-bold="true">+50</div>
        
        <!-- 关键结论 -->
        <div data-el="shape" data-shape="rect" data-x="60%" data-y="80%" data-w="37%" data-h="8%" data-fill="#4f46e5" data-radius="3"></div>
        <div data-el="text" data-x="61%" data-y="82.5%" data-w="35%" data-h="auto" data-font="9" data-color="#ffffff" data-bold="true">综合评分领先传统方案 107%</div>
        
        <!-- 底部来源 -->
        <div data-el="line" data-x1="3%" data-y1="92%" data-x2="97%" data-y2="92%" data-stroke="#E2E8F0" data-stroke-width="1"></div>
        <div data-el="text" data-x="3%" data-y="94%" data-w="70%" data-h="auto" data-font="7" data-color="#94A3B8">Source: Internal capability assessment, 2024 Q4 | Scoring: 0-100 scale based on user feedback and benchmarks</div>
        <div data-el="text" data-x="85%" data-y="94%" data-w="12%" data-h="auto" data-font="7" data-color="#94A3B8" data-align="right">Page 4 of 5</div>
    </section>

    <!-- 5. 执行建议页 - 复杂版 -->
    <section data-type="freeform" id="landing-5" data-bg="#ffffff">
        <!-- 背景渐变 -->
        <div data-el="svg" data-x="0%" data-y="0%" data-w="100%" data-h="100%">
            <svg viewBox="0 0 960 540" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <radialGradient id="bg5a" cx="50%" cy="30%" r="50%">
                        <stop offset="0%" style="stop-color:#6366f1;stop-opacity:0.06"/>
                        <stop offset="100%" style="stop-color:#6366f1;stop-opacity:0"/>
                    </radialGradient>
                    <radialGradient id="bg5b" cx="20%" cy="90%" r="40%">
                        <stop offset="0%" style="stop-color:#818cf8;stop-opacity:0.05"/>
                        <stop offset="100%" style="stop-color:#818cf8;stop-opacity:0"/>
                    </radialGradient>
                </defs>
                <rect width="960" height="540" fill="url(#bg5a)"/>
                <rect width="960" height="540" fill="url(#bg5b)"/>
            </svg>
        </div>
        
        <!-- 顶部色条 -->
        <div data-el="shape" data-shape="rect" data-x="0%" data-y="0%" data-w="100%" data-h="1.2%" data-fill="#4f46e5"></div>
        
        <!-- 标题区 -->
        <div data-el="text" data-x="3%" data-y="3%" data-w="70%" data-h="auto" data-font="9" data-color="#4f46e5" data-bold="true">EXECUTIVE RECOMMENDATIONS</div>
        <div data-el="text" data-x="3%" data-y="6%" data-w="94%" data-h="auto" data-font="18" data-color="#0F172A" data-bold="true">执行建议与下一步行动：立即开启智能演示新时代</div>
        
        <!-- 右上角 Logo -->
        <div data-el="image" data-x="80%" data-y="3%" data-w="18%" data-h="7%" data-src="public/h_with_name.svg" data-fit="contain"></div>
        
        <!-- 分隔线 -->
        <div data-el="line" data-x1="3%" data-y1="11%" data-x2="97%" data-y2="11%" data-stroke="#E2E8F0" data-stroke-width="1"></div>
        
        <!-- 三列建议 -->
        <div data-el="shape" data-shape="rect" data-x="3%" data-y="14%" data-w="30%" data-h="50%" data-fill="#eef2ff" data-radius="4" data-stroke="#c7d2fe"></div>
        <div data-el="shape" data-shape="rect" data-x="3%" data-y="14%" data-w="30%" data-h="8%" data-fill="#4f46e5" data-radius="4 4 0 0"></div>
        <div data-el="text" data-x="4%" data-y="16%" data-w="28%" data-h="auto" data-font="10" data-color="#ffffff" data-bold="true">IMMEDIATE ACTIONS</div>
        <div data-el="text" data-x="4%" data-y="24%" data-w="28%" data-h="auto" data-font="8" data-color="#0F172A" data-bold="true">1. 访问 Paper Burner X</div>
        <div data-el="text" data-x="4%" data-y="28%" data-w="28%" data-h="auto" data-font="7" data-color="#64748B">无需下载安装，浏览器直接使用</div>
        <div data-el="text" data-x="4%" data-y="34%" data-w="28%" data-h="auto" data-font="8" data-color="#0F172A" data-bold="true">2. 上传文档</div>
        <div data-el="text" data-x="4%" data-y="38%" data-w="28%" data-h="auto" data-font="7" data-color="#64748B">支持Word/PDF/Markdown等格式</div>
        <div data-el="text" data-x="4%" data-y="44%" data-w="28%" data-h="auto" data-font="8" data-color="#0F172A" data-bold="true">3. 一键生成</div>
        <div data-el="text" data-x="4%" data-y="48%" data-w="28%" data-h="auto" data-font="7" data-color="#64748B">AI自动完成全部设计工作</div>
        <div data-el="text" data-x="4%" data-y="54%" data-w="28%" data-h="auto" data-font="8" data-color="#0F172A" data-bold="true">4. 导出PPTX</div>
        <div data-el="text" data-x="4%" data-y="58%" data-w="28%" data-h="auto" data-font="7" data-color="#64748B">原生格式，完美兼容Office</div>
        
        <div data-el="shape" data-shape="rect" data-x="35%" data-y="14%" data-w="30%" data-h="50%" data-fill="#eef2ff" data-radius="4" data-stroke="#c7d2fe"></div>
        <div data-el="shape" data-shape="rect" data-x="35%" data-y="14%" data-w="30%" data-h="8%" data-fill="#4f46e5" data-radius="4 4 0 0"></div>
        <div data-el="text" data-x="36%" data-y="16%" data-w="28%" data-h="auto" data-font="10" data-color="#ffffff" data-bold="true">KEY BENEFITS</div>
        <div data-el="text" data-x="36%" data-y="24%" data-w="28%" data-h="auto" data-font="8" data-color="#0F172A" data-bold="true">✓ 效率提升 240x</div>
        <div data-el="text" data-x="36%" data-y="28%" data-w="28%" data-h="auto" data-font="7" data-color="#64748B">2小时工作量缩减至30秒</div>
        <div data-el="text" data-x="36%" data-y="34%" data-w="28%" data-h="auto" data-font="8" data-color="#0F172A" data-bold="true">✓ 专业级品质</div>
        <div data-el="text" data-x="36%" data-y="38%" data-w="28%" data-h="auto" data-font="7" data-color="#64748B">设计师水准的排版配色</div>
        <div data-el="text" data-x="36%" data-y="44%" data-w="28%" data-h="auto" data-font="8" data-color="#0F172A" data-bold="true">✓ 零成本使用</div>
        <div data-el="text" data-x="36%" data-y="48%" data-w="28%" data-h="auto" data-font="7" data-color="#64748B">完全免费，本地运行</div>
        <div data-el="text" data-x="36%" data-y="54%" data-w="28%" data-h="auto" data-font="8" data-color="#0F172A" data-bold="true">✓ 数据安全</div>
        <div data-el="text" data-x="36%" data-y="58%" data-w="28%" data-h="auto" data-font="7" data-color="#64748B">无需上传云端，隐私有保障</div>
        
        <div data-el="shape" data-shape="rect" data-x="67%" data-y="14%" data-w="30%" data-h="50%" data-fill="#eef2ff" data-radius="4" data-stroke="#c7d2fe"></div>
        <div data-el="shape" data-shape="rect" data-x="67%" data-y="14%" data-w="30%" data-h="8%" data-fill="#4f46e5" data-radius="4 4 0 0"></div>
        <div data-el="text" data-x="68%" data-y="16%" data-w="28%" data-h="auto" data-font="10" data-color="#ffffff" data-bold="true">USE CASES</div>
        <div data-el="text" data-x="68%" data-y="24%" data-w="28%" data-h="auto" data-font="8" data-color="#0F172A" data-bold="true">• 商业计划书</div>
        <div data-el="text" data-x="68%" data-y="28%" data-w="28%" data-h="auto" data-font="7" data-color="#64748B">投资路演、融资BP</div>
        <div data-el="text" data-x="68%" data-y="34%" data-w="28%" data-h="auto" data-font="8" data-color="#0F172A" data-bold="true">• 工作汇报</div>
        <div data-el="text" data-x="68%" data-y="38%" data-w="28%" data-h="auto" data-font="7" data-color="#64748B">周报月报、项目总结</div>
        <div data-el="text" data-x="68%" data-y="44%" data-w="28%" data-h="auto" data-font="8" data-color="#0F172A" data-bold="true">• 学术演讲</div>
        <div data-el="text" data-x="68%" data-y="48%" data-w="28%" data-h="auto" data-font="7" data-color="#64748B">论文答辩、课题汇报</div>
        <div data-el="text" data-x="68%" data-y="54%" data-w="28%" data-h="auto" data-font="8" data-color="#0F172A" data-bold="true">• 产品发布</div>
        <div data-el="text" data-x="68%" data-y="58%" data-w="28%" data-h="auto" data-font="7" data-color="#64748B">新品介绍、功能演示</div>
        
        <!-- CTA 区域 -->
        <div data-el="shape" data-shape="rect" data-x="3%" data-y="68%" data-w="94%" data-h="20%" data-fill="#0F172A" data-radius="6"></div>
        <div data-el="text" data-x="10%" data-y="72%" data-w="40%" data-h="auto" data-font="14" data-color="#ffffff" data-bold="true">准备好提升效率了吗？</div>
        <div data-el="text" data-x="10%" data-y="78%" data-w="50%" data-h="auto" data-font="10" data-color="#94A3B8">立即体验 Paper Burner X，开启智能演示新时代</div>
        
        <div data-el="shape" data-shape="rect" data-x="70%" data-y="72%" data-w="24%" data-h="10%" data-fill="#4f46e5" data-radius="4"></div>
        <div data-el="text" data-x="70%" data-y="75%" data-w="24%" data-h="auto" data-font="12" data-color="#ffffff" data-align="center" data-bold="true">立即开始 →</div>
        
        <!-- 底部来源 -->
        <div data-el="line" data-x1="3%" data-y1="92%" data-x2="97%" data-y2="92%" data-stroke="#E2E8F0" data-stroke-width="1"></div>
        <div data-el="text" data-x="3%" data-y="94%" data-w="50%" data-h="auto" data-font="7" data-color="#94A3B8">Paper Burner X · AI Presentation Generator · 2024</div>
        <div data-el="text" data-x="60%" data-y="94%" data-w="25%" data-h="auto" data-font="7" data-color="#94A3B8">免费 · 无需注册 · 本地运行</div>
        <div data-el="text" data-x="85%" data-y="94%" data-w="12%" data-h="auto" data-font="7" data-color="#94A3B8" data-align="right">Page 5 of 5</div>
    </section>
`;

window.PPT_LANDING_SAMPLE_HTML = PPT_LANDING_SAMPLE_HTML;

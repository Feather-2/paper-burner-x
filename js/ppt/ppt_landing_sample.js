    /**
 * Landing Page 展示用示例 - Paper Burner X 风格
 * 主色：#4f46e5 (Indigo) | 白色底 + 淡蓝紫渐变
 * 优化版：视觉规整化 + 精致复杂度（增加质感与细节）
 */
const PPT_LANDING_SAMPLE_HTML = `
    <!-- 1. 封面页 - 核心价值模型 (精致版) -->
    <section data-type="freeform" id="landing-1" data-bg="#ffffff">
        <!-- 顶部导航条 -->
        <div data-el="shape" data-shape="rect" data-x="0%" data-y="0%" data-w="100%" data-h="1.2%" data-fill="#4f46e5"></div>
        
        <!-- 标题区 -->
        <div data-el="text" data-x="5%" data-y="5%" data-w="90%" data-h="auto" data-font="10" data-color="#4f46e5" data-bold="true" data-spacing="2">STRATEGIC FRAMEWORK</div>
        <div data-el="text" data-x="5%" data-y="8%" data-w="90%" data-h="auto" data-font="20" data-color="#0F172A" data-bold="true">三维价值模型：效率、质量与成本的动态平衡</div>
        <div data-el="line" data-x1="5%" data-y1="14%" data-x2="95%" data-y2="14%" data-stroke="#E2E8F0" data-stroke-width="1"></div>

        <!-- 左侧：金字塔模型 SVG (增加质感) -->
        <div data-el="svg" data-x="5%" data-y="18%" data-w="55%" data-h="70%">
            <svg viewBox="0 0 550 400" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <linearGradient id="gradBase" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" style="stop-color:#4f46e5;stop-opacity:0.05"/>
                        <stop offset="100%" style="stop-color:#4f46e5;stop-opacity:0.15"/>
                    </linearGradient>
                    <linearGradient id="gradMid" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" style="stop-color:#4f46e5;stop-opacity:0.2"/>
                        <stop offset="100%" style="stop-color:#4f46e5;stop-opacity:0.4"/>
                    </linearGradient>
                    <linearGradient id="gradTop" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" style="stop-color:#6366f1;stop-opacity:0.9"/>
                        <stop offset="100%" style="stop-color:#4f46e5;stop-opacity:1"/>
                    </linearGradient>
                    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
                        <feDropShadow dx="0" dy="4" stdDeviation="6" flood-opacity="0.1"/>
                    </filter>
                    <filter id="innerGlow" x="-20%" y="-20%" width="140%" height="140%">
                        <feGaussianBlur stdDeviation="2" result="blur"/>
                        <feComposite in="SourceGraphic" in2="blur" operator="arithmetic" k2="-1" k3="1"/>
                    </filter>
                </defs>

                <!-- 背景网格装饰 -->
                <g stroke="#F1F5F9" stroke-width="1" stroke-dasharray="4,4">
                    <line x1="0" y1="100" x2="550" y2="100"/>
                    <line x1="0" y1="200" x2="550" y2="200"/>
                    <line x1="0" y1="300" x2="550" y2="300"/>
                    <line x1="275" y1="0" x2="275" y2="400"/>
                </g>

                <!-- 核心金字塔结构 -->
                <!-- 底层：成本 (增加立体感) -->
                <path d="M50,350 L500,350 L425,230 L125,230 Z" fill="url(#gradBase)" stroke="#4f46e5" stroke-width="1" filter="url(#shadow)"/>
                <path d="M125,230 L425,230" stroke="#ffffff" stroke-width="1" stroke-opacity="0.5"/> <!-- 高光线 -->
                <text x="275" y="315" text-anchor="middle" fill="#4f46e5" font-size="12" font-weight="bold" letter-spacing="1">COST EFFICIENCY</text>
                <text x="275" y="335" text-anchor="middle" fill="#64748B" font-size="9">零成本 · 本地运行</text>
                <!-- 装饰点 -->
                <circle cx="275" cy="290" r="3" fill="#4f46e5" opacity="0.5"/>

                <!-- 中层：质量 -->
                <path d="M125,230 L425,230 L350,110 L200,110 Z" fill="url(#gradMid)" stroke="#4f46e5" stroke-width="1" filter="url(#shadow)"/>
                <path d="M200,110 L350,110" stroke="#ffffff" stroke-width="1" stroke-opacity="0.5"/>
                <text x="275" y="175" text-anchor="middle" fill="#ffffff" font-size="12" font-weight="bold" letter-spacing="1">QUALITY STANDARD</text>
                <text x="275" y="195" text-anchor="middle" fill="#E0E7FF" font-size="9">专业设计 · 智能排版</text>
                <circle cx="275" cy="150" r="3" fill="#ffffff" opacity="0.5"/>

                <!-- 顶层：效率 -->
                <path d="M200,110 L350,110 L275,20 Z" fill="url(#gradTop)" stroke="#4f46e5" stroke-width="1" filter="url(#shadow)"/>
                <text x="275" y="75" text-anchor="middle" fill="#ffffff" font-size="12" font-weight="bold" letter-spacing="1">SPEED</text>
                <text x="275" y="90" text-anchor="middle" fill="#E0E7FF" font-size="9">30s 生成</text>
                <!-- 顶部光晕 -->
                <circle cx="275" cy="45" r="15" fill="#ffffff" opacity="0.1"/>
                <circle cx="275" cy="45" r="8" fill="#ffffff" opacity="0.2"/>

                <!-- 连接线与标注 (增加箭头端点) -->
                <g stroke="#94A3B8" stroke-width="1" stroke-dasharray="2,2">
                    <line x1="500" y1="350" x2="530" y2="350"/>
                    <line x1="425" y1="230" x2="530" y2="230"/>
                    <line x1="350" y1="110" x2="530" y2="110"/>
                </g>
                <circle cx="530" cy="350" r="2" fill="#94A3B8"/>
                <text x="538" y="353" fill="#64748B" font-size="9" font-weight="bold">基础层</text>
                
                <circle cx="530" cy="230" r="2" fill="#94A3B8"/>
                <text x="538" y="233" fill="#64748B" font-size="9" font-weight="bold">核心层</text>
                
                <circle cx="530" cy="110" r="2" fill="#94A3B8"/>
                <text x="538" y="113" fill="#64748B" font-size="9" font-weight="bold">突破层</text>
            </svg>
        </div>

        <!-- 右上角 Logo -->
        <div data-el="image" data-x="82%" data-y="6%" data-w="14%" data-h="6%" data-src="public/h_with_name.svg" data-fit="contain"></div>

        <!-- 右侧：关键指标卡片 -->
        <div data-el="shape" data-shape="rect" data-x="65%" data-y="18%" data-w="30%" data-h="22%" data-fill="#ffffff" data-radius="4" data-stroke="#E2E8F0"></div>
        <div data-el="svg" data-x="67%" data-y="20%" data-w="4%" data-h="7%">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" fill="#EEF2FF"/><path d="M13 7L17 12L13 17M7 12H16" stroke="#4f46e5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div data-el="text" data-x="72%" data-y="21%" data-w="20%" data-h="auto" data-font="9" data-color="#64748B" data-bold="true">EFFICIENCY</div>
        <div data-el="text" data-x="67%" data-y="28%" data-w="26%" data-h="auto" data-font="24" data-color="#4f46e5" data-bold="true">240x</div>
        <div data-el="text" data-x="67%" data-y="35%" data-w="26%" data-h="auto" data-font="8" data-color="#94A3B8">对比传统人工制作</div>

        <div data-el="shape" data-shape="rect" data-x="65%" data-y="42%" data-w="30%" data-h="22%" data-fill="#ffffff" data-radius="4" data-stroke="#E2E8F0"></div>
        <div data-el="svg" data-x="67%" data-y="44%" data-w="4%" data-h="7%">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" fill="#EEF2FF"/><path d="M8 12L11 15L16 9" stroke="#4f46e5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div data-el="text" data-x="72%" data-y="45%" data-w="20%" data-h="auto" data-font="9" data-color="#64748B" data-bold="true">SATISFACTION</div>
        <div data-el="text" data-x="67%" data-y="52%" data-w="26%" data-h="auto" data-font="24" data-color="#4f46e5" data-bold="true">98%</div>
        <div data-el="text" data-x="67%" data-y="59%" data-w="26%" data-h="auto" data-font="8" data-color="#94A3B8">基于 5000+ 用户反馈</div>

        <div data-el="shape" data-shape="rect" data-x="65%" data-y="66%" data-w="30%" data-h="22%" data-fill="#ffffff" data-radius="4" data-stroke="#E2E8F0"></div>
        <div data-el="svg" data-x="67%" data-y="68%" data-w="4%" data-h="7%">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" fill="#EEF2FF"/><path d="M12 6V12L16 14" stroke="#4f46e5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div data-el="text" data-x="72%" data-y="69%" data-w="20%" data-h="auto" data-font="9" data-color="#64748B" data-bold="true">COST</div>
        <div data-el="text" data-x="67%" data-y="76%" data-w="26%" data-h="auto" data-font="24" data-color="#4f46e5" data-bold="true">$0</div>
        <div data-el="text" data-x="67%" data-y="83%" data-w="26%" data-h="auto" data-font="8" data-color="#94A3B8">完全免费，无隐形消费</div>

        <!-- 底部页码 -->
        <div data-el="text" data-x="90%" data-y="95%" data-w="5%" data-h="auto" data-font="8" data-color="#CBD5E1" data-align="right">01</div>
    </section>

    <!-- 2. 矩阵分析页 - 市场定位 (精致版) -->
    <section data-type="freeform" id="landing-2" data-bg="#ffffff">
        <div data-el="shape" data-shape="rect" data-x="0%" data-y="0%" data-w="100%" data-h="1.2%" data-fill="#4f46e5"></div>
        
        <div data-el="text" data-x="5%" data-y="5%" data-w="70%" data-h="auto" data-font="10" data-color="#4f46e5" data-bold="true" data-spacing="2">MARKET POSITIONING</div>
        <div data-el="text" data-x="5%" data-y="8%" data-w="75%" data-h="auto" data-font="20" data-color="#0F172A" data-bold="true">竞争格局分析：效率与质量的双重突破</div>
        <div data-el="image" data-x="82%" data-y="6%" data-w="14%" data-h="6%" data-src="public/h_with_name.svg" data-fit="contain"></div>
        <div data-el="line" data-x1="5%" data-y1="14%" data-x2="95%" data-y2="14%" data-stroke="#E2E8F0" data-stroke-width="1"></div>

        <!-- 左侧：2x2 矩阵 SVG (增加网格纹理) -->
        <div data-el="svg" data-x="5%" data-y="18%" data-w="60%" data-h="75%">
            <svg viewBox="0 0 600 450" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                        <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#E2E8F0" stroke-width="0.5"/>
                    </pattern>
                    <radialGradient id="glowSpot" cx="50%" cy="50%" r="50%">
                        <stop offset="0%" style="stop-color:#4f46e5;stop-opacity:0.2"/>
                        <stop offset="100%" style="stop-color:#4f46e5;stop-opacity:0"/>
                    </radialGradient>
                </defs>

                <!-- 象限背景 -->
                <rect x="50" y="50" width="250" height="175" fill="#F8FAFC" opacity="0.8"/> <!-- 左上 -->
                <rect x="300" y="50" width="250" height="175" fill="url(#grid)" opacity="0.5"/> <!-- 右上 (最优) -->
                <rect x="300" y="50" width="250" height="175" fill="#EEF2FF" opacity="0.3"/> <!-- 右上底色 -->
                <rect x="50" y="225" width="250" height="175" fill="#F8FAFC" opacity="0.8"/> <!-- 左下 -->
                <rect x="300" y="225" width="250" height="175" fill="#F8FAFC" opacity="0.8"/> <!-- 右下 -->

                <!-- 坐标轴 -->
                <line x1="300" y1="50" x2="300" y2="400" stroke="#CBD5E1" stroke-width="1" stroke-dasharray="4,4"/>
                <line x1="50" y1="225" x2="550" y2="225" stroke="#CBD5E1" stroke-width="1" stroke-dasharray="4,4"/>
                
                <line x1="50" y1="400" x2="550" y2="400" stroke="#334155" stroke-width="2" marker-end="url(#arrow)"/> <!-- X轴 -->
                <line x1="50" y1="400" x2="50" y2="50" stroke="#334155" stroke-width="2" marker-end="url(#arrow)"/> <!-- Y轴 -->

                <!-- 轴标签 -->
                <text x="300" y="430" text-anchor="middle" fill="#334155" font-size="12" font-weight="bold">生成效率 (Speed)</text>
                <text x="20" y="225" text-anchor="middle" fill="#334155" font-size="12" font-weight="bold" transform="rotate(-90,20,225)">输出质量 (Quality)</text>

                <!-- 象限标签 -->
                <text x="175" y="40" text-anchor="middle" fill="#64748B" font-size="10">高人力 / 高质量</text>
                <text x="425" y="40" text-anchor="middle" fill="#4f46e5" font-size="10" font-weight="bold">自动化 / 高质量</text>
                <text x="175" y="415" text-anchor="middle" fill="#94A3B8" font-size="10">低效 / 低质</text>
                <text x="425" y="415" text-anchor="middle" fill="#64748B" font-size="10">快速 / 模板化</text>

                <!-- 竞争对手散点 (增加光晕) -->
                <circle cx="150" cy="100" r="8" fill="#94A3B8" stroke="#fff" stroke-width="2"/>
                <text x="150" y="120" text-anchor="middle" fill="#64748B" font-size="9">人工设计</text>

                <circle cx="450" cy="300" r="8" fill="#94A3B8" stroke="#fff" stroke-width="2"/>
                <text x="450" y="320" text-anchor="middle" fill="#64748B" font-size="9">传统模板</text>

                <circle cx="100" cy="350" r="8" fill="#94A3B8" stroke="#fff" stroke-width="2"/>
                <text x="100" y="370" text-anchor="middle" fill="#64748B" font-size="9">手动制作</text>

                <!-- Paper Burner 核心点 (增加动态感) -->
                <circle cx="480" cy="80" r="50" fill="url(#glowSpot)"/>
                <circle cx="480" cy="80" r="12" fill="#4f46e5" stroke="#fff" stroke-width="2"/>
                <text x="480" y="110" text-anchor="middle" fill="#4f46e5" font-size="11" font-weight="bold">Paper Burner</text>
                
                <!-- 箭头指引 (曲线优化) -->
                <path d="M160,100 Q300,60 460,80" stroke="#4f46e5" stroke-width="1.5" stroke-dasharray="4,2" fill="none"/>
                <polygon points="460,80 450,75 450,85" fill="#4f46e5"/>
                <rect x="270" y="60" width="80" height="20" fill="#ffffff" rx="10" stroke="#4f46e5" stroke-width="1"/>
                <text x="310" y="73" text-anchor="middle" fill="#4f46e5" font-size="9" font-weight="bold">AI 赋能跃迁</text>
            </svg>
        </div>

        <!-- 右侧：图例与分析 -->
        <div data-el="text" data-x="68%" data-y="18%" data-w="27%" data-h="auto" data-font="10" data-color="#0F172A" data-bold="true">KEY INSIGHTS</div>
        
        <div data-el="shape" data-shape="rect" data-x="68%" data-y="23%" data-w="27%" data-h="18%" data-fill="#EEF2FF" data-radius="4" data-stroke="#C7D2FE"></div>
        <div data-el="text" data-x="70%" data-y="26%" data-w="23%" data-h="auto" data-font="9" data-color="#4f46e5" data-bold="true">最优象限领跑者</div>
        <div data-el="text" data-x="70%" data-y="31%" data-w="23%" data-h="auto" data-font="8" data-color="#64748B">Paper Burner 唯一同时实现了高效率与高质量，填补了市场空白。</div>

        <div data-el="text" data-x="68%" data-y="45%" data-w="27%" data-h="auto" data-font="9" data-color="#0F172A" data-bold="true" data-spacing="1">对比维度</div>
        
        <div data-el="line" data-x1="68%" data-y1="49%" data-x2="95%" data-y2="49%" data-stroke="#E2E8F0" data-stroke-width="1"></div>
        
        <div data-el="text" data-x="68%" data-y="52%" data-w="15%" data-h="auto" data-font="9" data-color="#64748B">生成速度</div>
        <div data-el="text" data-x="85%" data-y="52%" data-w="10%" data-h="auto" data-font="9" data-color="#4f46e5" data-bold="true" data-align="right">快 240x</div>
        
        <div data-el="text" data-x="68%" data-y="58%" data-w="15%" data-h="auto" data-font="9" data-color="#64748B">修改成本</div>
        <div data-el="text" data-x="85%" data-y="58%" data-w="10%" data-h="auto" data-font="9" data-color="#4f46e5" data-bold="true" data-align="right">低 99%</div>
        
        <div data-el="text" data-x="68%" data-y="64%" data-w="15%" data-h="auto" data-font="9" data-color="#64748B">设计一致性</div>
        <div data-el="text" data-x="85%" data-y="64%" data-w="10%" data-h="auto" data-font="9" data-color="#4f46e5" data-bold="true" data-align="right">100%</div>

        <!-- 底部页码 -->
        <div data-el="text" data-x="90%" data-y="95%" data-w="5%" data-h="auto" data-font="8" data-color="#CBD5E1" data-align="right">02</div>
    </section>

    <!-- 3. 瀑布图页 - 流程优化 (精致版) -->
    <section data-type="freeform" id="landing-3" data-bg="#ffffff">
        <div data-el="shape" data-shape="rect" data-x="0%" data-y="0%" data-w="100%" data-h="1.2%" data-fill="#4f46e5"></div>
        
        <div data-el="text" data-x="5%" data-y="5%" data-w="70%" data-h="auto" data-font="10" data-color="#4f46e5" data-bold="true" data-spacing="2">PROCESS OPTIMIZATION</div>
        <div data-el="text" data-x="5%" data-y="8%" data-w="75%" data-h="auto" data-font="20" data-color="#0F172A" data-bold="true">时间成本瀑布图：从 120 分钟到 30 秒</div>
        <div data-el="image" data-x="82%" data-y="6%" data-w="14%" data-h="6%" data-src="public/h_with_name.svg" data-fit="contain"></div>
        <div data-el="line" data-x1="5%" data-y1="14%" data-x2="95%" data-y2="14%" data-stroke="#E2E8F0" data-stroke-width="1"></div>

        <!-- 瀑布图 SVG (增加立体感) -->
        <div data-el="svg" data-x="5%" data-y="18%" data-w="90%" data-h="60%">
            <svg viewBox="0 0 900 350" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <filter id="barShadow" x="-10%" y="-10%" width="120%" height="120%">
                        <feDropShadow dx="2" dy="2" stdDeviation="2" flood-opacity="0.1"/>
                    </filter>
                </defs>

                <!-- 坐标轴 -->
                <line x1="50" y1="300" x2="850" y2="300" stroke="#334155" stroke-width="1"/>
                <text x="30" y="300" text-anchor="end" fill="#64748B" font-size="10">0</text>
                <text x="30" y="50" text-anchor="end" fill="#64748B" font-size="10">120m</text>
                <line x1="50" y1="300" x2="50" y2="50" stroke="#E2E8F0" stroke-width="1"/>
                <!-- 辅助线 -->
                <line x1="50" y1="175" x2="850" y2="175" stroke="#F1F5F9" stroke-width="1" stroke-dasharray="4,4"/>

                <!-- 1. 初始状态 (红) -->
                <rect x="70" y="50" width="80" height="250" fill="#EF4444" rx="2" filter="url(#barShadow)"/>
                <rect x="70" y="50" width="80" height="250" fill="url(#gradBase)" opacity="0.1"/> <!-- 纹理 -->
                <text x="110" y="40" text-anchor="middle" fill="#EF4444" font-size="12" font-weight="bold">120m</text>
                <text x="110" y="320" text-anchor="middle" fill="#334155" font-size="10" font-weight="bold">传统方式</text>

                <!-- 2. 减少规划 (橙) -->
                <rect x="190" y="50" width="80" height="50" fill="#F97316" fill-opacity="0.9" rx="2" filter="url(#barShadow)"/>
                <text x="230" y="120" text-anchor="middle" fill="#F97316" font-size="10">-40m 规划</text>
                <line x1="150" y1="50" x2="190" y2="50" stroke="#94A3B8" stroke-width="1" stroke-dasharray="2,2"/>

                <!-- 3. 减少制作 (黄) -->
                <rect x="310" y="100" width="80" height="100" fill="#F59E0B" fill-opacity="0.9" rx="2" filter="url(#barShadow)"/>
                <text x="350" y="220" text-anchor="middle" fill="#F59E0B" font-size="10">-50m 制作</text>
                <line x1="270" y1="100" x2="310" y2="100" stroke="#94A3B8" stroke-width="1" stroke-dasharray="2,2"/>

                <!-- 4. 减少修改 (绿) -->
                <rect x="430" y="200" width="80" height="90" fill="#84CC16" fill-opacity="0.9" rx="2" filter="url(#barShadow)"/>
                <text x="470" y="310" text-anchor="middle" fill="#84CC16" font-size="10">-29.5m 修改</text>
                <line x1="390" y1="200" x2="430" y2="200" stroke="#94A3B8" stroke-width="1" stroke-dasharray="2,2"/>

                <!-- 5. 最终状态 (蓝) -->
                <rect x="550" y="290" width="80" height="10" fill="#4f46e5" rx="2" filter="url(#barShadow)"/>
                <text x="590" y="280" text-anchor="middle" fill="#4f46e5" font-size="14" font-weight="bold">0.5m</text>
                <text x="590" y="320" text-anchor="middle" fill="#334155" font-size="10" font-weight="bold">Paper Burner</text>
                <line x1="510" y1="290" x2="550" y2="290" stroke="#94A3B8" stroke-width="1" stroke-dasharray="2,2"/>

                <!-- 总结框 (增加边框装饰) -->
                <rect x="680" y="100" width="180" height="120" fill="#ffffff" stroke="#E2E8F0" stroke-width="1" rx="4" filter="url(#barShadow)"/>
                <rect x="680" y="100" width="180" height="4" fill="#4f46e5" rx="2"/> <!-- 顶部色条 -->
                <text x="770" y="130" text-anchor="middle" fill="#64748B" font-size="10" font-weight="bold">TOTAL SAVINGS</text>
                <text x="770" y="170" text-anchor="middle" fill="#4f46e5" font-size="36" font-weight="bold">99.6%</text>
                <text x="770" y="200" text-anchor="middle" fill="#94A3B8" font-size="10">Time Reduction</text>
            </svg>
        </div>

        <!-- 底部步骤条 (增加图标) -->
        <div data-el="shape" data-shape="rect" data-x="5%" data-y="80%" data-w="90%" data-h="10%" data-fill="#F8FAFC" data-radius="4"></div>
        
        <div data-el="text" data-x="8%" data-y="83%" data-w="15%" data-h="auto" data-font="9" data-color="#4f46e5" data-bold="true">1. Upload</div>
        <div data-el="text" data-x="8%" data-y="86%" data-w="15%" data-h="auto" data-font="8" data-color="#64748B">上传文档 (5s)</div>
        
        <div data-el="line" data-x1="23%" data-y1="85%" data-x2="28%" data-y2="85%" data-stroke="#CBD5E1" data-stroke-width="1"></div>
        
        <div data-el="text" data-x="31%" data-y="83%" data-w="15%" data-h="auto" data-font="9" data-color="#4f46e5" data-bold="true">2. Analyze</div>
        <div data-el="text" data-x="31%" data-y="86%" data-w="15%" data-h="auto" data-font="8" data-color="#64748B">AI 解析 (10s)</div>
        
        <div data-el="line" data-x1="46%" data-y1="85%" data-x2="51%" data-y2="85%" data-stroke="#CBD5E1" data-stroke-width="1"></div>
        
        <div data-el="text" data-x="54%" data-y="83%" data-w="15%" data-h="auto" data-font="9" data-color="#4f46e5" data-bold="true">3. Generate</div>
        <div data-el="text" data-x="54%" data-y="86%" data-w="15%" data-h="auto" data-font="8" data-color="#64748B">自动生成 (15s)</div>
        
        <div data-el="line" data-x1="69%" data-y1="85%" data-x2="74%" data-y2="85%" data-stroke="#CBD5E1" data-stroke-width="1"></div>
        
        <div data-el="text" data-x="77%" data-y="83%" data-w="15%" data-h="auto" data-font="9" data-color="#4f46e5" data-bold="true">4. Export</div>
        <div data-el="text" data-x="77%" data-y="86%" data-w="15%" data-h="auto" data-font="8" data-color="#64748B">下载 PPTX (2s)</div>

        <!-- 底部页码 -->
        <div data-el="text" data-x="90%" data-y="95%" data-w="5%" data-h="auto" data-font="8" data-color="#CBD5E1" data-align="right">03</div>
    </section>

    <!-- 4. 雷达图页 - 能力评估 (精致版) -->
    <section data-type="freeform" id="landing-4" data-bg="#ffffff">
        <div data-el="shape" data-shape="rect" data-x="0%" data-y="0%" data-w="100%" data-h="1.2%" data-fill="#4f46e5"></div>
        
        <div data-el="text" data-x="5%" data-y="5%" data-w="70%" data-h="auto" data-font="10" data-color="#4f46e5" data-bold="true" data-spacing="2">CAPABILITY ASSESSMENT</div>
        <div data-el="text" data-x="5%" data-y="8%" data-w="75%" data-h="auto" data-font="20" data-color="#0F172A" data-bold="true">六维能力评估：全方位超越传统方案</div>
        <div data-el="image" data-x="82%" data-y="6%" data-w="14%" data-h="6%" data-src="public/h_with_name.svg" data-fit="contain"></div>
        <div data-el="line" data-x1="5%" data-y1="14%" data-x2="95%" data-y2="14%" data-stroke="#E2E8F0" data-stroke-width="1"></div>

        <!-- 左侧：雷达图 SVG (增加多层网格) -->
        <div data-el="svg" data-x="5%" data-y="18%" data-w="50%" data-h="70%">
            <svg viewBox="0 0 500 500" xmlns="http://www.w3.org/2000/svg">
                <!-- 网格 (增加虚线层) -->
                <g fill="none" stroke="#E2E8F0" stroke-width="1">
                    <polygon points="250,50 423,150 423,350 250,450 77,350 77,150"/>
                    <polygon points="250,100 380,175 380,325 250,400 120,325 120,175" stroke-dasharray="4,4"/>
                    <polygon points="250,150 336,200 336,300 250,350 164,300 164,200"/>
                    <polygon points="250,200 293,225 293,275 250,300 207,275 207,225" stroke-dasharray="4,4"/>
                </g>
                
                <!-- 轴线 -->
                <g stroke="#E2E8F0" stroke-width="1">
                    <line x1="250" y1="250" x2="250" y2="50"/>
                    <line x1="250" y1="250" x2="423" y2="150"/>
                    <line x1="250" y1="250" x2="423" y2="350"/>
                    <line x1="250" y1="250" x2="250" y2="450"/>
                    <line x1="250" y1="250" x2="77" y2="350"/>
                    <line x1="250" y1="250" x2="77" y2="150"/>
                </g>

                <!-- 传统方案 (灰) -->
                <polygon points="250,150 300,200 300,300 250,320 180,300 180,200" fill="#94A3B8" fill-opacity="0.2" stroke="#94A3B8" stroke-width="2"/>
                <circle cx="250" cy="150" r="3" fill="#94A3B8"/>
                <circle cx="300" cy="200" r="3" fill="#94A3B8"/>
                
                <!-- Paper Burner (蓝 + 光晕) -->
                <polygon points="250,60 410,160 410,340 250,440 90,340 90,160" fill="#4f46e5" fill-opacity="0.2" stroke="#4f46e5" stroke-width="2"/>
                <circle cx="250" cy="60" r="4" fill="#4f46e5" stroke="#fff" stroke-width="1"/>
                <circle cx="410" cy="160" r="4" fill="#4f46e5" stroke="#fff" stroke-width="1"/>
                <circle cx="410" cy="340" r="4" fill="#4f46e5" stroke="#fff" stroke-width="1"/>
                <circle cx="250" cy="440" r="4" fill="#4f46e5" stroke="#fff" stroke-width="1"/>
                <circle cx="90" cy="340" r="4" fill="#4f46e5" stroke="#fff" stroke-width="1"/>
                <circle cx="90" cy="160" r="4" fill="#4f46e5" stroke="#fff" stroke-width="1"/>

                <!-- 标签 -->
                <text x="250" y="35" text-anchor="middle" fill="#0F172A" font-size="12" font-weight="bold">速度</text>
                <text x="440" y="150" text-anchor="start" fill="#0F172A" font-size="12" font-weight="bold">质量</text>
                <text x="440" y="350" text-anchor="start" fill="#0F172A" font-size="12" font-weight="bold">美感</text>
                <text x="250" y="470" text-anchor="middle" fill="#0F172A" font-size="12" font-weight="bold">易用性</text>
                <text x="60" y="350" text-anchor="end" fill="#0F172A" font-size="12" font-weight="bold">成本</text>
                <text x="60" y="150" text-anchor="end" fill="#0F172A" font-size="12" font-weight="bold">兼容性</text>
            </svg>
        </div>

        <!-- 右侧：详细指标 (进度条) -->
        <div data-el="text" data-x="60%" data-y="18%" data-w="35%" data-h="auto" data-font="10" data-color="#0F172A" data-bold="true">PERFORMANCE METRICS</div>
        
        <div data-el="svg" data-x="60%" data-y="25%" data-w="35%" data-h="60%">
            <svg viewBox="0 0 350 300" xmlns="http://www.w3.org/2000/svg">
                <!-- 1. 速度 -->
                <text x="0" y="15" fill="#64748B" font-size="10">生成速度</text>
                <text x="350" y="15" fill="#4f46e5" font-size="10" font-weight="bold" text-anchor="end">98/100</text>
                <rect x="0" y="25" width="350" height="6" fill="#F1F5F9" rx="3"/>
                <rect x="0" y="25" width="343" height="6" fill="#4f46e5" rx="3"/>
                
                <!-- 2. 质量 -->
                <text x="0" y="65" fill="#64748B" font-size="10">内容质量</text>
                <text x="350" y="65" fill="#4f46e5" font-size="10" font-weight="bold" text-anchor="end">95/100</text>
                <rect x="0" y="75" width="350" height="6" fill="#F1F5F9" rx="3"/>
                <rect x="0" y="75" width="332" height="6" fill="#4f46e5" rx="3"/>
                
                <!-- 3. 美感 -->
                <text x="0" y="115" fill="#64748B" font-size="10">设计美感</text>
                <text x="350" y="115" fill="#4f46e5" font-size="10" font-weight="bold" text-anchor="end">92/100</text>
                <rect x="0" y="125" width="350" height="6" fill="#F1F5F9" rx="3"/>
                <rect x="0" y="125" width="322" height="6" fill="#4f46e5" rx="3"/>
                
                <!-- 4. 易用性 -->
                <text x="0" y="165" fill="#64748B" font-size="10">易用性</text>
                <text x="350" y="165" fill="#4f46e5" font-size="10" font-weight="bold" text-anchor="end">99/100</text>
                <rect x="0" y="175" width="350" height="6" fill="#F1F5F9" rx="3"/>
                <rect x="0" y="175" width="346" height="6" fill="#4f46e5" rx="3"/>
                
                <!-- 5. 成本 -->
                <text x="0" y="215" fill="#64748B" font-size="10">成本效益</text>
                <text x="350" y="215" fill="#4f46e5" font-size="10" font-weight="bold" text-anchor="end">100/100</text>
                <rect x="0" y="225" width="350" height="6" fill="#F1F5F9" rx="3"/>
                <rect x="0" y="225" width="350" height="6" fill="#4f46e5" rx="3"/>
            </svg>
        </div>

        <!-- 底部页码 -->
        <div data-el="text" data-x="90%" data-y="95%" data-w="5%" data-h="auto" data-font="8" data-color="#CBD5E1" data-align="right">04</div>
    </section>

    <!-- 5. 实施建议页 - 落地计划 (精致版) -->
    <section data-type="freeform" id="landing-5" data-bg="#ffffff">
        <div data-el="shape" data-shape="rect" data-x="0%" data-y="0%" data-w="100%" data-h="1.2%" data-fill="#4f46e5"></div>
        
        <div data-el="text" data-x="5%" data-y="5%" data-w="70%" data-h="auto" data-font="10" data-color="#4f46e5" data-bold="true" data-spacing="2">IMPLEMENTATION PLAN</div>
        <div data-el="text" data-x="5%" data-y="8%" data-w="75%" data-h="auto" data-font="20" data-color="#0F172A" data-bold="true">立即行动：开启智能演示新时代</div>
        <div data-el="image" data-x="82%" data-y="6%" data-w="14%" data-h="6%" data-src="public/h_with_name.svg" data-fit="contain"></div>
        <div data-el="line" data-x1="5%" data-y1="14%" data-x2="95%" data-y2="14%" data-stroke="#E2E8F0" data-stroke-width="1"></div>

        <!-- 顶部：时间轴 SVG -->
        <div data-el="svg" data-x="5%" data-y="18%" data-w="90%" data-h="18%">
            <svg viewBox="0 0 900 100" xmlns="http://www.w3.org/2000/svg">
                <line x1="50" y1="50" x2="850" y2="50" stroke="#E2E8F0" stroke-width="4" stroke-linecap="round"/>
                <line x1="50" y1="50" x2="250" y2="50" stroke="#4f46e5" stroke-width="4" stroke-linecap="round"/>
                
                <circle cx="50" cy="50" r="12" fill="#4f46e5" stroke="#fff" stroke-width="2"/>
                <text x="50" y="25" text-anchor="middle" fill="#4f46e5" font-size="11" font-weight="bold">Day 1</text>
                <text x="50" y="80" text-anchor="middle" fill="#0F172A" font-size="9">快速上手</text>
                
                <circle cx="250" cy="50" r="12" fill="#fff" stroke="#4f46e5" stroke-width="2"/>
                <text x="250" y="25" text-anchor="middle" fill="#64748B" font-size="11">Day 2</text>
                <text x="250" y="80" text-anchor="middle" fill="#0F172A" font-size="9">团队推广</text>
                
                <circle cx="450" cy="50" r="12" fill="#fff" stroke="#CBD5E1" stroke-width="2"/>
                <text x="450" y="25" text-anchor="middle" fill="#64748B" font-size="11">Week 1</text>
                <text x="450" y="80" text-anchor="middle" fill="#0F172A" font-size="9">流程优化</text>
                
                <circle cx="650" cy="50" r="12" fill="#fff" stroke="#CBD5E1" stroke-width="2"/>
                <text x="650" y="25" text-anchor="middle" fill="#64748B" font-size="11">Month 1</text>
                <text x="650" y="80" text-anchor="middle" fill="#0F172A" font-size="9">全面提效</text>
                
                <circle cx="850" cy="50" r="12" fill="#fff" stroke="#CBD5E1" stroke-width="2"/>
                <text x="850" y="25" text-anchor="middle" fill="#64748B" font-size="11">Q1</text>
                <text x="850" y="80" text-anchor="middle" fill="#0F172A" font-size="9">业务增长</text>
            </svg>
        </div>

        <!-- 下部：三列卡片 -->
        <!-- 1. ROI 预测 -->
        <div data-el="shape" data-shape="rect" data-x="5%" data-y="40%" data-w="28%" data-h="45%" data-fill="#ffffff" data-radius="4" data-stroke="#E2E8F0"></div>
        <div data-el="text" data-x="7%" data-y="43%" data-w="24%" data-h="auto" data-font="10" data-color="#4f46e5" data-bold="true">ROI 预测</div>
        <div data-el="line" data-x1="7%" data-y1="48%" data-x2="31%" data-y2="48%" data-stroke="#E2E8F0" data-stroke-width="1"></div>
        <div data-el="text" data-x="7%" data-y="53%" data-w="24%" data-h="auto" data-font="20" data-color="#22C55E" data-bold="true">¥500k+</div>
        <div data-el="text" data-x="7%" data-y="60%" data-w="24%" data-h="auto" data-font="8" data-color="#64748B">年度节省成本</div>
        <div data-el="text" data-x="7%" data-y="68%" data-w="24%" data-h="auto" data-font="20" data-color="#4f46e5" data-bold="true">240x</div>
        <div data-el="text" data-x="7%" data-y="75%" data-w="24%" data-h="auto" data-font="8" data-color="#64748B">效率提升倍数</div>
        <div data-el="text" data-x="7%" data-y="82%" data-w="24%" data-h="auto" data-font="9" data-color="#94A3B8">基于 10 人团队估算</div>

        <!-- 2. 资源需求 -->
        <div data-el="shape" data-shape="rect" data-x="36%" data-y="40%" data-w="28%" data-h="45%" data-fill="#ffffff" data-radius="4" data-stroke="#E2E8F0"></div>
        <div data-el="text" data-x="38%" data-y="43%" data-w="24%" data-h="auto" data-font="10" data-color="#4f46e5" data-bold="true">资源需求</div>
        <div data-el="line" data-x1="38%" data-y1="48%" data-x2="62%" data-y2="48%" data-stroke="#E2E8F0" data-stroke-width="1"></div>
        <div data-el="text" data-x="38%" data-y="54%" data-w="24%" data-h="auto" data-font="9" data-color="#0F172A">✓ 无需专业设计团队</div>
        <div data-el="text" data-x="38%" data-y="60%" data-w="24%" data-h="auto" data-font="9" data-color="#0F172A">✓ 无需购买昂贵软件</div>
        <div data-el="text" data-x="38%" data-y="66%" data-w="24%" data-h="auto" data-font="9" data-color="#0F172A">✓ 无需复杂培训</div>
        <div data-el="text" data-x="38%" data-y="72%" data-w="24%" data-h="auto" data-font="9" data-color="#0F172A">✓ 现有人员即可操作</div>
        <div data-el="text" data-x="38%" data-y="82%" data-w="24%" data-h="auto" data-font="9" data-color="#94A3B8">零额外投入</div>

        <!-- 3. CTA -->
        <div data-el="shape" data-shape="rect" data-x="67%" data-y="40%" data-w="28%" data-h="45%" data-fill="#4f46e5" data-radius="4"></div>
        <div data-el="text" data-x="69%" data-y="50%" data-w="24%" data-h="auto" data-font="16" data-color="#ffffff" data-bold="true" data-align="center">Ready?</div>
        <div data-el="text" data-x="69%" data-y="58%" data-w="24%" data-h="auto" data-font="9" data-color="#E0E7FF" data-align="center">立即体验智能演示</div>
        
        <div data-el="shape" data-shape="rect" data-x="71%" data-y="68%" data-w="20%" data-h="10%" data-fill="#ffffff" data-radius="4"></div>
        <div data-el="text" data-x="71%" data-y="71%" data-w="20%" data-h="auto" data-font="11" data-color="#4f46e5" data-bold="true" data-align="center">免费开始 →</div>

        <!-- 底部页码 -->
        <div data-el="text" data-x="90%" data-y="95%" data-w="5%" data-h="auto" data-font="8" data-color="#CBD5E1" data-align="right">05</div>
    </section>
`;

window.PPT_LANDING_SAMPLE_HTML = PPT_LANDING_SAMPLE_HTML;

/**
 * Landing Page 展示用示例 - McKinsey 风格 (Paper Burner X 适配版)
 * 风格特征：专业、冷静、结构化、高信息密度
 * 主色：#051C2C (深海军蓝) | 辅色：#00A3E0 (咨询蓝) | 强调：#8C8C8C (高级灰)
 */
const PPT_LANDING_SAMPLE_HTML = `
    <!-- 1. 框架页 - 实施路线图 (Hub & Spoke Refactored) -->
    <section data-type="freeform" id="landing-mck-1" data-bg="#ffffff">
        <!-- 顶部装饰线 (Kicker Line) -->
        <div data-el="line" data-x1="5%" data-y1="8%" data-x2="95%" data-y2="8%" data-stroke="#051C2C" data-stroke-width="2"></div>
        
        <!-- 标题区 -->
        <div data-el="text" data-x="5%" data-y="4%" data-w="auto" data-h="auto" data-font="10" data-color="#64748B" data-bold="true" data-spacing="1">STRATEGIC ROADMAP</div>
        <div data-el="text" data-x="5%" data-y="12%" data-w="90%" data-h="auto" data-font="24" data-color="#051C2C" data-bold="true" data-family="serif">Implementation roadmap: A structured framework for digital transformation</div>
        
        <!-- 左侧文案 (Executive Summary) - 优化排版，增加呼吸感 -->
        <div data-el="text" data-x="5%" data-y="24%" data-w="25%" data-h="auto" data-font="12" data-color="#334155" data-line-height="1.8">
            This framework defines the core activities, capabilities, and organizational elements required to build a digital unit capable of sustaining long-term growth.
        </div>
        
        <!-- 分隔短线 -->
        <div data-el="line" data-x1="5%" data-y1="40%" data-x2="10%" data-y2="40%" data-stroke="#00A3E0" data-stroke-width="2"></div>
        
        <div data-el="text" data-x="5%" data-y="44%" data-w="25%" data-h="auto" data-font="11" data-color="#475569" data-line-height="1.8">
            <strong style="color:#051C2C">Key Focus Areas:</strong><br/>
            • Alignment of HQ and local entities<br/>
            • Governance structure definition<br/>
            • Resource allocation efficiency
        </div>

        <!-- 右侧图示区域 - 使用 Card + SVG 组合 -->
        
        <!-- 底层 SVG 连接线 -->
        <div data-el="svg" data-x="30%" data-y="20%" data-w="65%" data-h="65%">
             <svg viewBox="0 0 650 400" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
                        <path d="M0,0 L0,6 L9,3 z" fill="#CBD5E1" />
                    </marker>
                </defs>
                <!-- Center (325, 200) to Nodes -->
                <!-- Top Left -->
                <path d="M325,200 L180,110" stroke="#CBD5E1" stroke-width="1" stroke-dasharray="4,4" />
                <!-- Top Right -->
                <path d="M325,200 L470,110" stroke="#CBD5E1" stroke-width="1" stroke-dasharray="4,4" />
                <!-- Bottom Left -->
                <path d="M325,200 L180,290" stroke="#CBD5E1" stroke-width="1" stroke-dasharray="4,4" />
                <!-- Bottom Right -->
                <path d="M325,200 L470,290" stroke="#CBD5E1" stroke-width="1" stroke-dasharray="4,4" />
                
                <!-- Center Glow -->
                <circle cx="325" cy="200" r="70" fill="#00A3E0" fill-opacity="0.03" />
             </svg>
        </div>

        <!-- 1. Timelines (Top Left) -->
        <div data-el="card" data-x="38%" data-y="24%" data-w="18%" data-h="16%" 
             data-fill="#ffffff" data-radius="8" data-stroke="#E2E8F0" data-layout="vertical"
             data-icon="carbon:time" data-icon-color="#00A3E0" data-icon-bg="#F0F9FF" data-icon-size="20"
             data-title="Timelines" data-title-color="#051C2C" data-title-size="12" data-title-bold="true"
             data-subtitle="Mapping HQ & local activities" data-subtitle-color="#64748B" data-subtitle-size="10">
        </div>

        <!-- 2. Capabilities (Top Right) -->
        <div data-el="card" data-x="74%" data-y="24%" data-w="18%" data-h="16%" 
             data-fill="#ffffff" data-radius="8" data-stroke="#E2E8F0" data-layout="vertical"
             data-icon="carbon:skill-level-advanced" data-icon-color="#00A3E0" data-icon-bg="#F0F9FF" data-icon-size="20"
             data-title="Capabilities" data-title-color="#051C2C" data-title-size="12" data-title-bold="true"
             data-subtitle="Core roles & competencies" data-subtitle-color="#64748B" data-subtitle-size="10">
        </div>

        <!-- 3. Organization (Bottom Left) -->
        <div data-el="card" data-x="38%" data-y="60%" data-w="18%" data-h="16%" 
             data-fill="#ffffff" data-radius="8" data-stroke="#E2E8F0" data-layout="vertical"
             data-icon="carbon:hierarchy" data-icon-color="#00A3E0" data-icon-bg="#F0F9FF" data-icon-size="20"
             data-title="Organization" data-title-color="#051C2C" data-title-size="12" data-title-bold="true"
             data-subtitle="Governance & Reporting lines" data-subtitle-color="#64748B" data-subtitle-size="10">
        </div>

        <!-- 4. Resources (Bottom Right) -->
        <div data-el="card" data-x="74%" data-y="60%" data-w="18%" data-h="16%" 
             data-fill="#ffffff" data-radius="8" data-stroke="#E2E8F0" data-layout="vertical"
             data-icon="carbon:finance" data-icon-color="#00A3E0" data-icon-bg="#F0F9FF" data-icon-size="20"
             data-title="Resources" data-title-color="#051C2C" data-title-size="12" data-title-bold="true"
             data-subtitle="Budgeting & Allocation" data-subtitle-color="#64748B" data-subtitle-size="10">
        </div>

        <!-- Center Core Node -->
        <div data-el="card" data-x="56%" data-y="42%" data-w="18%" data-h="16%" 
             data-fill="#051C2C" data-radius="8" data-stroke="none" data-layout="vertical"
             data-icon="carbon:settings" data-icon-color="#ffffff" data-icon-bg="none" data-icon-size="24"
             data-title="ACTIVITIES" data-title-color="#ffffff" data-title-size="12" data-title-bold="true"
             data-subtitle="Digital Unit Setup & Scope" data-subtitle-color="#94A3B8" data-subtitle-size="10">
        </div>
        
        <!-- 页码 -->
        <div data-el="line" data-x1="5%" data-y1="92%" data-x2="95%" data-y2="92%" data-stroke="#94A3B8" data-stroke-width="0.5"></div>
        <div data-el="text" data-x="5%" data-y="94%" data-w="20%" data-h="auto" data-font="7" data-color="#94A3B8">SOURCE: Paper Burner Strategy Analysis</div>
        <div data-el="text" data-x="93%" data-y="94%" data-w="5%" data-h="auto" data-font="8" data-color="#64748B" data-align="right">1</div>
    </section>

    <!-- 2. 流程页 - 客户旅程 (Infinity Loop Cycle - Clean) -->
    <section data-type="freeform" id="landing-mck-2" data-bg="#ffffff">
        <div data-el="line" data-x1="5%" data-y1="8%" data-x2="95%" data-y2="8%" data-stroke="#051C2C" data-stroke-width="2"></div>
        
        <div data-el="text" data-x="5%" data-y="4%" data-w="auto" data-h="auto" data-font="10" data-color="#64748B" data-bold="true" data-spacing="1">CONTINUOUS ENGAGEMENT</div>
        <div data-el="text" data-x="5%" data-y="12%" data-w="90%" data-h="auto" data-font="24" data-color="#051C2C" data-bold="true" data-family="serif">Moving from a linear funnel to a value-compounding growth loop</div>
        
        <!-- Infinity Loop SVG (No Glow, Clean Lines) -->
        <div data-el="svg" data-x="10%" data-y="25%" data-w="80%" data-h="50%">
            <svg viewBox="0 0 800 300" xmlns="http://www.w3.org/2000/svg">
                <!-- Dotted Circles -->
                <path d="M250,150 m-150,0 a150,150 0 1,0 300,0 a150,150 0 1,0 -300,0" fill="none" stroke="#E2E8F0" stroke-width="1" stroke-dasharray="4,4"/>
                <path d="M550,150 m-150,0 a150,150 0 1,0 300,0 a150,150 0 1,0 -300,0" fill="none" stroke="#E2E8F0" stroke-width="1" stroke-dasharray="4,4"/>

                <!-- Main Flow Path - Solid Clean Blue -->
                <path d="M250,250 C100,250 100,50 250,50 C350,50 450,150 550,250 C700,250 700,50 550,50 C450,50 350,150 250,250 Z" 
                      fill="none" stroke="#00A3E0" stroke-width="5" stroke-linecap="round"/>

                <!-- Arrows -->
                <polygon points="250,44 260,50 250,56" fill="#051C2C" transform="rotate(0 250 50)"/>
                <polygon points="550,256 560,250 550,244" fill="#051C2C" transform="rotate(180 550 250)"/>

                <!-- Icons (SVG Geometry instead of Emojis) -->
                
                <!-- 1. Discover (Eye) -->
                <circle cx="250" cy="50" r="24" fill="#ffffff" stroke="#051C2C" stroke-width="2"/>
                <g transform="translate(250, 50) scale(0.8)">
                    <path d="M-12,0 Q0,-12 12,0 Q0,12 -12,0 Z" fill="none" stroke="#051C2C" stroke-width="2"/>
                    <circle r="4" fill="#051C2C"/>
                </g>
                <text x="250" y="15" text-anchor="middle" fill="#051C2C" font-weight="bold" font-size="12">DISCOVER</text>
                
                <!-- 2. Go (Play) -->
                <circle cx="400" cy="150" r="20" fill="#051C2C" stroke="#ffffff" stroke-width="2"/>
                <path d="M396,142 L406,150 L396,158 Z" fill="#ffffff"/>
                <text x="400" y="185" text-anchor="middle" fill="#051C2C" font-size="12" font-weight="bold">GO</text>
                
                <!-- 3. Expand (Chart) -->
                <circle cx="550" cy="250" r="24" fill="#ffffff" stroke="#00A3E0" stroke-width="2"/>
                <g transform="translate(550, 250) scale(0.8)">
                     <rect x="-8" y="-4" width="4" height="12" fill="#00A3E0"/>
                     <rect x="-2" y="-10" width="4" height="18" fill="#00A3E0"/>
                     <rect x="4" y="-14" width="4" height="22" fill="#00A3E0"/>
                </g>
                <text x="550" y="285" text-anchor="middle" fill="#00A3E0" font-weight="bold" font-size="12">EXPAND</text>

                <!-- 4. Advocate (Heart) -->
                <circle cx="550" cy="50" r="24" fill="#ffffff" stroke="#00A3E0" stroke-width="2"/>
                <g transform="translate(550, 50) scale(0.8)">
                    <path d="M0,4 L-5,-2 A3,3 0 0,1 0,-6 A3,3 0 0,1 5,-2 Z" fill="#00A3E0"/>
                </g>
                <text x="550" y="15" text-anchor="middle" fill="#00A3E0" font-weight="bold" font-size="12">ADVOCATE</text>
                
                <!-- 5. Re-engage (Sync) -->
                <circle cx="250" cy="250" r="24" fill="#ffffff" stroke="#051C2C" stroke-width="2"/>
                <g transform="translate(250, 250) scale(0.8)">
                    <path d="M-6,0 A6,6 0 1,1 6,0" fill="none" stroke="#051C2C" stroke-width="2" stroke-dasharray="4,2"/>
                    <path d="M5,-2 L7,0 L5,2" fill="none" stroke="#051C2C" stroke-width="2"/>
                </g>
                <text x="250" y="285" text-anchor="middle" fill="#051C2C" font-weight="bold" font-size="12">RE-ENGAGE</text>
            </svg>
        </div>

        <!-- 3-Column Explanations -->
        <div data-el="card" data-x="5%" data-y="75%" data-w="28%" data-h="15%" data-fill="#F8FAFC" data-stroke="none" data-layout="vertical"
             data-title="1. Acquisition Loop" data-title-size="12" data-title-color="#051C2C"
             data-subtitle="Seamless entry points reduced CAC by 15% through automated onboarding." data-subtitle-color="#475569"></div>

        <div data-el="card" data-x="36%" data-y="75%" data-w="28%" data-h="15%" data-fill="#F0F9FF" data-stroke="none" data-layout="vertical"
             data-title="2. The 'Moment of Truth'" data-title-size="12" data-title-color="#00A3E0"
             data-subtitle="First value delivered within 5 minutes of sign-up (Aha! Moment)." data-subtitle-color="#475569"></div>

        <div data-el="card" data-x="67%" data-y="75%" data-w="28%" data-h="15%" data-fill="#F8FAFC" data-stroke="none" data-layout="vertical"
             data-title="3. Retention Loop" data-title-size="12" data-title-color="#051C2C"
             data-subtitle="Integrated community features drive organic advocacy and NRR." data-subtitle-color="#475569"></div>

        <div data-el="line" data-x1="5%" data-y1="92%" data-x2="95%" data-y2="92%" data-stroke="#94A3B8" data-stroke-width="0.5"></div>
        <div data-el="text" data-x="5%" data-y="94%" data-w="30%" data-h="auto" data-font="7" data-color="#94A3B8">SOURCE: Growth Strategy 2025</div>
        <div data-el="text" data-x="93%" data-y="94%" data-w="5%" data-h="auto" data-font="8" data-color="#64748B" data-align="right">2</div>
    </section>

    <!-- 3. 数据页 - 市场增长 (Clean Area Chart) -->
    <section data-type="freeform" id="landing-mck-3" data-bg="#ffffff">
        <div data-el="line" data-x1="5%" data-y1="8%" data-x2="95%" data-y2="8%" data-stroke="#051C2C" data-stroke-width="2"></div>
        
        <div data-el="text" data-x="5%" data-y="4%" data-w="auto" data-h="auto" data-font="10" data-color="#64748B" data-bold="true" data-spacing="1">MARKET FORECAST</div>
        <div data-el="text" data-x="5%" data-y="12%" data-w="90%" data-h="auto" data-font="24" data-color="#051C2C" data-bold="true" data-family="serif">The digital sector is poised for explosive growth, with a projected 50% CAGR over the next 4 years</div>
        
        <!-- Left Key Insights -->
        <div data-el="shape" data-shape="rect" data-x="5%" data-y="24%" data-w="30%" data-h="55%" data-fill="#F8FAFC" data-stroke="none"></div>
        
        <div data-el="text" data-x="7%" data-y="28%" data-w="26%" data-h="auto" data-font="13" data-color="#051C2C" data-bold="true">
            1. Strong Market Demand
        </div>
        <div data-el="text" data-x="7%" data-y="32%" data-w="26%" data-h="auto" data-font="11" data-color="#475569" data-line-height="1.5">
            Adoption rates in early access phases have exceeded expectations by 200%, driven by enterprise clients.
        </div>
        
        <div data-el="line" data-x1="7%" data-y1="40%" data-x2="33%" data-y2="40%" data-stroke="#E2E8F0" data-stroke-width="1"></div>
        
        <div data-el="text" data-x="7%" data-y="44%" data-w="26%" data-h="auto" data-font="13" data-color="#051C2C" data-bold="true">
            2. Scalable Infrastructure
        </div>
        <div data-el="text" data-x="7%" data-y="48%" data-w="26%" data-h="auto" data-font="11" data-color="#475569" data-line-height="1.5">
            Our proprietary tech stack allows for 10x user scaling without linear cost increases.
        </div>
        
        <div data-el="line" data-x1="7%" data-y1="56%" data-x2="33%" data-y2="56%" data-stroke="#E2E8F0" data-stroke-width="1"></div>
        
        <div data-el="text" data-x="7%" data-y="60%" data-w="26%" data-h="auto" data-font="13" data-color="#051C2C" data-bold="true">
            3. Revenue Diversification
        </div>
        <div data-el="text" data-x="7%" data-y="64%" data-w="26%" data-h="auto" data-font="11" data-color="#475569" data-line-height="1.5">
            Expansion into B2B API licensing will create a second high-margin revenue stream.
        </div>

        <!-- Right: Clean Area Chart (No Dirty Gradients) -->
        <div data-el="text" data-x="40%" data-y="24%" data-w="30%" data-h="auto" data-font="11" data-color="#64748B" data-bold="true">Projected Revenue (mEUR)</div>
        
        <div data-el="svg" data-x="40%" data-y="28%" data-w="55%" data-h="55%">
            <svg viewBox="0 0 500 350" xmlns="http://www.w3.org/2000/svg">
                <!-- Grid -->
                <line x1="0" y1="300" x2="480" y2="300" stroke="#334155" stroke-width="1"/>
                <line x1="0" y1="225" x2="480" y2="225" stroke="#E2E8F0" stroke-width="1" stroke-dasharray="4,4"/>
                <line x1="0" y1="150" x2="480" y2="150" stroke="#E2E8F0" stroke-width="1" stroke-dasharray="4,4"/>
                <line x1="0" y1="75" x2="480" y2="75" stroke="#E2E8F0" stroke-width="1" stroke-dasharray="4,4"/>
                
                <!-- Area Path - Flat Clean Color, Low Opacity -->
                <path d="M50,280 L50,300 L450,300 L450,40 L370,100 L290,180 L210,240 L130,270 Z" fill="#00A3E0" fill-opacity="0.1" stroke="none"/>
                
                <!-- Line - Solid -->
                <path d="M50,280 C100,280 100,270 130,270 C170,270 170,240 210,240 C250,240 250,180 290,180 C330,180 330,100 370,100 C410,100 410,40 450,40" 
                      fill="none" stroke="#051C2C" stroke-width="3"/>
                
                <!-- Data Points -->
                <circle cx="50" cy="280" r="4" fill="#ffffff" stroke="#051C2C" stroke-width="2"/>
                <circle cx="130" cy="270" r="4" fill="#ffffff" stroke="#051C2C" stroke-width="2"/>
                <circle cx="210" cy="240" r="4" fill="#ffffff" stroke="#051C2C" stroke-width="2"/>
                <circle cx="290" cy="180" r="4" fill="#051C2C" stroke="none"/>
                <circle cx="370" cy="100" r="4" fill="#051C2C" stroke="none"/>
                <circle cx="450" cy="40" r="4" fill="#051C2C" stroke="none"/>
                
                <!-- X Labels -->
                <text x="50" y="320" text-anchor="middle" fill="#64748B" font-size="10">2017</text>
                <text x="130" y="320" text-anchor="middle" fill="#64748B" font-size="10">2018</text>
                <text x="210" y="320" text-anchor="middle" fill="#64748B" font-size="10">2019</text>
                <text x="290" y="320" text-anchor="middle" fill="#051C2C" font-size="10" font-weight="bold">2020</text>
                <text x="370" y="320" text-anchor="middle" fill="#051C2C" font-size="10" font-weight="bold">2021</text>
                <text x="450" y="320" text-anchor="middle" fill="#051C2C" font-size="10" font-weight="bold">2022</text>
                
                <!-- Insight Box (Simple Rect, No Shadow) -->
                <g transform="translate(320, 50)">
                    <rect x="0" y="0" width="100" height="36" fill="#ffffff" stroke="#E2E8F0" stroke-width="1"/>
                    <rect x="0" y="0" width="4" height="36" fill="#00A3E0"/>
                    <text x="12" y="14" text-anchor="start" fill="#051C2C" font-size="9" font-weight="bold">Exponential</text>
                    <text x="12" y="26" text-anchor="start" fill="#475569" font-size="9">Acceleration</text>
                </g>
            </svg>
        </div>
        
        <div data-el="line" data-x1="5%" data-y1="92%" data-x2="95%" data-y2="92%" data-stroke="#94A3B8" data-stroke-width="0.5"></div>
        <div data-el="text" data-x="5%" data-y="94%" data-w="20%" data-h="auto" data-font="7" data-color="#94A3B8">SOURCE: Internal Financial Reports</div>
        <div data-el="text" data-x="93%" data-y="94%" data-w="5%" data-h="auto" data-font="8" data-color="#64748B" data-align="right">3</div>
    </section>

    <!-- 4. 竞争优势 - Clean Radar Chart (Competitive Landscape) -->
    <section data-type="freeform" id="landing-mck-4" data-bg="#ffffff">
        <div data-el="line" data-x1="5%" data-y1="8%" data-x2="95%" data-y2="8%" data-stroke="#051C2C" data-stroke-width="2"></div>
        
        <div data-el="text" data-x="5%" data-y="4%" data-w="auto" data-h="auto" data-font="10" data-color="#64748B" data-bold="true" data-spacing="1">COMPETITIVE LANDSCAPE</div>
        <div data-el="text" data-x="5%" data-y="12%" data-w="90%" data-h="auto" data-font="24" data-color="#051C2C" data-bold="true" data-family="serif">We outperform incumbents in digital capabilities while maintaining cost leadership</div>
        
        <!-- Radar Chart SVG -->
        <div data-el="svg" data-x="25%" data-y="25%" data-w="50%" data-h="60%">
            <svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
                <!-- Background Grid (Clean Grey) -->
                <g fill="none" stroke="#E2E8F0" stroke-width="1">
                    <path d="M200,50 L342,154 L288,321 L112,321 L58,154 Z" /> <!-- Outer -->
                    <path d="M200,100 L295,169 L259,281 L141,281 L105,169 Z" /> <!-- Mid -->
                    <path d="M200,150 L247,184 L229,240 L171,240 L153,184 Z" /> <!-- Inner -->
                    <line x1="200" y1="200" x2="200" y2="50" />
                    <line x1="200" y1="200" x2="342" y2="154" />
                    <line x1="200" y1="200" x2="288" y2="321" />
                    <line x1="200" y1="200" x2="112" y2="321" />
                    <line x1="200" y1="200" x2="58" y2="154" />
                </g>

                <!-- Labels -->
                <text x="200" y="35" text-anchor="middle" fill="#051C2C" font-weight="bold" font-size="12">Cloud Infra</text>
                <text x="360" y="150" text-anchor="start" fill="#051C2C" font-weight="bold" font-size="12">Cost Efficiency</text>
                <text x="300" y="340" text-anchor="middle" fill="#051C2C" font-weight="bold" font-size="12">User Exp.</text>
                <text x="100" y="340" text-anchor="middle" fill="#051C2C" font-weight="bold" font-size="12">Security</text>
                <text x="40" y="150" text-anchor="end" fill="#051C2C" font-weight="bold" font-size="12">Integration</text>

                <!-- Data: Legacy A (Grey Dashed) -->
                <path d="M200,150 L260,190 L240,260 L160,260 L130,190 Z" 
                      fill="none" stroke="#94A3B8" stroke-width="2" stroke-dasharray="4,4"/>
                
                <!-- Data: Startup B (Light Blue Dashed) -->
                <path d="M200,80 L230,180 L250,230 L180,300 L90,140 Z" 
                      fill="none" stroke="#00A3E0" stroke-width="2" stroke-dasharray="4,4"/>

                <!-- Data: Paper Burner (Solid Navy, Bold) -->
                <path d="M200,55 L330,160 L280,310 L120,310 L65,160 Z" 
                      fill="#051C2C" fill-opacity="0.05" stroke="#051C2C" stroke-width="3"/>
                
                <!-- Highlight Dots -->
                <circle cx="200" cy="55" r="4" fill="#051C2C"/>
                <circle cx="330" cy="160" r="4" fill="#051C2C"/>
                <circle cx="280" cy="310" r="4" fill="#051C2C"/>
                <circle cx="120" cy="310" r="4" fill="#051C2C"/>
                <circle cx="65" cy="160" r="4" fill="#051C2C"/>
            </svg>
        </div>

        <!-- Legend -->
        <div data-el="rect" data-x="75%" data-y="45%" data-w="12" data-h="12" data-fill="#051C2C"></div>
        <div data-el="text" data-x="78%" data-y="45%" data-w="auto" data-h="auto" data-font="11" data-color="#051C2C">Paper Burner</div>
        
        <div data-el="line" data-x1="75%" data-y1="56%" data-x2="77%" data-y2="56%" data-stroke="#00A3E0" data-stroke-width="2" data-stroke-dash="4,4"></div>
        <div data-el="text" data-x="78%" data-y="50%" data-w="auto" data-h="auto" data-font="11" data-color="#64748B">Startups</div>
        
        <div data-el="line" data-x1="75%" data-y1="61%" data-x2="77%" data-y2="61%" data-stroke="#94A3B8" data-stroke-width="2" data-stroke-dash="4,4"></div>
        <div data-el="text" data-x="78%" data-y="55%" data-w="auto" data-h="auto" data-font="11" data-color="#64748B">Legacy</div>

        <div data-el="line" data-x1="5%" data-y1="92%" data-x2="95%" data-y2="92%" data-stroke="#94A3B8" data-stroke-width="0.5"></div>
        <div data-el="text" data-x="5%" data-y="94%" data-w="20%" data-h="auto" data-font="7" data-color="#94A3B8">SOURCE: Gartner Magic Quadrant 2024</div>
        <div data-el="text" data-x="93%" data-y="94%" data-w="5%" data-h="auto" data-font="8" data-color="#64748B" data-align="right">4</div>
    </section>

    <!-- 5. 实施计划 - Timeline (Gantt Chart) -->
    <section data-type="freeform" id="landing-mck-5" data-bg="#ffffff">
        <div data-el="line" data-x1="5%" data-y1="8%" data-x2="95%" data-y2="8%" data-stroke="#051C2C" data-stroke-width="2"></div>
        
        <div data-el="text" data-x="5%" data-y="4%" data-w="auto" data-h="auto" data-font="10" data-color="#64748B" data-bold="true" data-spacing="1">IMPLEMENTATION PLAN</div>
        <div data-el="text" data-x="5%" data-y="12%" data-w="90%" data-h="auto" data-font="24" data-color="#051C2C" data-bold="true" data-family="serif">Three-phased approach to ensure rapid value realization and scalable foundations</div>
        
        <!-- Timeline SVG -->
        <div data-el="svg" data-x="5%" data-y="25%" data-w="90%" data-h="60%">
            <svg viewBox="0 0 900 400" xmlns="http://www.w3.org/2000/svg">
                <!-- Header Row Background -->
                <rect x="0" y="0" width="900" height="40" fill="#F8FAFC"/>
                
                <!-- Time Labels -->
                <text x="150" y="25" text-anchor="middle" fill="#64748B" font-weight="bold" font-size="12">Q1 2025</text>
                <text x="350" y="25" text-anchor="middle" fill="#64748B" font-weight="bold" font-size="12">Q2 2025</text>
                <text x="550" y="25" text-anchor="middle" fill="#64748B" font-weight="bold" font-size="12">Q3 2025</text>
                <text x="750" y="25" text-anchor="middle" fill="#64748B" font-weight="bold" font-size="12">Q4 2025</text>
                
                <!-- Vertical Grid Lines -->
                <line x1="250" y1="0" x2="250" y2="350" stroke="#E2E8F0" stroke-width="1"/>
                <line x1="450" y1="0" x2="450" y2="350" stroke="#E2E8F0" stroke-width="1"/>
                <line x1="650" y1="0" x2="650" y2="350" stroke="#E2E8F0" stroke-width="1"/>
                
                <!-- Phase 1: Foundation -->
                <text x="0" y="80" text-anchor="start" fill="#051C2C" font-weight="bold" font-size="14">Phase 1: Foundation</text>
                <!-- Bar -->
                <rect x="50" y="90" width="200" height="24" rx="12" fill="#051C2C"/>
                <text x="150" y="107" text-anchor="middle" fill="#ffffff" font-size="11">Core Setup</text>
                <!-- Milestone Diamond -->
                <path d="M250,102 L260,112 L250,122 L240,112 Z" fill="#00A3E0"/>
                <text x="270" y="115" text-anchor="start" fill="#00A3E0" font-size="10" font-weight="bold">Launch</text>

                <!-- Phase 2: Pilot -->
                <text x="0" y="160" text-anchor="start" fill="#051C2C" font-weight="bold" font-size="14">Phase 2: Pilot</text>
                <!-- Bar -->
                <rect x="250" y="170" width="300" height="24" rx="12" fill="#94A3B8"/>
                <text x="400" y="187" text-anchor="middle" fill="#ffffff" font-size="11">Beta Testing & Feedback</text>
                <!-- Milestone Diamond -->
                <path d="M550,182 L560,192 L550,202 L540,192 Z" fill="#00A3E0"/>
                <text x="570" y="195" text-anchor="start" fill="#00A3E0" font-size="10" font-weight="bold">Validation</text>

                <!-- Phase 3: Scale -->
                <text x="0" y="240" text-anchor="start" fill="#051C2C" font-weight="bold" font-size="14">Phase 3: Scale</text>
                <!-- Bar -->
                <rect x="550" y="250" width="350" height="24" rx="12" fill="#00A3E0"/>
                <text x="725" y="267" text-anchor="middle" fill="#ffffff" font-size="11">Market Expansion</text>
                
                <!-- Today Marker -->
                <line x1="100" y1="40" x2="100" y2="350" stroke="#F43F5E" stroke-width="2" stroke-dasharray="4,2"/>
                <rect x="70" y="350" width="60" height="20" rx="4" fill="#F43F5E"/>
                <text x="100" y="364" text-anchor="middle" fill="#ffffff" font-size="10" font-weight="bold">TODAY</text>
            </svg>
        </div>

        <div data-el="line" data-x1="5%" data-y1="92%" data-x2="95%" data-y2="92%" data-stroke="#94A3B8" data-stroke-width="0.5"></div>
        <div data-el="text" data-x="5%" data-y="94%" data-w="20%" data-h="auto" data-font="7" data-color="#94A3B8">SOURCE: Project Management Office</div>
        <div data-el="text" data-x="93%" data-y="94%" data-w="5%" data-h="auto" data-font="8" data-color="#64748B" data-align="right">5</div>
    </section>

    <!-- 6. 治理结构 - Governance (Org Chart) -->
    <section data-type="freeform" id="landing-mck-6" data-bg="#ffffff">
        <div data-el="line" data-x1="5%" data-y1="8%" data-x2="95%" data-y2="8%" data-stroke="#051C2C" data-stroke-width="2"></div>
        
        <div data-el="text" data-x="5%" data-y="4%" data-w="auto" data-h="auto" data-font="10" data-color="#64748B" data-bold="true" data-spacing="1">GOVERNANCE MODEL</div>
        <div data-el="text" data-x="5%" data-y="12%" data-w="90%" data-h="auto" data-font="24" data-color="#051C2C" data-bold="true" data-family="serif">Clear decision rights and accountability structure</div>
        
        <!-- Org Chart SVG -->
        <div data-el="svg" data-x="10%" data-y="25%" data-w="80%" data-h="60%">
            <svg viewBox="0 0 800 400" xmlns="http://www.w3.org/2000/svg">
                <!-- Connections -->
                <path d="M400,80 L400,150" stroke="#CBD5E1" stroke-width="2"/>
                <path d="M400,230 L400,280" stroke="#CBD5E1" stroke-width="2"/>
                <path d="M400,260 L150,260 L150,300" stroke="#CBD5E1" stroke-width="2"/>
                <path d="M400,260 L650,260 L650,300" stroke="#CBD5E1" stroke-width="2"/>

                <!-- Level 1: Steering Co -->
                <rect x="280" y="20" width="240" height="60" rx="4" fill="#051C2C"/>
                <text x="400" y="45" text-anchor="middle" fill="#ffffff" font-weight="bold" font-size="14">Steering Committee</text>
                <text x="400" y="65" text-anchor="middle" fill="#94A3B8" font-size="11">C-Suite Stakeholders</text>
                
                <!-- Level 2: Digital Unit (Hub) -->
                <circle cx="400" cy="190" r="40" fill="#ffffff" stroke="#00A3E0" stroke-width="3"/>
                <text x="400" y="185" text-anchor="middle" fill="#051C2C" font-weight="bold" font-size="12">Digital</text>
                <text x="400" y="200" text-anchor="middle" fill="#051C2C" font-weight="bold" font-size="12">Unit</text>

                <!-- Level 3: Workstreams -->
                <!-- WS 1 -->
                <rect x="50" y="300" width="200" height="50" rx="4" fill="#F8FAFC" stroke="#E2E8F0"/>
                <rect x="50" y="300" width="6" height="50" fill="#00A3E0"/>
                <text x="150" y="330" text-anchor="middle" fill="#051C2C" font-weight="bold">Technology Core</text>
                
                <!-- WS 2 -->
                <rect x="300" y="300" width="200" height="50" rx="4" fill="#F8FAFC" stroke="#E2E8F0"/>
                <rect x="300" y="300" width="6" height="50" fill="#00A3E0"/>
                <text x="400" y="330" text-anchor="middle" fill="#051C2C" font-weight="bold">Product Design</text>
                
                <!-- WS 3 -->
                <rect x="550" y="300" width="200" height="50" rx="4" fill="#F8FAFC" stroke="#E2E8F0"/>
                <rect x="550" y="300" width="6" height="50" fill="#00A3E0"/>
                <text x="650" y="330" text-anchor="middle" fill="#051C2C" font-weight="bold">Go-to-Market</text>
            </svg>
        </div>

        <div data-el="line" data-x1="5%" data-y1="92%" data-x2="95%" data-y2="92%" data-stroke="#94A3B8" data-stroke-width="0.5"></div>
        <div data-el="text" data-x="5%" data-y="94%" data-w="20%" data-h="auto" data-font="7" data-color="#94A3B8">SOURCE: Organizational Design Workshop</div>
        <div data-el="text" data-x="93%" data-y="94%" data-w="5%" data-h="auto" data-font="8" data-color="#64748B" data-align="right">6</div>
    </section>

    <!-- 7. 下一步计划 - Next Steps (Checklist) -->
    <section data-type="freeform" id="landing-mck-7" data-bg="#ffffff">
        <div data-el="line" data-x1="5%" data-y1="8%" data-x2="95%" data-y2="8%" data-stroke="#051C2C" data-stroke-width="2"></div>
        
        <div data-el="text" data-x="5%" data-y="4%" data-w="auto" data-h="auto" data-font="10" data-color="#64748B" data-bold="true" data-spacing="1">NEXT STEPS</div>
        <div data-el="text" data-x="5%" data-y="12%" data-w="90%" data-h="auto" data-font="24" data-color="#051C2C" data-bold="true" data-family="serif">Immediate priorities to maintain momentum</div>
        
        <!-- Checklist Area -->
        <div data-el="svg" data-x="10%" data-y="25%" data-w="80%" data-h="60%">
            <svg viewBox="0 0 800 400" xmlns="http://www.w3.org/2000/svg">
                <!-- Item 1 -->
                <rect x="0" y="0" width="800" height="80" rx="8" fill="#F8FAFC" stroke="#E2E8F0"/>
                <!-- Checkbox Icon -->
                <rect x="30" y="25" width="30" height="30" rx="4" fill="#051C2C"/>
                <path d="M36,40 L44,48 L58,32" fill="none" stroke="#ffffff" stroke-width="3"/>
                
                <text x="80" y="35" text-anchor="start" fill="#051C2C" font-weight="bold" font-size="16">Approve Budget for Q3</text>
                <text x="80" y="60" text-anchor="start" fill="#64748B" font-size="14">Secure funding for infrastructure scaling.</text>
                <text x="750" y="45" text-anchor="end" fill="#E11D48" font-weight="bold" font-size="14">High Priority</text>

                <!-- Item 2 -->
                <rect x="0" y="100" width="800" height="80" rx="8" fill="#F8FAFC" stroke="#E2E8F0"/>
                <!-- Checkbox Icon -->
                <rect x="30" y="125" width="30" height="30" rx="4" fill="#ffffff" stroke="#051C2C" stroke-width="2"/>
                
                <text x="80" y="135" text-anchor="start" fill="#051C2C" font-weight="bold" font-size="16">Finalize Hiring Plan</text>
                <text x="80" y="160" text-anchor="start" fill="#64748B" font-size="14">Key roles: CTO, Head of Product, Senior Engineers.</text>
                <text x="750" y="145" text-anchor="end" fill="#051C2C" font-size="14">Due: Oct 15</text>

                <!-- Item 3 -->
                <rect x="0" y="200" width="800" height="80" rx="8" fill="#F8FAFC" stroke="#E2E8F0"/>
                <!-- Checkbox Icon -->
                <rect x="30" y="225" width="30" height="30" rx="4" fill="#ffffff" stroke="#051C2C" stroke-width="2"/>
                
                <text x="80" y="235" text-anchor="start" fill="#051C2C" font-weight="bold" font-size="16">Select Vendor Partners</text>
                <text x="80" y="260" text-anchor="start" fill="#64748B" font-size="14">Cloud provider and security audit firm selection.</text>
                <text x="750" y="245" text-anchor="end" fill="#051C2C" font-size="14">Due: Nov 01</text>
            </svg>
        </div>

        <div data-el="line" data-x1="5%" data-y1="92%" data-x2="95%" data-y2="92%" data-stroke="#94A3B8" data-stroke-width="0.5"></div>
        <div data-el="text" data-x="5%" data-y="94%" data-w="20%" data-h="auto" data-font="7" data-color="#94A3B8">SOURCE: Steering Committee Minutes</div>
        <div data-el="text" data-x="93%" data-y="94%" data-w="5%" data-h="auto" data-font="8" data-color="#64748B" data-align="right">7</div>
    </section>
`;

window.PPT_LANDING_SAMPLE_HTML = PPT_LANDING_SAMPLE_HTML;

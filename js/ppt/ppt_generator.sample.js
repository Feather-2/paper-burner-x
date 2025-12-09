const PPT_SAMPLE_HTML = `

            <!-- 1. 封面页：Quantum Leap - 极限复杂版 -->
            <section data-type="freeform" id="slide-1" data-gradient="linear-gradient(135deg, #020617 0%, #0F172A 50%, #1e1b4b 100%)">
                <!-- 多层背景效果 -->
                <div data-el="shape" data-shape="circle" data-x="60%" data-y="-30%" data-w="100%" data-h="160%" data-fill="#06B6D4" data-opacity="0.12" data-filter="blur(80px)"></div>
                <div data-el="shape" data-shape="circle" data-x="-20%" data-y="40%" data-w="60%" data-h="100%" data-fill="#8B5CF6" data-opacity="0.15" data-filter="blur(60px)"></div>
                <div data-el="shape" data-shape="circle" data-x="80%" data-y="70%" data-w="40%" data-h="70%" data-fill="#F472B6" data-opacity="0.1" data-filter="blur(50px)"></div>
                
                <!-- 装饰性 SVG 网格 -->
                <div data-el="svg" data-x="0%" data-y="0%" data-w="100%" data-h="100%" data-opacity="0.15">
                    <svg viewBox="0 0 960 540" xmlns="http://www.w3.org/2000/svg">
                        <defs>
                            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#22d3ee" stroke-width="0.5"/>
                            </pattern>
                        </defs>
                        <rect width="100%" height="100%" fill="url(#grid)"/>
                    </svg>
                </div>
                
                <!-- 动态粒子效果 SVG -->
                <div data-el="svg" data-x="0%" data-y="0%" data-w="100%" data-h="100%" data-opacity="0.4">
                    <svg viewBox="0 0 960 540" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="120" cy="80" r="3" fill="#22d3ee"/><circle cx="340" cy="120" r="2" fill="#8b5cf6"/>
                        <circle cx="560" cy="60" r="4" fill="#f472b6"/><circle cx="780" cy="140" r="2" fill="#22d3ee"/>
                        <circle cx="200" cy="200" r="2" fill="#a855f7"/><circle cx="650" cy="180" r="3" fill="#06b6d4"/>
                        <circle cx="850" cy="280" r="2" fill="#ec4899"/><circle cx="100" cy="350" r="3" fill="#8b5cf6"/>
                        <circle cx="400" cy="400" r="2" fill="#22d3ee"/><circle cx="700" cy="450" r="4" fill="#a855f7"/>
                        <line x1="120" y1="80" x2="340" y2="120" stroke="#22d3ee" stroke-width="0.5" opacity="0.3"/>
                        <line x1="340" y1="120" x2="560" y2="60" stroke="#8b5cf6" stroke-width="0.5" opacity="0.3"/>
                        <line x1="560" y1="60" x2="780" y2="140" stroke="#f472b6" stroke-width="0.5" opacity="0.3"/>
                    </svg>
                </div>
                
                <!-- 主标题带渐变效果 -->
                <div data-el="text" data-x="8%" data-y="20%" data-w="84%" data-h="auto" data-font="80" data-color="#F8FAFC" data-bold="true">QUANTUM</div>
                <div data-el="text" data-x="8%" data-y="36%" data-w="84%" data-h="auto" data-font="80" data-color="#22D3EE" data-bold="true">LEAP</div>
                
                <!-- 装饰线条 -->
                <div data-el="line" data-x1="8%" data-y1="52%" data-x2="25%" data-y2="52%" data-stroke="#22D3EE" data-stroke-width="4"></div>
                <div data-el="line" data-x1="26%" data-y1="52%" data-x2="35%" data-y2="52%" data-stroke="#8B5CF6" data-stroke-width="4"></div>
                <div data-el="line" data-x1="36%" data-y1="52%" data-x2="40%" data-y2="52%" data-stroke="#F472B6" data-stroke-width="4"></div>
                
                <!-- 副标题 -->
                <div data-el="text" data-x="8%" data-y="58%" data-w="60%" data-h="auto" data-font="24" data-color="#94A3B8">Unlocking the Universe's Compute Power</div>
                
                <!-- 统计卡片 -->
                <div data-el="card" data-x="8%" data-y="70%" data-w="18%" data-h="16%" data-layout="vertical" data-fill="#0f172a" data-radius="12" data-stroke="#334155"
                     data-icon="carbon:chip" data-icon-color="#22d3ee" data-title="1000+ Qubits" data-title-color="#f8fafc" data-title-size="14"
                     data-subtitle="by 2025" data-subtitle-color="#64748b" data-subtitle-size="11"></div>
                <div data-el="card" data-x="28%" data-y="70%" data-w="18%" data-h="16%" data-layout="vertical" data-fill="#0f172a" data-radius="12" data-stroke="#334155"
                     data-icon="carbon:growth" data-icon-color="#10b981" data-title="$8.5B Market" data-title-color="#f8fafc" data-title-size="14"
                     data-subtitle="projected" data-subtitle-color="#64748b" data-subtitle-size="11"></div>
                <div data-el="card" data-x="48%" data-y="70%" data-w="18%" data-h="16%" data-layout="vertical" data-fill="#0f172a" data-radius="12" data-stroke="#334155"
                     data-icon="carbon:enterprise" data-icon-color="#a855f7" data-title="500+ Labs" data-title-color="#f8fafc" data-title-size="14"
                     data-subtitle="worldwide" data-subtitle-color="#64748b" data-subtitle-size="11"></div>
                
                <!-- Footer -->
                <div data-el="text" data-x="8%" data-y="94%" data-w="40%" data-h="auto" data-font="12" data-color="#475569">Paper Burner Research · Quantum Division · 2025</div>
                <div data-el="icon" data-x="88%" data-y="92%" data-icon="carbon:logo-github" data-size="20" data-color="#475569"></div>
                <div data-el="icon" data-x="92%" data-y="92%" data-icon="carbon:logo-twitter" data-size="20" data-color="#475569"></div>
            </section>

            <!-- 2. 议程页 - 极限复杂版 -->
            <section data-type="freeform" id="slide-2" data-gradient="linear-gradient(180deg, #0F172A 0%, #1e1b4b 100%)">
                <!-- 背景装饰 -->
                <div data-el="shape" data-shape="circle" data-x="85%" data-y="-20%" data-w="40%" data-h="70%" data-fill="#22d3ee" data-opacity="0.08" data-filter="blur(60px)"></div>
                <div data-el="shape" data-shape="circle" data-x="-15%" data-y="70%" data-w="35%" data-h="60%" data-fill="#a855f7" data-opacity="0.08" data-filter="blur(50px)"></div>
                
                <!-- 装饰性连接线 SVG -->
                <div data-el="svg" data-x="0%" data-y="20%" data-w="100%" data-h="75%" data-opacity="0.3">
                    <svg viewBox="0 0 960 400" xmlns="http://www.w3.org/2000/svg">
                        <path d="M180 80 Q300 80 300 200 Q300 320 420 320" stroke="#22d3ee" stroke-width="2" fill="none" stroke-dasharray="5,5"/>
                        <path d="M490 80 Q610 80 610 200 Q610 320 730 320" stroke="#a855f7" stroke-width="2" fill="none" stroke-dasharray="5,5"/>
                        <path d="M300 200 L610 200" stroke="#f472b6" stroke-width="1" fill="none" stroke-dasharray="3,3"/>
                    </svg>
                </div>
                
                <div data-el="text" data-x="5%" data-y="6%" data-w="40%" data-h="auto" data-font="36" data-color="#F8FAFC" data-bold="true">Agenda</div>
                <div data-el="text" data-x="5%" data-y="13%" data-w="60%" data-h="auto" data-font="14" data-color="#64748b">Your journey through the quantum revolution</div>
                
                <!-- 卡片网格 with icons -->
                <div data-el="card" data-x="5%" data-y="22%" data-w="28%" data-h="28%" data-layout="vertical" data-fill="#1e293b" data-radius="12" data-stroke="#334155"
                     data-icon="carbon:chemistry" data-icon-color="#22d3ee" data-icon-bg="#0f172a" data-icon-size="32"
                     data-title="01. Foundations" data-title-color="#22d3ee" data-title-size="18"
                     data-subtitle="Bit vs Qubit, Superposition, Entanglement, Quantum Gates" data-subtitle-color="#94a3b8" data-subtitle-size="12"></div>
                
                <div data-el="card" data-x="36%" data-y="22%" data-w="28%" data-h="28%" data-layout="vertical" data-fill="#1e293b" data-radius="12" data-stroke="#334155"
                     data-icon="carbon:function" data-icon-color="#818cf8" data-icon-bg="#0f172a" data-icon-size="32"
                     data-title="02. Algorithms" data-title-color="#818cf8" data-title-size="18"
                     data-subtitle="Shor's, Grover's, VQE, QAOA, Exponential Speedup" data-subtitle-color="#94a3b8" data-subtitle-size="12"></div>
                
                <div data-el="card" data-x="67%" data-y="22%" data-w="28%" data-h="28%" data-layout="vertical" data-fill="#1e293b" data-radius="12" data-stroke="#334155"
                     data-icon="carbon:chip" data-icon-color="#f472b6" data-icon-bg="#0f172a" data-icon-size="32"
                     data-title="03. Hardware" data-title-color="#f472b6" data-title-size="18"
                     data-subtitle="Superconducting, Trapped Ions, Photonics, Topological" data-subtitle-color="#94a3b8" data-subtitle-size="12"></div>
                
                <div data-el="card" data-x="5%" data-y="55%" data-w="28%" data-h="28%" data-layout="vertical" data-fill="#1e293b" data-radius="12" data-stroke="#334155"
                     data-icon="carbon:application" data-icon-color="#34d399" data-icon-bg="#0f172a" data-icon-size="32"
                     data-title="04. Applications" data-title-color="#34d399" data-title-size="18"
                     data-subtitle="Cryptography, Drug Discovery, ML, Optimization" data-subtitle-color="#94a3b8" data-subtitle-size="12"></div>
                
                <div data-el="card" data-x="36%" data-y="55%" data-w="28%" data-h="28%" data-layout="vertical" data-fill="#1e293b" data-radius="12" data-stroke="#334155"
                     data-icon="carbon:warning-alt" data-icon-color="#fbbf24" data-icon-bg="#0f172a" data-icon-size="32"
                     data-title="05. Challenges" data-title-color="#fbbf24" data-title-size="18"
                     data-subtitle="Decoherence, Error Correction, Scalability, Cost" data-subtitle-color="#94a3b8" data-subtitle-size="12"></div>
                
                <div data-el="card" data-x="67%" data-y="55%" data-w="28%" data-h="28%" data-layout="vertical" data-fill="#1e293b" data-radius="12" data-stroke="#334155"
                     data-icon="carbon:roadmap" data-icon-color="#a78bfa" data-icon-bg="#0f172a" data-icon-size="32"
                     data-title="06. Roadmap" data-title-color="#a78bfa" data-title-size="18"
                     data-subtitle="NISQ Era, Fault Tolerance, Quantum Advantage" data-subtitle-color="#94a3b8" data-subtitle-size="12"></div>
                
                <!-- 底部进度条 -->
                <div data-el="shape" data-shape="rounded" data-x="5%" data-y="88%" data-w="90%" data-h="2%" data-fill="#1e293b" data-radius="4"></div>
                <div data-el="shape" data-shape="rounded" data-x="5%" data-y="88%" data-w="15%" data-h="2%" data-fill="#22d3ee" data-radius="4"></div>
                <div data-el="text" data-x="5%" data-y="92%" data-w="20%" data-h="auto" data-font="11" data-color="#64748b">Page 2 of 14</div>
            </section>

            <!-- 3. Bit vs Qubit - 极限复杂版 -->
            <section data-type="freeform" id="slide-3" data-gradient="linear-gradient(135deg, #0F172A 0%, #1e1b4b 100%)">
                <!-- 背景效果 -->
                <div data-el="shape" data-shape="circle" data-x="20%" data-y="30%" data-w="30%" data-h="50%" data-fill="#64748b" data-opacity="0.06" data-filter="blur(40px)"></div>
                <div data-el="shape" data-shape="circle" data-x="60%" data-y="20%" data-w="35%" data-h="60%" data-fill="#22d3ee" data-opacity="0.08" data-filter="blur(50px)"></div>
                
                <div data-el="text" data-x="5%" data-y="6%" data-w="90%" data-h="auto" data-font="28" data-color="#F8FAFC" data-bold="true">The Fundamental Shift</div>
                <div data-el="text" data-x="5%" data-y="13%" data-w="90%" data-h="auto" data-font="14" data-color="#64748b">From deterministic to probabilistic computing</div>
                
                <!-- Classical Bit Section -->
                <div data-el="shape" data-shape="rounded" data-x="5%" data-y="22%" data-w="42%" data-h="70%" data-fill="#1e293b" data-radius="16" data-stroke="#334155"></div>
                <div data-el="text" data-x="8%" data-y="26%" data-w="36%" data-h="auto" data-font="20" data-color="#94A3B8" data-bold="true">Classical Bit</div>
                
                <!-- Bit 可视化 SVG -->
                <div data-el="svg" data-x="8%" data-y="34%" data-w="36%" data-h="30%">
                    <svg viewBox="0 0 300 120" xmlns="http://www.w3.org/2000/svg">
                        <rect x="50" y="20" width="80" height="80" rx="12" fill="#334155" stroke="#475569" stroke-width="2"/>
                        <text x="90" y="72" fill="#f8fafc" font-size="36" font-weight="bold" text-anchor="middle">0</text>
                        <rect x="170" y="20" width="80" height="80" rx="12" fill="#334155" stroke="#475569" stroke-width="2"/>
                        <text x="210" y="72" fill="#64748b" font-size="36" font-weight="bold" text-anchor="middle">1</text>
                        <text x="150" y="115" fill="#64748b" font-size="12" text-anchor="middle">Either 0 OR 1</text>
                    </svg>
                </div>
                
                <div data-el="text" data-x="8%" data-y="68%" data-w="36%" data-h="auto" data-font="13" data-color="#94a3b8" data-line-height="1.5">
                    • Deterministic state<br>• Binary: exactly 0 or 1<br>• No uncertainty<br>• Classical logic gates
                </div>
                
                <!-- VS Divider -->
                <div data-el="shape" data-shape="circle" data-x="46%" data-y="48%" data-w="8%" data-h="14%" data-fill="#0f172a" data-stroke="#334155"></div>
                <div data-el="text" data-x="46%" data-y="53%" data-w="8%" data-h="auto" data-font="14" data-color="#64748b" data-align="center" data-bold="true">VS</div>
                
                <!-- Qubit Section -->
                <div data-el="shape" data-shape="rounded" data-x="53%" data-y="22%" data-w="42%" data-h="70%" data-fill="#1e293b" data-radius="16" data-stroke="#22d3ee" data-stroke-width="2"></div>
                <div data-el="text" data-x="56%" data-y="26%" data-w="36%" data-h="auto" data-font="20" data-color="#22D3EE" data-bold="true">Quantum Bit (Qubit)</div>
                
                <!-- Bloch Sphere SVG -->
                <div data-el="svg" data-x="56%" data-y="34%" data-w="36%" data-h="30%">
                    <svg viewBox="0 0 300 120" xmlns="http://www.w3.org/2000/svg">
                        <ellipse cx="150" cy="60" rx="50" ry="50" fill="none" stroke="#334155" stroke-width="1"/>
                        <ellipse cx="150" cy="60" rx="50" ry="15" fill="none" stroke="#334155" stroke-width="1"/>
                        <line x1="150" y1="10" x2="150" y2="110" stroke="#334155" stroke-width="1"/>
                        <circle cx="150" cy="15" r="6" fill="#22d3ee"/>
                        <text x="165" y="20" fill="#22d3ee" font-size="12">|0⟩</text>
                        <circle cx="150" cy="105" r="6" fill="#f472b6"/>
                        <text x="165" y="110" fill="#f472b6" font-size="12">|1⟩</text>
                        <line x1="150" y1="60" x2="185" y2="35" stroke="#a855f7" stroke-width="2"/>
                        <circle cx="185" cy="35" r="5" fill="#a855f7"/>
                        <text x="195" y="40" fill="#a855f7" font-size="10">|ψ⟩</text>
                    </svg>
                </div>
                
                <div data-el="formula" data-x="56%" data-y="64%" data-w="36%" data-h="8%" data-font="18" data-color="#22d3ee" data-latex="|\\psi\\rangle = \\alpha|0\\rangle + \\beta|1\\rangle"></div>
                
                <div data-el="text" data-x="56%" data-y="74%" data-w="36%" data-h="auto" data-font="13" data-color="#94a3b8" data-line-height="1.5">
                    • Superposition state<br>• Both 0 AND 1 simultaneously<br>• Probabilistic outcomes<br>• Quantum parallelism
                </div>
            </section>

            <!-- 4. Mathematical Foundation - 极限复杂版 -->
            <section data-type="freeform" id="slide-4" data-gradient="linear-gradient(135deg, #0F172A 0%, #1e1b4b 100%)">
                <!-- 背景 -->
                <div data-el="shape" data-shape="circle" data-x="70%" data-y="-10%" data-w="50%" data-h="80%" data-fill="#22d3ee" data-opacity="0.06" data-filter="blur(60px)"></div>
                <div data-el="shape" data-shape="circle" data-x="-10%" data-y="60%" data-w="40%" data-h="70%" data-fill="#a855f7" data-opacity="0.06" data-filter="blur(50px)"></div>
                
                <div data-el="text" data-x="5%" data-y="6%" data-w="90%" data-h="auto" data-font="28" data-color="#F8FAFC" data-bold="true">Mathematical Foundation</div>
                <div data-el="text" data-x="5%" data-y="13%" data-w="90%" data-h="auto" data-font="14" data-color="#64748b">Linear algebra meets quantum mechanics</div>

                <!-- 左侧：基本公式 -->
                <div data-el="shape" data-shape="rounded" data-x="3%" data-y="20%" data-w="45%" data-h="36%" data-fill="#1e293b" data-radius="12" data-stroke="#334155"></div>
                <div data-el="text" data-x="5%" data-y="23%" data-w="41%" data-h="auto" data-font="16" data-color="#22d3ee" data-bold="true">Qubit State Vector</div>
                <div data-el="formula" data-x="5%" data-y="30%" data-w="41%" data-h="10%" data-font="28" data-color="#f8fafc" data-latex="|\\psi\\rangle = \\alpha|0\\rangle + \\beta|1\\rangle"></div>
                <div data-el="text" data-x="5%" data-y="42%" data-w="41%" data-h="auto" data-font="12" data-color="#94a3b8">Normalization condition:</div>
                <div data-el="formula" data-x="5%" data-y="48%" data-w="41%" data-h="6%" data-font="18" data-color="#a855f7" data-latex="|\\alpha|^2 + |\\beta|^2 = 1"></div>

                <!-- 右侧：矩阵表示 -->
                <div data-el="shape" data-shape="rounded" data-x="52%" data-y="20%" data-w="45%" data-h="36%" data-fill="#1e293b" data-radius="12" data-stroke="#334155"></div>
                <div data-el="text" data-x="54%" data-y="23%" data-w="41%" data-h="auto" data-font="16" data-color="#f472b6" data-bold="true">Matrix Representation</div>
                <div data-el="formula" data-x="54%" data-y="30%" data-w="41%" data-h="10%" data-font="22" data-color="#f8fafc" data-latex="|0\\rangle = \\begin{pmatrix} 1 \\\\ 0 \\end{pmatrix}, |1\\rangle = \\begin{pmatrix} 0 \\\\ 1 \\end{pmatrix}"></div>
                <div data-el="text" data-x="54%" data-y="44%" data-w="41%" data-h="auto" data-font="12" data-color="#94a3b8">General state:</div>
                <div data-el="formula" data-x="54%" data-y="48%" data-w="41%" data-h="6%" data-font="18" data-color="#22d3ee" data-latex="|\\psi\\rangle = \\begin{pmatrix} \\alpha \\\\ \\beta \\end{pmatrix}"></div>

                <!-- 底部：量子门表格 -->
                <div data-el="text" data-x="3%" data-y="60%" data-w="94%" data-h="auto" data-font="16" data-color="#fbbf24" data-bold="true">Common Quantum Gates</div>
                <div data-el="table" data-x="3%" data-y="66%" data-w="94%" data-h="28%"
                     data-data='[["Gate","Symbol","Matrix","Effect"],["Pauli-X","X","[[0,1],[1,0]]","Bit flip"],["Pauli-Z","Z","[[1,0],[0,-1]]","Phase flip"],["Hadamard","H","1/√2[[1,1],[1,-1]]","Superposition"],["CNOT","CX","Controlled NOT","Entanglement"]]'
                     data-header-bg="#4f46e5"
                     data-header-color="#ffffff"
                     data-row-bg="#1e293b"
                     data-alt-row-bg="#0f172a"
                     data-cell-color="#e2e8f0"
                     data-border-color="#334155"
                     data-font-size="11"
                     data-radius="8">
                </div>
            </section>

            <!-- 5. Entanglement - 极限复杂版 -->
            <section data-type="freeform" id="slide-5" data-gradient="linear-gradient(135deg, #0F172A 0%, #2e1065 100%)">
                <!-- 背景效果 -->
                <div data-el="shape" data-shape="circle" data-x="40%" data-y="20%" data-w="40%" data-h="70%" data-fill="#f472b6" data-opacity="0.08" data-filter="blur(80px)"></div>
                <div data-el="shape" data-shape="circle" data-x="10%" data-y="50%" data-w="30%" data-h="50%" data-fill="#22d3ee" data-opacity="0.06" data-filter="blur(50px)"></div>
                <div data-el="shape" data-shape="circle" data-x="70%" data-y="50%" data-w="30%" data-h="50%" data-fill="#a855f7" data-opacity="0.06" data-filter="blur(50px)"></div>
                
                <div data-el="text" data-x="5%" data-y="6%" data-w="90%" data-h="auto" data-font="28" data-color="#F8FAFC" data-bold="true">Quantum Entanglement</div>
                <div data-el="text" data-x="5%" data-y="13%" data-w="90%" data-h="auto" data-font="14" data-color="#f472b6" data-italic="true">"Spooky action at a distance" - Albert Einstein</div>

                <!-- 纠缠可视化 SVG -->
                <div data-el="svg" data-x="5%" data-y="22%" data-w="90%" data-h="35%">
                    <svg viewBox="0 0 800 180" xmlns="http://www.w3.org/2000/svg">
                        <!-- 粒子 A -->
                        <circle cx="150" cy="90" r="50" fill="#1e293b" stroke="#f472b6" stroke-width="3"/>
                        <text x="150" y="80" fill="#f472b6" font-size="32" font-weight="bold" text-anchor="middle">A</text>
                        <text x="150" y="105" fill="#94a3b8" font-size="12" text-anchor="middle">Particle</text>
                        
                        <!-- 纠缠线 -->
                        <path d="M200 90 Q400 30 400 90 Q400 150 600 90" stroke="url(#entangle-grad)" stroke-width="3" fill="none" stroke-dasharray="8,4">
                            <animate attributeName="stroke-dashoffset" from="0" to="24" dur="1s" repeatCount="indefinite"/>
                        </path>
                        <defs>
                            <linearGradient id="entangle-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stop-color="#f472b6"/>
                                <stop offset="50%" stop-color="#a855f7"/>
                                <stop offset="100%" stop-color="#22d3ee"/>
                            </linearGradient>
                        </defs>
                        
                        <!-- 纠缠符号 -->
                        <circle cx="400" cy="90" r="25" fill="#0f172a" stroke="#a855f7" stroke-width="2"/>
                        <text x="400" y="96" fill="#a855f7" font-size="20" text-anchor="middle">⊗</text>
                        
                        <!-- 粒子 B -->
                        <circle cx="650" cy="90" r="50" fill="#1e293b" stroke="#22d3ee" stroke-width="3"/>
                        <text x="650" y="80" fill="#22d3ee" font-size="32" font-weight="bold" text-anchor="middle">B</text>
                        <text x="650" y="105" fill="#94a3b8" font-size="12" text-anchor="middle">Particle</text>
                        
                        <!-- 距离标注 -->
                        <text x="400" y="170" fill="#64748b" font-size="11" text-anchor="middle">Any distance - instantaneous correlation</text>
                    </svg>
                </div>
                
                <!-- Bell States -->
                <div data-el="text" data-x="5%" data-y="60%" data-w="90%" data-h="auto" data-font="16" data-color="#a855f7" data-bold="true">Bell States (Maximally Entangled)</div>
                
                <div data-el="shape" data-shape="rounded" data-x="5%" data-y="66%" data-w="22%" data-h="26%" data-fill="#1e293b" data-radius="10" data-stroke="#334155"></div>
                <div data-el="formula" data-x="6%" data-y="70%" data-w="20%" data-h="8%" data-font="14" data-color="#22d3ee" data-latex="|\\Phi^+\\rangle"></div>
                <div data-el="formula" data-x="6%" data-y="80%" data-w="20%" data-h="10%" data-font="12" data-color="#f8fafc" data-latex="\\frac{|00\\rangle + |11\\rangle}{\\sqrt{2}}"></div>
                
                <div data-el="shape" data-shape="rounded" data-x="29%" data-y="66%" data-w="22%" data-h="26%" data-fill="#1e293b" data-radius="10" data-stroke="#334155"></div>
                <div data-el="formula" data-x="30%" data-y="70%" data-w="20%" data-h="8%" data-font="14" data-color="#f472b6" data-latex="|\\Phi^-\\rangle"></div>
                <div data-el="formula" data-x="30%" data-y="80%" data-w="20%" data-h="10%" data-font="12" data-color="#f8fafc" data-latex="\\frac{|00\\rangle - |11\\rangle}{\\sqrt{2}}"></div>
                
                <div data-el="shape" data-shape="rounded" data-x="53%" data-y="66%" data-w="22%" data-h="26%" data-fill="#1e293b" data-radius="10" data-stroke="#334155"></div>
                <div data-el="formula" data-x="54%" data-y="70%" data-w="20%" data-h="8%" data-font="14" data-color="#fbbf24" data-latex="|\\Psi^+\\rangle"></div>
                <div data-el="formula" data-x="54%" data-y="80%" data-w="20%" data-h="10%" data-font="12" data-color="#f8fafc" data-latex="\\frac{|01\\rangle + |10\\rangle}{\\sqrt{2}}"></div>
                
                <div data-el="shape" data-shape="rounded" data-x="77%" data-y="66%" data-w="18%" data-h="26%" data-fill="#1e293b" data-radius="10" data-stroke="#334155"></div>
                <div data-el="formula" data-x="78%" data-y="70%" data-w="16%" data-h="8%" data-font="14" data-color="#10b981" data-latex="|\\Psi^-\\rangle"></div>
                <div data-el="formula" data-x="78%" data-y="80%" data-w="16%" data-h="10%" data-font="12" data-color="#f8fafc" data-latex="\\frac{|01\\rangle - |10\\rangle}{\\sqrt{2}}"></div>
            </section>

            <!-- 6. Algorithms - 极限复杂版 -->
            <section data-type="freeform" id="slide-6" data-gradient="linear-gradient(135deg, #0F172A 0%, #1e1b4b 100%)">
                <!-- 背景 -->
                <div data-el="shape" data-shape="circle" data-x="80%" data-y="-20%" data-w="50%" data-h="80%" data-fill="#22d3ee" data-opacity="0.06" data-filter="blur(60px)"></div>
                <div data-el="shape" data-shape="circle" data-x="-10%" data-y="70%" data-w="40%" data-h="60%" data-fill="#10b981" data-opacity="0.06" data-filter="blur(50px)"></div>
                
                <div data-el="text" data-x="5%" data-y="5%" data-w="90%" data-h="auto" data-font="28" data-color="#F8FAFC" data-bold="true">Quantum Algorithms</div>
                <div data-el="text" data-x="5%" data-y="11%" data-w="90%" data-h="auto" data-font="13" data-color="#64748b">Exponential speedup over classical computation</div>

                <!-- 算法对比图表 -->
                <div data-el="chart" data-x="3%" data-y="18%" data-w="45%" data-h="35%"
                     data-chart-type="bar"
                     data-chart-data="RSA-2048:10000,Search:1000,Simulation:500,Optimization:200"
                     data-colors="#64748b,#22d3ee,#a855f7,#10b981"
                     data-labels="Classical Time (years)"></div>

                <!-- Shor's Algorithm -->
                <div data-el="shape" data-shape="rounded" data-x="52%" data-y="18%" data-w="45%" data-h="35%" data-fill="#1e293b" data-radius="12" data-stroke="#22d3ee"></div>
                <div data-el="icon" data-x="55%" data-y="22%" data-icon="carbon:security" data-size="24" data-color="#22d3ee"></div>
                <div data-el="text" data-x="61%" data-y="22%" data-w="33%" data-h="auto" data-font="18" data-color="#22d3ee" data-bold="true">Shor's Algorithm</div>
                <div data-el="text" data-x="55%" data-y="30%" data-w="39%" data-h="auto" data-font="12" data-color="#94a3b8" data-line-height="1.4">
                    Factorizes large integers exponentially faster. Threatens RSA, ECC encryption.
                </div>
                <div data-el="formula" data-x="55%" data-y="42%" data-w="39%" data-h="8%" data-font="14" data-color="#f8fafc" data-latex="O((\\log N)^3) \\text{ vs } O(e^{N^{1/3}})"></div>

                <!-- Grover's Algorithm -->
                <div data-el="shape" data-shape="rounded" data-x="3%" data-y="56%" data-w="30%" data-h="38%" data-fill="#1e293b" data-radius="12" data-stroke="#a855f7"></div>
                <div data-el="icon" data-x="6%" data-y="60%" data-icon="carbon:search" data-size="20" data-color="#a855f7"></div>
                <div data-el="text" data-x="11%" data-y="60%" data-w="20%" data-h="auto" data-font="16" data-color="#a855f7" data-bold="true">Grover's</div>
                <div data-el="text" data-x="6%" data-y="68%" data-w="24%" data-h="auto" data-font="11" data-color="#94a3b8" data-line-height="1.4">Quadratic speedup for unstructured search</div>
                <div data-el="formula" data-x="6%" data-y="80%" data-w="24%" data-h="10%" data-font="12" data-color="#f8fafc" data-latex="O(\\sqrt{N}) \\text{ vs } O(N)"></div>

                <!-- VQE -->
                <div data-el="shape" data-shape="rounded" data-x="35%" data-y="56%" data-w="30%" data-h="38%" data-fill="#1e293b" data-radius="12" data-stroke="#10b981"></div>
                <div data-el="icon" data-x="38%" data-y="60%" data-icon="carbon:chemistry" data-size="20" data-color="#10b981"></div>
                <div data-el="text" data-x="43%" data-y="60%" data-w="20%" data-h="auto" data-font="16" data-color="#10b981" data-bold="true">VQE</div>
                <div data-el="text" data-x="38%" data-y="68%" data-w="24%" data-h="auto" data-font="11" data-color="#94a3b8" data-line-height="1.4">Variational quantum eigensolver for chemistry</div>
                <div data-el="formula" data-x="38%" data-y="82%" data-w="24%" data-h="8%" data-font="12" data-color="#f8fafc" data-latex="\\min_{\\theta} \\langle\\psi(\\theta)|H|\\psi(\\theta)\\rangle"></div>

                <!-- QAOA -->
                <div data-el="shape" data-shape="rounded" data-x="67%" data-y="56%" data-w="30%" data-h="38%" data-fill="#1e293b" data-radius="12" data-stroke="#f472b6"></div>
                <div data-el="icon" data-x="70%" data-y="60%" data-icon="carbon:network-4" data-size="20" data-color="#f472b6"></div>
                <div data-el="text" data-x="75%" data-y="60%" data-w="20%" data-h="auto" data-font="16" data-color="#f472b6" data-bold="true">QAOA</div>
                <div data-el="text" data-x="70%" data-y="68%" data-w="24%" data-h="auto" data-font="11" data-color="#94a3b8" data-line-height="1.4">Quantum optimization for combinatorics</div>
                <div data-el="formula" data-x="70%" data-y="82%" data-w="24%" data-h="8%" data-font="12" data-color="#f8fafc" data-latex="U(\\beta,\\gamma) = e^{-i\\beta H_M} e^{-i\\gamma H_C}"></div>
            </section>

            <!-- 6b. Layered Effects Demo -->
            <section data-type="freeform" id="slide-6b" data-bg="#0A0F1A">
                <!-- SVG Mask Definition (hidden, used for CSS mask reference) -->
                <svg style="position: absolute; width: 0; height: 0; overflow: hidden;">
                    <defs>
                        <linearGradient id="maskGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stop-color="white" stop-opacity="1" />
                            <stop offset="100%" stop-color="white" stop-opacity="0.2" />
                        </linearGradient>
                        <mask id="layer-mask" maskUnits="objectBoundingBox" maskContentUnits="objectBoundingBox">
                            <rect x="0" y="0" width="1" height="1" fill="url(#maskGradient)" />
                        </mask>
                    </defs>
                </svg>

                <!-- Background glow -->
                <div data-el="shape" data-shape="circle" data-x="-10%" data-y="-20%" data-w="70%" data-h="120%" data-fill="#7c3aed" data-opacity="0.35"></div>
                <div data-el="shape" data-shape="circle" data-x="50%" data-y="50%" data-w="70%" data-h="120%" data-fill="#22d3ee" data-opacity="0.28"></div>

                <!-- Blended image with blur effect (mask removed for better compatibility) -->
                <div data-el="image"
                     data-x="10%" data-y="18%" data-w="80%" data-h="64%"
                     data-src="https://placehold.co/1600x900/0b1220/8b5cf6?text=AI+Render"
                     data-blend="screen"
                     data-filter="blur(4px)"
                     data-opacity="0.85"></div>

                <!-- Foreground content -->
                <div data-el="text" data-x="12%" data-y="22%" data-w="60%" data-font="42" data-color="#F8FAFC" data-bold="true">
                    Layered Effects Demo
                </div>
                <div data-el="text" data-x="12%" data-y="32%" data-w="60%" data-font="18" data-color="#cbd5e1" data-line-height="1.6">
                    使用 data-blend、data-mask、data-filter 组合打造复杂视觉效果。PPTX 导出会自动提示不可用的混合/遮罩效果。
                </div>

                <!-- Callout card with outline -->
                <div data-el="card"
                     data-x="12%" data-y="55%" data-w="30%" data-h="28%"
                     data-layout="vertical"
                     data-fill="#0f172a"
                     data-outline="#22d3ee55"
                     data-radius="14"
                     data-icon="carbon:magic-wand"
                     data-icon-bg="#1e293b"
                     data-icon-color="#22d3ee"
                     data-title="可控图层"
                     data-title-color="#e2e8f0"
                     data-subtitle="用 blend/mask/filter 精细描述视觉" data-subtitle-color="#94a3b8">
                </div>

                <div data-el="card"
                     data-x="46%" data-y="55%" data-w="30%" data-h="28%"
                     data-layout="vertical"
                     data-fill="#0f172a"
                     data-outline="#a855f755"
                     data-radius="14"
                     data-icon="carbon:unknown-filled"
                     data-icon-bg="#1e1b4b"
                     data-icon-color="#a855f7"
                     data-title="PPTX 降级提示"
                     data-title-color="#e2e8f0"
                     data-subtitle="导出时标记未支持的效果" data-subtitle-color="#cbd5e1">
                </div>
            </section>

            <!-- 6c. SVG & Table Demo -->
            <section data-type="freeform" id="slide-6c" data-bg="#0F172A">
                <div data-el="text" data-x="5%" data-y="6%" data-w="90%" data-h="auto" data-font="28" data-color="#F8FAFC" data-bold="true">SVG Graphics & Data Tables</div>
                <div data-el="text" data-x="5%" data-y="13%" data-w="90%" data-h="auto" data-font="14" data-color="#94A3B8">AI 可以直接输出 SVG 图形和结构化表格数据</div>

                <!-- 左侧：内联 SVG 流程图 -->
                <div data-el="text" data-x="5%" data-y="22%" data-w="40%" data-h="auto" data-font="16" data-color="#22D3EE" data-bold="true">Process Flow (SVG)</div>
                <div data-el="svg" data-x="5%" data-y="28%" data-w="40%" data-h="35%" data-bg-color="#1E293B" data-radius="12">
                    <svg viewBox="0 0 400 180" xmlns="http://www.w3.org/2000/svg">
                        <!-- 节点 -->
                        <rect x="20" y="70" width="80" height="40" rx="8" fill="#4f46e5"/>
                        <text x="60" y="95" fill="white" font-size="12" text-anchor="middle" font-family="system-ui">Input</text>
                        
                        <rect x="160" y="70" width="80" height="40" rx="8" fill="#10b981"/>
                        <text x="200" y="95" fill="white" font-size="12" text-anchor="middle" font-family="system-ui">Process</text>
                        
                        <rect x="300" y="70" width="80" height="40" rx="8" fill="#f59e0b"/>
                        <text x="340" y="95" fill="white" font-size="12" text-anchor="middle" font-family="system-ui">Output</text>
                        
                        <!-- 箭头 -->
                        <path d="M100 90 L155 90" stroke="#64748b" stroke-width="2" marker-end="url(#arrow)"/>
                        <path d="M240 90 L295 90" stroke="#64748b" stroke-width="2" marker-end="url(#arrow)"/>
                        
                        <!-- 箭头定义 -->
                        <defs>
                            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                                <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b"/>
                            </marker>
                        </defs>
                        
                        <!-- 子流程 -->
                        <rect x="160" y="130" width="80" height="30" rx="6" fill="#1e293b" stroke="#64748b"/>
                        <text x="200" y="150" fill="#94a3b8" font-size="10" text-anchor="middle" font-family="system-ui">Validate</text>
                        <path d="M200 110 L200 125" stroke="#64748b" stroke-width="1" stroke-dasharray="4"/>
                    </svg>
                </div>

                <!-- 右侧：数据表格 -->
                <div data-el="text" data-x="52%" data-y="22%" data-w="43%" data-h="auto" data-font="16" data-color="#A78BFA" data-bold="true">Quantum Hardware Comparison</div>
                <div data-el="table" data-x="52%" data-y="28%" data-w="43%" data-h="35%"
                     data-data='[["Platform", "Qubits", "Coherence", "Gate Speed"],["Superconducting", "100+", "~100μs", "~20ns"],["Trapped Ion", "32", "~10s", "~1ms"],["Photonic", "216", "N/A", "~1ps"],["Neutral Atom", "256", "~1s", "~1μs"]]'
                     data-header-bg="#4f46e5"
                     data-header-color="#ffffff"
                     data-row-bg="#1E293B"
                     data-alt-row-bg="#0F172A"
                     data-cell-color="#E2E8F0"
                     data-border-color="#334155"
                     data-font-size="12"
                     data-radius="8">
                </div>

                <!-- 底部：复杂 SVG 图形 -->
                <div data-el="text" data-x="5%" data-y="68%" data-w="90%" data-h="auto" data-font="16" data-color="#F472B6" data-bold="true">Neural Network Architecture (SVG)</div>
                <div data-el="svg" data-x="5%" data-y="74%" data-w="90%" data-h="22%" data-bg-color="#1E293B" data-radius="12">
                    <svg viewBox="0 0 800 120" xmlns="http://www.w3.org/2000/svg">
                        <!-- 输入层 -->
                        <circle cx="80" cy="30" r="12" fill="#22d3ee"/>
                        <circle cx="80" cy="60" r="12" fill="#22d3ee"/>
                        <circle cx="80" cy="90" r="12" fill="#22d3ee"/>
                        <text x="80" y="115" fill="#64748b" font-size="10" text-anchor="middle">Input</text>
                        
                        <!-- 隐藏层 1 -->
                        <circle cx="240" cy="20" r="10" fill="#8b5cf6"/>
                        <circle cx="240" cy="45" r="10" fill="#8b5cf6"/>
                        <circle cx="240" cy="70" r="10" fill="#8b5cf6"/>
                        <circle cx="240" cy="95" r="10" fill="#8b5cf6"/>
                        <text x="240" y="115" fill="#64748b" font-size="10" text-anchor="middle">Hidden 1</text>
                        
                        <!-- 隐藏层 2 -->
                        <circle cx="400" cy="25" r="10" fill="#a855f7"/>
                        <circle cx="400" cy="55" r="10" fill="#a855f7"/>
                        <circle cx="400" cy="85" r="10" fill="#a855f7"/>
                        <text x="400" y="115" fill="#64748b" font-size="10" text-anchor="middle">Hidden 2</text>
                        
                        <!-- 隐藏层 3 -->
                        <circle cx="560" cy="35" r="10" fill="#ec4899"/>
                        <circle cx="560" cy="70" r="10" fill="#ec4899"/>
                        <text x="560" y="115" fill="#64748b" font-size="10" text-anchor="middle">Hidden 3</text>
                        
                        <!-- 输出层 -->
                        <circle cx="720" cy="55" r="14" fill="#10b981"/>
                        <text x="720" y="115" fill="#64748b" font-size="10" text-anchor="middle">Output</text>
                        
                        <!-- 连接线 -->
                        <g stroke="#64748b" stroke-width="1.5" opacity="0.8">
                            <line x1="92" y1="30" x2="230" y2="20"/><line x1="92" y1="30" x2="230" y2="45"/>
                            <line x1="92" y1="60" x2="230" y2="45"/><line x1="92" y1="60" x2="230" y2="70"/>
                            <line x1="92" y1="90" x2="230" y2="70"/><line x1="92" y1="90" x2="230" y2="95"/>
                            <line x1="250" y1="20" x2="390" y2="25"/><line x1="250" y1="45" x2="390" y2="55"/>
                            <line x1="250" y1="70" x2="390" y2="55"/><line x1="250" y1="95" x2="390" y2="85"/>
                            <line x1="410" y1="25" x2="550" y2="35"/><line x1="410" y1="55" x2="550" y2="35"/>
                            <line x1="410" y1="55" x2="550" y2="70"/><line x1="410" y1="85" x2="550" y2="70"/>
                            <line x1="570" y1="35" x2="706" y2="55"/><line x1="570" y1="70" x2="706" y2="55"/>
                        </g>
                    </svg>
                </div>
            </section>

            <!-- 7. Hardware - 极限复杂版 -->
            <section data-type="freeform" id="slide-7" data-gradient="linear-gradient(180deg, #0F172A 0%, #1e1b4b 100%)">
                <!-- 背景 -->
                <div data-el="shape" data-shape="circle" data-x="-15%" data-y="20%" data-w="50%" data-h="80%" data-fill="#22d3ee" data-opacity="0.05" data-filter="blur(60px)"></div>
                <div data-el="shape" data-shape="circle" data-x="70%" data-y="50%" data-w="40%" data-h="70%" data-fill="#a855f7" data-opacity="0.05" data-filter="blur(50px)"></div>
                
                <div data-el="text" data-x="5%" data-y="5%" data-w="90%" data-h="auto" data-font="28" data-color="#F8FAFC" data-bold="true">Quantum Hardware Platforms</div>
                <div data-el="text" data-x="5%" data-y="11%" data-w="90%" data-h="auto" data-font="13" data-color="#64748b">Engineering at the edge of physics</div>
                
                <!-- 稀释制冷机 SVG 示意图 -->
                <div data-el="svg" data-x="3%" data-y="18%" data-w="35%" data-h="76%" data-bg-color="#1e293b" data-radius="12">
                    <svg viewBox="0 0 280 380" xmlns="http://www.w3.org/2000/svg">
                        <!-- 制冷机外壳 -->
                        <rect x="80" y="20" width="120" height="340" rx="8" fill="#0f172a" stroke="#334155" stroke-width="2"/>
                        <!-- 温度层 -->
                        <rect x="90" y="40" width="100" height="50" rx="4" fill="#334155"/><text x="140" y="70" fill="#f87171" font-size="12" text-anchor="middle">300K</text>
                        <rect x="90" y="100" width="100" height="50" rx="4" fill="#374151"/><text x="140" y="130" fill="#fbbf24" font-size="12" text-anchor="middle">50K</text>
                        <rect x="90" y="160" width="100" height="50" rx="4" fill="#1f2937"/><text x="140" y="190" fill="#a3e635" font-size="12" text-anchor="middle">4K</text>
                        <rect x="90" y="220" width="100" height="50" rx="4" fill="#111827"/><text x="140" y="250" fill="#22d3ee" font-size="12" text-anchor="middle">1K</text>
                        <rect x="90" y="280" width="100" height="60" rx="4" fill="#0c0a09" stroke="#22d3ee" stroke-width="2"/>
                        <!-- 量子处理器 -->
                        <rect x="105" y="290" width="70" height="35" rx="4" fill="#1e293b" stroke="#a855f7" stroke-width="2"/>
                        <text x="140" y="312" fill="#a855f7" font-size="11" font-weight="bold" text-anchor="middle">QPU</text>
                        <!-- 标签 -->
                        <text x="140" y="370" fill="#64748b" font-size="10" text-anchor="middle">Dilution Refrigerator</text>
                    </svg>
                </div>
                
                <!-- 硬件对比表格 -->
                <div data-el="table" data-x="40%" data-y="18%" data-w="57%" data-h="35%"
                     data-data='[["Platform","Qubits","T1/T2","Gate Fidelity","Operating Temp"],["Superconducting","1000+","100μs","99.9%","15mK"],["Trapped Ion","32","10s","99.99%","~0°C"],["Photonic","216","N/A","99%","Room"],["Neutral Atom","1000+","1s","99.5%","~μK"],["NV Center","10","1ms","99%","Room"]]'
                     data-header-bg="#4f46e5" data-header-color="#ffffff"
                     data-row-bg="#1e293b" data-alt-row-bg="#0f172a"
                     data-cell-color="#e2e8f0" data-border-color="#334155"
                     data-font-size="10" data-radius="8">
                </div>
                
                <!-- 技术卡片 -->
                <div data-el="card" data-x="40%" data-y="56%" data-w="27%" data-h="18%" data-layout="horizontal" data-fill="#1e293b" data-radius="10" data-stroke="#22d3ee"
                     data-icon="carbon:temperature-frigid" data-icon-color="#22d3ee" data-icon-size="28"
                     data-title="Superconducting" data-title-color="#22d3ee" data-title-size="14"
                     data-subtitle="Josephson junctions, fast gates" data-subtitle-color="#94a3b8" data-subtitle-size="10"></div>
                <div data-el="card" data-x="70%" data-y="56%" data-w="27%" data-h="18%" data-layout="horizontal" data-fill="#1e293b" data-radius="10" data-stroke="#a855f7"
                     data-icon="carbon:lightning" data-icon-color="#a855f7" data-icon-size="28"
                     data-title="Trapped Ion" data-title-color="#a855f7" data-title-size="14"
                     data-subtitle="Highest fidelity, slower" data-subtitle-color="#94a3b8" data-subtitle-size="10"></div>
                <div data-el="card" data-x="40%" data-y="76%" data-w="27%" data-h="18%" data-layout="horizontal" data-fill="#1e293b" data-radius="10" data-stroke="#10b981"
                     data-icon="carbon:flash" data-icon-color="#10b981" data-icon-size="28"
                     data-title="Photonic" data-title-color="#10b981" data-title-size="14"
                     data-subtitle="Room temp, networking" data-subtitle-color="#94a3b8" data-subtitle-size="10"></div>
                <div data-el="card" data-x="70%" data-y="76%" data-w="27%" data-h="18%" data-layout="horizontal" data-fill="#1e293b" data-radius="10" data-stroke="#f472b6"
                     data-icon="carbon:circle-filled" data-icon-color="#f472b6" data-icon-size="28"
                     data-title="Neutral Atom" data-title-color="#f472b6" data-title-size="14"
                     data-subtitle="Scalable arrays" data-subtitle-color="#94a3b8" data-subtitle-size="10"></div>
            </section>

            <!-- 8. Applications - 极限复杂版 -->
            <section data-type="freeform" id="slide-8" data-gradient="linear-gradient(135deg, #0F172A 0%, #1e1b4b 100%)">
                <div data-el="shape" data-shape="circle" data-x="70%" data-y="-20%" data-w="50%" data-h="80%" data-fill="#10b981" data-opacity="0.06" data-filter="blur(60px)"></div>
                <div data-el="shape" data-shape="circle" data-x="-10%" data-y="60%" data-w="40%" data-h="70%" data-fill="#f472b6" data-opacity="0.06" data-filter="blur(50px)"></div>
                
                <div data-el="text" data-x="5%" data-y="5%" data-w="90%" data-h="auto" data-font="28" data-color="#F8FAFC" data-bold="true">Quantum Applications</div>
                <div data-el="text" data-x="5%" data-y="11%" data-w="90%" data-h="auto" data-font="13" data-color="#64748b">Transforming industries with quantum advantage</div>
                
                <!-- 应用卡片网格 -->
                <div data-el="card" data-x="3%" data-y="18%" data-w="30%" data-h="36%" data-layout="vertical" data-fill="#1e293b" data-radius="12" data-stroke="#10b981"
                     data-icon="carbon:chemistry" data-icon-color="#10b981" data-icon-bg="#0f172a" data-icon-size="36"
                     data-title="Drug Discovery" data-title-color="#10b981" data-title-size="18"
                     data-subtitle="Simulate molecular interactions, protein folding, drug binding. 1000x faster than classical." data-subtitle-color="#94a3b8" data-subtitle-size="11"></div>
                
                <div data-el="card" data-x="35%" data-y="18%" data-w="30%" data-h="36%" data-layout="vertical" data-fill="#1e293b" data-radius="12" data-stroke="#f472b6"
                     data-icon="carbon:security" data-icon-color="#f472b6" data-icon-bg="#0f172a" data-icon-size="36"
                     data-title="Cryptography" data-title-color="#f472b6" data-title-size="18"
                     data-subtitle="Break RSA/ECC. Enable quantum key distribution (QKD). Post-quantum standards." data-subtitle-color="#94a3b8" data-subtitle-size="11"></div>
                
                <div data-el="card" data-x="67%" data-y="18%" data-w="30%" data-h="36%" data-layout="vertical" data-fill="#1e293b" data-radius="12" data-stroke="#fbbf24"
                     data-icon="carbon:network-4" data-icon-color="#fbbf24" data-icon-bg="#0f172a" data-icon-size="36"
                     data-title="Optimization" data-title-color="#fbbf24" data-title-size="18"
                     data-subtitle="Supply chain, portfolio optimization, traffic routing. Solve NP-hard problems." data-subtitle-color="#94a3b8" data-subtitle-size="11"></div>
                
                <div data-el="card" data-x="3%" data-y="57%" data-w="30%" data-h="36%" data-layout="vertical" data-fill="#1e293b" data-radius="12" data-stroke="#22d3ee"
                     data-icon="carbon:machine-learning" data-icon-color="#22d3ee" data-icon-bg="#0f172a" data-icon-size="36"
                     data-title="Quantum ML" data-title-color="#22d3ee" data-title-size="18"
                     data-subtitle="Quantum neural networks, kernel methods, faster training on high-dimensional data." data-subtitle-color="#94a3b8" data-subtitle-size="11"></div>
                
                <div data-el="card" data-x="35%" data-y="57%" data-w="30%" data-h="36%" data-layout="vertical" data-fill="#1e293b" data-radius="12" data-stroke="#a855f7"
                     data-icon="carbon:earth" data-icon-color="#a855f7" data-icon-bg="#0f172a" data-icon-size="36"
                     data-title="Climate Modeling" data-title-color="#a855f7" data-title-size="18"
                     data-subtitle="Accurate climate simulations, materials for carbon capture, battery design." data-subtitle-color="#94a3b8" data-subtitle-size="11"></div>
                
                <div data-el="card" data-x="67%" data-y="57%" data-w="30%" data-h="36%" data-layout="vertical" data-fill="#1e293b" data-radius="12" data-stroke="#f87171"
                     data-icon="carbon:currency-dollar" data-icon-color="#f87171" data-icon-bg="#0f172a" data-icon-size="36"
                     data-title="Finance" data-title-color="#f87171" data-title-size="18"
                     data-subtitle="Risk analysis, derivative pricing, fraud detection, portfolio optimization." data-subtitle-color="#94a3b8" data-subtitle-size="11"></div>
            </section>


            <!-- 9. Market Growth - 极限复杂版 -->
            <section data-type="freeform" id="slide-9" data-gradient="linear-gradient(135deg, #fafafa 0%, #f1f5f9 100%)">
                <div data-el="shape" data-shape="circle" data-x="80%" data-y="-30%" data-w="50%" data-h="80%" data-fill="#4f46e5" data-opacity="0.05" data-filter="blur(80px)"></div>
                
                <div data-el="text" data-x="5%" data-y="5%" data-w="60%" data-h="auto" data-font="28" data-color="#0F172A" data-bold="true">Investment Landscape</div>
                <div data-el="text" data-x="5%" data-y="11%" data-w="60%" data-h="auto" data-font="13" data-color="#64748b">Quantum computing market is experiencing exponential growth</div>
                
                <!-- 主图表 -->
                <div data-el="chart" data-x="3%" data-y="18%" data-w="55%" data-h="50%"
                     data-chart-type="line"
                     data-chart-data="2020:0.7,2021:1.4,2022:2.3,2023:3.8,2024:5.2,2025:8.5"
                     data-colors="#06B6D4"
                     data-labels="Billion USD"></div>
                
                <!-- 右侧统计卡片 -->
                <div data-el="card" data-x="60%" data-y="18%" data-w="37%" data-h="16%" data-layout="horizontal" data-fill="#ffffff" data-radius="12" data-stroke="#e2e8f0" data-shadow="true"
                     data-icon="carbon:currency-dollar" data-icon-color="#0891b2" data-icon-bg="#ecfeff" data-icon-size="32"
                     data-title="$8.5 Billion" data-title-color="#0f172a" data-title-size="22"
                     data-subtitle="Projected market size by 2025" data-subtitle-color="#64748b" data-subtitle-size="11"></div>
                
                <div data-el="card" data-x="60%" data-y="36%" data-w="37%" data-h="16%" data-layout="horizontal" data-fill="#ffffff" data-radius="12" data-stroke="#e2e8f0" data-shadow="true"
                     data-icon="carbon:growth" data-icon-color="#10b981" data-icon-bg="#ecfdf5" data-icon-size="32"
                     data-title="40% CAGR" data-title-color="#0f172a" data-title-size="22"
                     data-subtitle="Compound annual growth rate" data-subtitle-color="#64748b" data-subtitle-size="11"></div>
                
                <div data-el="card" data-x="60%" data-y="54%" data-w="37%" data-h="16%" data-layout="horizontal" data-fill="#ffffff" data-radius="12" data-stroke="#e2e8f0" data-shadow="true"
                     data-icon="carbon:enterprise" data-icon-color="#8b5cf6" data-icon-bg="#f5f3ff" data-icon-size="32"
                     data-title="$25B+ Invested" data-title-color="#0f172a" data-title-size="22"
                     data-subtitle="Total VC and government funding" data-subtitle-color="#64748b" data-subtitle-size="11"></div>
                
                <!-- 公司 Logo 示意 -->
                <div data-el="text" data-x="3%" data-y="72%" data-w="94%" data-h="auto" data-font="12" data-color="#64748b">Major Players</div>
                <div data-el="shape" data-shape="rounded" data-x="3%" data-y="77%" data-w="15%" data-h="12%" data-fill="#ffffff" data-radius="8" data-stroke="#e2e8f0"></div>
                <div data-el="text" data-x="3%" data-y="81%" data-w="15%" data-h="auto" data-font="11" data-color="#0f172a" data-align="center" data-bold="true">IBM</div>
                <div data-el="shape" data-shape="rounded" data-x="20%" data-y="77%" data-w="15%" data-h="12%" data-fill="#ffffff" data-radius="8" data-stroke="#e2e8f0"></div>
                <div data-el="text" data-x="20%" data-y="81%" data-w="15%" data-h="auto" data-font="11" data-color="#0f172a" data-align="center" data-bold="true">Google</div>
                <div data-el="shape" data-shape="rounded" data-x="37%" data-y="77%" data-w="15%" data-h="12%" data-fill="#ffffff" data-radius="8" data-stroke="#e2e8f0"></div>
                <div data-el="text" data-x="37%" data-y="81%" data-w="15%" data-h="auto" data-font="11" data-color="#0f172a" data-align="center" data-bold="true">IonQ</div>
                <div data-el="shape" data-shape="rounded" data-x="54%" data-y="77%" data-w="15%" data-h="12%" data-fill="#ffffff" data-radius="8" data-stroke="#e2e8f0"></div>
                <div data-el="text" data-x="54%" data-y="81%" data-w="15%" data-h="auto" data-font="11" data-color="#0f172a" data-align="center" data-bold="true">Rigetti</div>
                <div data-el="shape" data-shape="rounded" data-x="71%" data-y="77%" data-w="13%" data-h="12%" data-fill="#ffffff" data-radius="8" data-stroke="#e2e8f0"></div>
                <div data-el="text" data-x="71%" data-y="81%" data-w="13%" data-h="auto" data-font="11" data-color="#0f172a" data-align="center" data-bold="true">D-Wave</div>
                <div data-el="shape" data-shape="rounded" data-x="86%" data-y="77%" data-w="11%" data-h="12%" data-fill="#ffffff" data-radius="8" data-stroke="#e2e8f0"></div>
                <div data-el="text" data-x="86%" data-y="81%" data-w="11%" data-h="auto" data-font="10" data-color="#0f172a" data-align="center" data-bold="true">Quantinuum</div>
            </section>

            <!-- 10. Challenges - 极限复杂版 -->
            <section data-type="freeform" id="slide-10" data-gradient="linear-gradient(135deg, #0F172A 0%, #1e1b4b 100%)">
                <div data-el="shape" data-shape="circle" data-x="70%" data-y="-20%" data-w="50%" data-h="80%" data-fill="#f87171" data-opacity="0.06" data-filter="blur(60px)"></div>
                <div data-el="shape" data-shape="circle" data-x="-10%" data-y="60%" data-w="40%" data-h="70%" data-fill="#10b981" data-opacity="0.06" data-filter="blur(50px)"></div>
                
                <div data-el="text" data-x="5%" data-y="5%" data-w="90%" data-h="auto" data-font="28" data-color="#F8FAFC" data-bold="true">Quantum Challenges</div>
                <div data-el="text" data-x="5%" data-y="11%" data-w="90%" data-h="auto" data-font="13" data-color="#64748b">The obstacles on the path to practical quantum computing</div>

                <!-- 退相干可视化 SVG -->
                <div data-el="svg" data-x="3%" data-y="18%" data-w="45%" data-h="35%" data-bg-color="#1e293b" data-radius="12">
                    <svg viewBox="0 0 400 180" xmlns="http://www.w3.org/2000/svg">
                        <text x="200" y="20" fill="#f87171" font-size="14" font-weight="bold" text-anchor="middle">Decoherence Timeline</text>
                        <!-- 波形衰减 -->
                        <path d="M30 90 Q60 50 90 90 Q120 130 150 90 Q180 60 210 90 Q240 115 270 90 Q300 75 330 90 Q360 98 380 90" 
                              stroke="#22d3ee" stroke-width="3" fill="none" opacity="0.9"/>
                        <path d="M30 90 Q60 65 90 90 Q120 110 150 90 Q180 75 210 90 Q240 100 270 90 Q300 85 330 90 Q360 92 380 90" 
                              stroke="#a855f7" stroke-width="2" fill="none" opacity="0.6" stroke-dasharray="4"/>
                        <text x="30" y="140" fill="#64748b" font-size="10">t=0</text>
                        <text x="200" y="140" fill="#64748b" font-size="10">T₂ (Dephasing)</text>
                        <text x="350" y="140" fill="#64748b" font-size="10">T₁</text>
                        <line x1="30" y1="145" x2="380" y2="145" stroke="#334155" stroke-width="1"/>
                        <text x="200" y="170" fill="#94a3b8" font-size="11" text-anchor="middle">Quantum state loses coherence over time</text>
                    </svg>
                </div>
                
                <!-- 错误类型表格 -->
                <div data-el="table" data-x="52%" data-y="18%" data-w="45%" data-h="35%"
                     data-data='[["Error Type","Cause","Solution"],["Bit Flip","Thermal noise","X gate correction"],["Phase Flip","Dephasing","Z gate correction"],["Depolarizing","Random errors","Surface codes"],["Leakage","Level escape","Reset protocols"]]'
                     data-header-bg="#f87171" data-header-color="#ffffff"
                     data-row-bg="#1e293b" data-alt-row-bg="#0f172a"
                     data-cell-color="#e2e8f0" data-border-color="#334155"
                     data-font-size="10" data-radius="8">
                </div>
                
                <!-- 纠错示意 -->
                <div data-el="text" data-x="3%" data-y="56%" data-w="94%" data-h="auto" data-font="16" data-color="#10b981" data-bold="true">Quantum Error Correction</div>
                
                <div data-el="svg" data-x="3%" data-y="62%" data-w="94%" data-h="32%" data-bg-color="#1e293b" data-radius="12">
                    <svg viewBox="0 0 850 150" xmlns="http://www.w3.org/2000/svg">
                        <!-- 物理量子比特 -->
                        <text x="100" y="20" fill="#64748b" font-size="12" text-anchor="middle">Physical Qubits</text>
                        <circle cx="40" cy="60" r="15" fill="#334155" stroke="#f87171" stroke-width="2"/><text x="40" y="65" fill="#f8fafc" font-size="10" text-anchor="middle">P₁</text>
                        <circle cx="80" cy="60" r="15" fill="#334155" stroke="#f87171" stroke-width="2"/><text x="80" y="65" fill="#f8fafc" font-size="10" text-anchor="middle">P₂</text>
                        <circle cx="120" cy="60" r="15" fill="#334155" stroke="#f87171" stroke-width="2"/><text x="120" y="65" fill="#f8fafc" font-size="10" text-anchor="middle">P₃</text>
                        <circle cx="60" cy="100" r="15" fill="#334155" stroke="#f87171" stroke-width="2"/><text x="60" y="105" fill="#f8fafc" font-size="10" text-anchor="middle">P₄</text>
                        <circle cx="100" cy="100" r="15" fill="#334155" stroke="#f87171" stroke-width="2"/><text x="100" y="105" fill="#f8fafc" font-size="10" text-anchor="middle">P₅</text>
                        <circle cx="80" cy="140" r="15" fill="#334155" stroke="#f87171" stroke-width="2"/><text x="80" y="145" fill="#f8fafc" font-size="10" text-anchor="middle">P₆</text>
                        <circle cx="140" cy="100" r="15" fill="#334155" stroke="#f87171" stroke-width="2"/><text x="140" y="105" fill="#f8fafc" font-size="10" text-anchor="middle">P₇</text>
                        
                        <!-- 箭头 -->
                        <path d="M180 80 L280 80" stroke="#64748b" stroke-width="2" marker-end="url(#arrow-ec)"/>
                        <text x="230" y="70" fill="#64748b" font-size="10" text-anchor="middle">Encode</text>
                        <defs><marker id="arrow-ec" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b"/></marker></defs>
                        
                        <!-- 逻辑量子比特 -->
                        <text x="380" y="20" fill="#64748b" font-size="12" text-anchor="middle">Logical Qubit</text>
                        <rect x="310" y="40" width="140" height="100" rx="12" fill="#0f172a" stroke="#10b981" stroke-width="3"/>
                        <text x="380" y="95" fill="#10b981" font-size="24" font-weight="bold" text-anchor="middle">|L⟩</text>
                        <text x="380" y="120" fill="#94a3b8" font-size="10" text-anchor="middle">Error Protected</text>
                        
                        <!-- Surface Code 示意 -->
                        <text x="600" y="20" fill="#64748b" font-size="12" text-anchor="middle">Surface Code (d=3)</text>
                        <rect x="500" y="35" width="200" height="110" rx="8" fill="#1e293b" stroke="#334155"/>
                        <g fill="#a855f7">
                            <rect x="520" y="50" width="25" height="25" rx="4"/><rect x="560" y="50" width="25" height="25" rx="4"/><rect x="600" y="50" width="25" height="25" rx="4"/><rect x="640" y="50" width="25" height="25" rx="4"/>
                            <rect x="540" y="80" width="25" height="25" rx="4"/><rect x="580" y="80" width="25" height="25" rx="4"/><rect x="620" y="80" width="25" height="25" rx="4"/><rect x="660" y="80" width="25" height="25" rx="4"/>
                            <rect x="520" y="110" width="25" height="25" rx="4"/><rect x="560" y="110" width="25" height="25" rx="4"/><rect x="600" y="110" width="25" height="25" rx="4"/><rect x="640" y="110" width="25" height="25" rx="4"/>
                        </g>
                        <g fill="#22d3ee">
                            <circle cx="555" cy="75" r="8"/><circle cx="595" cy="75" r="8"/><circle cx="635" cy="75" r="8"/>
                            <circle cx="575" cy="105" r="8"/><circle cx="615" cy="105" r="8"/><circle cx="655" cy="105" r="8"/>
                        </g>
                    </svg>
                </div>
            </section>

            <!-- 11. Roadmap - 极限复杂版 -->
            <section data-type="freeform" id="slide-11" data-gradient="linear-gradient(135deg, #0F172A 0%, #1e1b4b 100%)">
                <div data-el="shape" data-shape="circle" data-x="50%" data-y="30%" data-w="40%" data-h="70%" data-fill="#8b5cf6" data-opacity="0.06" data-filter="blur(60px)"></div>
                
                <div data-el="text" data-x="5%" data-y="5%" data-w="90%" data-h="auto" data-font="28" data-color="#F8FAFC" data-bold="true">Roadmap to Quantum Advantage</div>
                <div data-el="text" data-x="5%" data-y="11%" data-w="90%" data-h="auto" data-font="13" data-color="#64748b">The path from NISQ to fault-tolerant quantum computing</div>
                
                <!-- 时间线 SVG -->
                <div data-el="svg" data-x="3%" data-y="18%" data-w="94%" data-h="75%">
                    <svg viewBox="0 0 850 350" xmlns="http://www.w3.org/2000/svg">
                        <!-- 主时间线 -->
                        <line x1="50" y1="180" x2="800" y2="180" stroke="#334155" stroke-width="4"/>
                        <defs>
                            <linearGradient id="timeline-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stop-color="#64748b"/><stop offset="30%" stop-color="#22d3ee"/>
                                <stop offset="60%" stop-color="#8b5cf6"/><stop offset="100%" stop-color="#10b981"/>
                            </linearGradient>
                        </defs>
                        <line x1="50" y1="180" x2="800" y2="180" stroke="url(#timeline-grad)" stroke-width="4"/>
                        
                        <!-- 2023 - NISQ -->
                        <circle cx="120" cy="180" r="20" fill="#64748b" stroke="#f8fafc" stroke-width="2"/>
                        <text x="120" y="185" fill="#f8fafc" font-size="12" font-weight="bold" text-anchor="middle">NOW</text>
                        <text x="120" y="145" fill="#f8fafc" font-size="14" font-weight="bold" text-anchor="middle">2023-24</text>
                        <rect x="50" y="210" width="140" height="120" rx="8" fill="#1e293b" stroke="#64748b"/>
                        <text x="120" y="235" fill="#64748b" font-size="12" font-weight="bold" text-anchor="middle">NISQ Era</text>
                        <text x="120" y="255" fill="#94a3b8" font-size="10" text-anchor="middle">• 100-1000 qubits</text>
                        <text x="120" y="270" fill="#94a3b8" font-size="10" text-anchor="middle">• High error rates</text>
                        <text x="120" y="285" fill="#94a3b8" font-size="10" text-anchor="middle">• Limited algorithms</text>
                        <text x="120" y="300" fill="#94a3b8" font-size="10" text-anchor="middle">• Proof of concepts</text>
                        
                        <!-- 2025-26 -->
                        <circle cx="320" cy="180" r="20" fill="#22d3ee" stroke="#f8fafc" stroke-width="2"/>
                        <text x="320" y="185" fill="#0f172a" font-size="12" font-weight="bold" text-anchor="middle">2026</text>
                        <text x="320" y="145" fill="#22d3ee" font-size="14" font-weight="bold" text-anchor="middle">Error Mitigation</text>
                        <rect x="250" y="210" width="140" height="120" rx="8" fill="#1e293b" stroke="#22d3ee"/>
                        <text x="320" y="235" fill="#22d3ee" font-size="12" font-weight="bold" text-anchor="middle">Scaling Up</text>
                        <text x="320" y="255" fill="#94a3b8" font-size="10" text-anchor="middle">• 1000+ qubits</text>
                        <text x="320" y="270" fill="#94a3b8" font-size="10" text-anchor="middle">• Better coherence</text>
                        <text x="320" y="285" fill="#94a3b8" font-size="10" text-anchor="middle">• Hybrid algorithms</text>
                        <text x="320" y="300" fill="#94a3b8" font-size="10" text-anchor="middle">• Early advantage</text>
                        
                        <!-- 2028-30 -->
                        <circle cx="520" cy="180" r="20" fill="#8b5cf6" stroke="#f8fafc" stroke-width="2"/>
                        <text x="520" y="185" fill="#f8fafc" font-size="12" font-weight="bold" text-anchor="middle">2030</text>
                        <text x="520" y="145" fill="#8b5cf6" font-size="14" font-weight="bold" text-anchor="middle">Logical Qubits</text>
                        <rect x="450" y="210" width="140" height="120" rx="8" fill="#1e293b" stroke="#8b5cf6"/>
                        <text x="520" y="235" fill="#8b5cf6" font-size="12" font-weight="bold" text-anchor="middle">Error Correction</text>
                        <text x="520" y="255" fill="#94a3b8" font-size="10" text-anchor="middle">• Logical qubits</text>
                        <text x="520" y="270" fill="#94a3b8" font-size="10" text-anchor="middle">• Surface codes</text>
                        <text x="520" y="285" fill="#94a3b8" font-size="10" text-anchor="middle">• Quantum networks</text>
                        <text x="520" y="300" fill="#94a3b8" font-size="10" text-anchor="middle">• Industry adoption</text>
                        
                        <!-- 2035+ -->
                        <circle cx="720" cy="180" r="20" fill="#10b981" stroke="#f8fafc" stroke-width="2"/>
                        <text x="720" y="185" fill="#0f172a" font-size="12" font-weight="bold" text-anchor="middle">2035+</text>
                        <text x="720" y="145" fill="#10b981" font-size="14" font-weight="bold" text-anchor="middle">Fault Tolerant</text>
                        <rect x="650" y="210" width="140" height="120" rx="8" fill="#1e293b" stroke="#10b981"/>
                        <text x="720" y="235" fill="#10b981" font-size="12" font-weight="bold" text-anchor="middle">Full Scale QC</text>
                        <text x="720" y="255" fill="#94a3b8" font-size="10" text-anchor="middle">• Million+ qubits</text>
                        <text x="720" y="270" fill="#94a3b8" font-size="10" text-anchor="middle">• Universal QC</text>
                        <text x="720" y="285" fill="#94a3b8" font-size="10" text-anchor="middle">• Cryptanalysis</text>
                        <text x="720" y="300" fill="#94a3b8" font-size="10" text-anchor="middle">• Drug discovery</text>
                        
                        <!-- 上方里程碑 -->
                        <text x="220" y="80" fill="#22d3ee" font-size="11" text-anchor="middle">Google Willow</text>
                        <text x="220" y="95" fill="#64748b" font-size="9" text-anchor="middle">Below threshold</text>
                        <line x1="220" y1="100" x2="220" y2="160" stroke="#22d3ee" stroke-width="1" stroke-dasharray="4"/>
                        
                        <text x="420" y="80" fill="#a855f7" font-size="11" text-anchor="middle">IBM Kookaburra</text>
                        <text x="420" y="95" fill="#64748b" font-size="9" text-anchor="middle">100K qubits</text>
                        <line x1="420" y1="100" x2="420" y2="160" stroke="#a855f7" stroke-width="1" stroke-dasharray="4"/>
                        
                        <text x="620" y="80" fill="#10b981" font-size="11" text-anchor="middle">Quantum Internet</text>
                        <text x="620" y="95" fill="#64748b" font-size="9" text-anchor="middle">Global network</text>
                        <line x1="620" y1="100" x2="620" y2="160" stroke="#10b981" stroke-width="1" stroke-dasharray="4"/>
                    </svg>
                </div>
            </section>

            <!-- 12. 结束页 - 极限复杂版 -->
            <section data-type="freeform" id="slide-12" data-gradient="linear-gradient(135deg, #020617 0%, #0F172A 50%, #1e1b4b 100%)">
                <!-- 多层背景效果 -->
                <div data-el="shape" data-shape="circle" data-x="50%" data-y="30%" data-w="60%" data-h="100%" data-fill="#22d3ee" data-opacity="0.08" data-filter="blur(100px)"></div>
                <div data-el="shape" data-shape="circle" data-x="20%" data-y="60%" data-w="40%" data-h="70%" data-fill="#8b5cf6" data-opacity="0.06" data-filter="blur(60px)"></div>
                <div data-el="shape" data-shape="circle" data-x="70%" data-y="50%" data-w="35%" data-h="60%" data-fill="#f472b6" data-opacity="0.05" data-filter="blur(50px)"></div>
                
                <!-- 装饰粒子 -->
                <div data-el="svg" data-x="0%" data-y="0%" data-w="100%" data-h="100%" data-opacity="0.3">
                    <svg viewBox="0 0 960 540" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="100" cy="100" r="4" fill="#22d3ee"/><circle cx="860" cy="80" r="3" fill="#a855f7"/>
                        <circle cx="200" cy="450" r="5" fill="#f472b6"/><circle cx="750" cy="420" r="4" fill="#22d3ee"/>
                        <circle cx="480" cy="50" r="3" fill="#10b981"/><circle cx="150" cy="300" r="4" fill="#fbbf24"/>
                        <circle cx="800" cy="250" r="3" fill="#ec4899"/><circle cx="400" cy="480" r="4" fill="#8b5cf6"/>
                    </svg>
                </div>
                
                <div data-el="text" data-x="0%" data-y="28%" data-w="100%" data-h="auto" data-font="56" data-color="#FFFFFF" data-bold="true" data-align="center">The Future is</div>
                <div data-el="text" data-x="0%" data-y="42%" data-w="100%" data-h="auto" data-font="56" data-color="#22D3EE" data-bold="true" data-align="center">Quantum</div>
                
                <div data-el="line" data-x1="35%" data-y1="56%" data-x2="65%" data-y2="56%" data-stroke="#334155" data-stroke-width="2"></div>
                
                <div data-el="text" data-x="0%" data-y="60%" data-w="100%" data-h="auto" data-font="18" data-color="#94A3B8" data-align="center">Prepare for the paradigm shift in computing.</div>
                
                <!-- 联系信息卡片 -->
                <div data-el="shape" data-shape="rounded" data-x="25%" data-y="70%" data-w="50%" data-h="16%" data-fill="#1e293b" data-opacity="0.9" data-radius="16" data-stroke="#334155"></div>
                <div data-el="icon" data-icon="carbon:email" data-x="28%" data-y="75%" data-size="24" data-color="#22d3ee"></div>
                <div data-el="text" data-x="33%" data-y="75%" data-w="40%" data-h="auto" data-font="14" data-color="#f8fafc">research@quantum.io</div>
                <div data-el="icon" data-icon="carbon:logo-github" data-x="28%" data-y="81%" data-size="24" data-color="#a855f7"></div>
                <div data-el="text" data-x="33%" data-y="81%" data-w="40%" data-h="auto" data-font="14" data-color="#f8fafc">github.com/quantum-research</div>
                <div data-el="icon" data-icon="carbon:globe" data-x="55%" data-y="75%" data-size="24" data-color="#10b981"></div>
                <div data-el="text" data-x="60%" data-y="75%" data-w="15%" data-h="auto" data-font="14" data-color="#f8fafc">quantum.io</div>
                <div data-el="icon" data-icon="carbon:logo-twitter" data-x="55%" data-y="81%" data-size="24" data-color="#f472b6"></div>
                <div data-el="text" data-x="60%" data-y="81%" data-w="15%" data-h="auto" data-font="14" data-color="#f8fafc">@quantumlab</div>
                
                <div data-el="text" data-x="0%" data-y="92%" data-w="100%" data-h="auto" data-font="11" data-color="#475569" data-align="center">© 2025 Quantum Research Institute. All rights reserved.</div>
            </section>

            <!-- Blend Effects Showcase 1: Multiply (Vintage) -->
            <section data-type="freeform" id="slide-blend-1" data-bg="#FDFBF7">
                <!-- 纹理背景 -->
                <div data-el="svg" data-x="0%" data-y="0%" data-w="100%" data-h="100%" data-opacity="0.05">
                    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                        <filter id="noise">
                            <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" stitchTiles="stitch"/>
                        </filter>
                        <rect width="100%" height="100%" filter="url(#noise)"/>
                    </svg>
                </div>

                <!-- 装饰色块 -->
                <div data-el="shape" data-shape="circle" data-x="55%" data-y="10%" data-w="40%" data-h="70%" data-fill="#FCD34D" data-opacity="0.6"></div>
                <div data-el="shape" data-shape="circle" data-x="45%" data-y="40%" data-w="30%" data-h="50%" data-fill="#F87171" data-opacity="0.5"></div>

                <!-- 主图 - Multiply 混合 -->
                <div data-el="image"
                     data-x="10%" data-y="15%" data-w="35%" data-h="70%"
                     data-src="https://placehold.co/800x1200/1a1a2e/666?text=Image+101"
                     data-blend="multiply"
                     data-radius="4"
                     data-filter="sepia(0.5) contrast(1.1)"></div>

                <!-- 文字内容 -->
                <div data-el="text" data-x="55%" data-y="25%" data-w="40%" data-font="48" data-color="#1C1917" data-bold="true" data-font-family="serif">Multiply</div>
                <div data-el="text" data-x="55%" data-y="38%" data-w="40%" data-font="18" data-color="#57534E" data-line-height="1.6">
                    The Multiply mode multiplies the numbers for each pixel of the top layer with the corresponding pixel for the bottom layer. The result is a darker picture.
                </div>
                
                <div data-el="line" data-x1="55%" data-y1="55%" data-x2="65%" data-y2="55%" data-stroke="#D97706" data-stroke-width="3"></div>
                
                <div data-el="text" data-x="55%" data-y="62%" data-w="40%" data-font="14" data-color="#78716C" data-italic="true">
                    "Perfect for creating vintage effects, shadows, and darkening images without losing detail."
                </div>
            </section>

            <!-- Blend Effects Showcase 2: Overlay (Neon) -->
            <section data-type="freeform" id="slide-blend-2" data-bg="#09090B">
                <!-- 背景光效 -->
                <div data-el="shape" data-shape="circle" data-x="-10%" data-y="20%" data-w="60%" data-h="100%" data-fill="#7C3AED" data-opacity="0.4" data-filter="blur(80px)"></div>
                <div data-el="shape" data-shape="circle" data-x="60%" data-y="-20%" data-w="60%" data-h="100%" data-fill="#06B6D4" data-opacity="0.3" data-filter="blur(80px)"></div>

                <!-- 标题 -->
                <div data-el="text" data-x="5%" data-y="10%" data-w="90%" data-font="80" data-color="#FFFFFF" data-bold="true" data-align="center" data-opacity="0.1">OVERLAY</div>
                <div data-el="text" data-x="5%" data-y="12%" data-w="90%" data-font="42" data-color="#F8FAFC" data-bold="true" data-align="center">Overlay Mode</div>

                <!-- 图片展示区 -->
                <div data-el="shape" data-shape="rect" data-x="20%" data-y="30%" data-w="60%" data-h="50%" data-fill="#18181B" data-radius="16" data-stroke="#27272A"></div>
                
                <!-- 底层图片 -->
                <div data-el="image"
                     data-x="20%" data-y="30%" data-w="60%" data-h="50%"
                     data-src="https://placehold.co/1200x600/1a1a2e/666?text=Image+102"
                     data-radius="16"
                     data-opacity="0.6"
                     data-filter="grayscale(100%)"></div>

                <!-- 叠加层 - Overlay -->
                <div data-el="shape" data-shape="rect" data-x="20%" data-y="30%" data-w="60%" data-h="50%"
                     data-fill="linear-gradient(45deg, #7C3AED, #06B6D4)"
                     data-blend="overlay"
                     data-radius="16"></div>

                <div data-el="text" data-x="25%" data-y="85%" data-w="50%" data-font="16" data-color="#A1A1AA" data-align="center">
                    Combines Multiply and Screen modes. Parts of the image that are light become lighter, and parts that are dark become darker.
                </div>
            </section>

            <!-- Blend Effects Showcase 3: Color Dodge (Energy) -->
            <section data-type="freeform" id="slide-blend-3" data-bg="#000000">
                <!-- 能量流 -->
                <div data-el="shape" data-shape="circle" data-x="30%" data-y="30%" data-w="40%" data-h="60%" data-fill="#EC4899" data-opacity="0.5" data-filter="blur(60px)"></div>
                <div data-el="shape" data-shape="circle" data-x="50%" data-y="40%" data-w="30%" data-h="50%" data-fill="#3B82F6" data-opacity="0.5" data-filter="blur(50px)"></div>

                <!-- 主体图片 -->
                <div data-el="image"
                     data-x="15%" data-y="15%" data-w="70%" data-h="70%"
                     data-src="https://placehold.co/1000x800/1a1a2e/666?text=Image+103"
                     data-blend="color-dodge"
                     data-filter="contrast(1.2) brightness(1.1)"></div>

                <div data-el="text" data-x="10%" data-y="80%" data-w="40%" data-font="36" data-color="#F472B6" data-bold="true">Color Dodge</div>
                <div data-el="line" data-x1="10%" data-y1="88%" data-x2="30%" data-y2="88%" data-stroke="#F472B6" data-stroke-width="2"></div>
                <div data-el="text" data-x="10%" data-y="90%" data-w="40%" data-font="14" data-color="#FBCFE8">
                    Creates intense, glowing highlights by decreasing the contrast between the base and blend colors.
                </div>
            </section>

            <!-- Blend Effects Showcase 4: Difference (Avant-Garde) -->
            <section data-type="freeform" id="slide-blend-4" data-bg="#FFFFFF">
                <!-- 几何图形 -->
                <div data-el="shape" data-shape="rect" data-x="10%" data-y="10%" data-w="30%" data-h="80%" data-fill="#000000"></div>
                
                <!-- 图片 - Difference -->
                <div data-el="image"
                     data-x="25%" data-y="20%" data-w="50%" data-h="60%"
                     data-src="https://placehold.co/800x800/1a1a2e/666?text=Image+104"
                     data-blend="difference"></div>

                <div data-el="text" data-x="60%" data-y="15%" data-w="30%" data-font="48" data-color="#000000" data-bold="true" data-align="right">DIFF<br>ERENCE</div>
                
                <div data-el="shape" data-shape="circle" data-x="65%" data-y="60%" data-w="20%" data-h="35%" data-fill="#FACC15" data-blend="exclusion"></div>
                
                <div data-el="text" data-x="60%" data-y="45%" data-w="30%" data-font="14" data-color="#404040" data-align="right" data-line-height="1.5">
                    Subtracts the darker color from the lighter color. White inverts the colors of the base layer.
                </div>
            </section>

            <!-- Mask Effects Showcase (Gallery) -->
            <!-- 元素顺序：效果元素在前（会被烘焙），文字在后（保持可编辑） -->
            <section data-type="freeform" id="slide-mask" data-bg="#18181B">
                <!-- 1. 先声明所有带 mask 的图片（会被烘焙成图片） -->
                <div data-el="image" data-x="5%" data-y="25%" data-w="20%" data-h="30%"
                     data-src="https://placehold.co/400x600/1a1a2e/666?text=Image+105"
                     data-mask="fade-bottom" data-fit="cover" data-radius="8"></div>
                <div data-el="image" data-x="28%" data-y="25%" data-w="20%" data-h="30%"
                     data-src="https://placehold.co/400x600/1a1a2e/666?text=Image+106"
                     data-mask="circle" data-fit="cover"></div>
                <div data-el="image" data-x="51%" data-y="25%" data-w="20%" data-h="30%"
                     data-src="https://placehold.co/400x600/1a1a2e/666?text=Image+107"
                     data-mask="polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)" data-fit="cover"></div>
                <div data-el="image" data-x="74%" data-y="25%" data-w="20%" data-h="30%"
                     data-src="https://placehold.co/400x600/1a1a2e/666?text=Image+108"
                     data-mask="spotlight" data-fit="cover" data-radius="8"></div>
                <div data-el="image" data-x="5%" data-y="75%" data-w="43%" data-h="20%"
                     data-src="https://placehold.co/800x300/1a1a2e/666?text=Image+109"
                     data-mask="fade-right" data-fit="cover" data-radius="8"></div>
                <div data-el="image" data-x="52%" data-y="75%" data-w="43%" data-h="20%"
                     data-src="https://placehold.co/800x300/1a1a2e/666?text=Image+110"
                     data-mask="vignette" data-fit="cover" data-radius="8"></div>

                <!-- 2. 后声明所有文字（保持可编辑，显示在烘焙图片上方） -->
                <div data-el="text" data-x="5%" data-y="8%" data-w="90%" data-font="32" data-color="#F4F4F5" data-bold="true">Visual Masking</div>
                <div data-el="text" data-x="5%" data-y="15%" data-w="90%" data-font="14" data-color="#A1A1AA">Non-destructive image shaping techniques</div>
                <div data-el="text" data-x="5%" data-y="57%" data-w="20%" data-font="12" data-color="#71717A" data-align="center">Fade Bottom</div>
                <div data-el="text" data-x="28%" data-y="57%" data-w="20%" data-font="12" data-color="#71717A" data-align="center">Circle</div>
                <div data-el="text" data-x="51%" data-y="57%" data-w="20%" data-font="12" data-color="#71717A" data-align="center">Diamond</div>
                <div data-el="text" data-x="74%" data-y="57%" data-w="20%" data-font="12" data-color="#71717A" data-align="center">Spotlight</div>
                <div data-el="text" data-x="5%" data-y="68%" data-w="90%" data-font="16" data-color="#E4E4E7" data-bold="true">Advanced Composition</div>
            </section>

            <!-- Complex Example 1: Hero Banner (Modern SaaS) - 简化版 -->
            <section data-type="freeform" id="slide-complex-hero" data-bg="#0F172A">
                <!-- 背景渐变装饰（无 filter，使用透明度代替 blur） -->
                <div data-el="shape" data-shape="circle" data-x="60%" data-y="-20%" data-w="60%" data-h="100%" data-fill="#3B82F6" data-opacity="0.08"></div>
                <div data-el="shape" data-shape="circle" data-x="-10%" data-y="40%" data-w="50%" data-h="80%" data-fill="#8B5CF6" data-opacity="0.06"></div>

                <!-- 右侧 Hero Image（保留 mask 效果） -->
                <div data-el="image" data-x="50%" data-y="15%" data-w="45%" data-h="70%"
                     data-src="https://placehold.co/800x1000/1a1a2e/666?text=Image+111"
                     data-mask="fade-left" data-fit="cover" data-radius="12"></div>

                <!-- 左侧内容 -->
                <div data-el="text" data-x="8%" data-y="25%" data-w="45%" data-font="14" data-color="#38BDF8" data-bold="true" data-letter-spacing="2">FUTURE VISION</div>
                <div data-el="text" data-x="8%" data-y="32%" data-w="50%" data-font="48" data-color="#F8FAFC" data-bold="true" data-line-height="1.1">
                    Design Without Boundaries
                </div>
                <div data-el="text" data-x="8%" data-y="55%" data-w="40%" data-font="16" data-color="#94A3B8" data-line-height="1.6">
                    Experience the next generation of presentation design.
                </div>

                <!-- 按钮/CTA -->
                <div data-el="shape" data-shape="rect" data-x="8%" data-y="75%" data-w="16%" data-h="8%" data-fill="#38BDF8" data-radius="6"></div>
                <div data-el="text" data-x="8%" data-y="77%" data-w="16%" data-font="14" data-color="#0F172A" data-bold="true" data-align="center">Get Started</div>
                
                <div data-el="shape" data-shape="rect" data-x="26%" data-y="75%" data-w="16%" data-h="8%" data-fill="transparent" data-stroke="#475569" data-radius="6"></div>
                <div data-el="text" data-x="26%" data-y="77%" data-w="16%" data-font="14" data-color="#E2E8F0" data-align="center">Learn More</div>
            </section>

            <!-- Complex Example 2: Data Visualization (Fintech) -->
            <section data-type="freeform" id="slide-complex-data" data-bg="#111827">
                <!-- 顶部标题栏 -->
                <div data-el="text" data-x="5%" data-y="8%" data-w="50%" data-font="24" data-color="#F9FAFB" data-bold="true">Market Analytics</div>
                <div data-el="text" data-x="5%" data-y="14%" data-w="50%" data-font="14" data-color="#9CA3AF">Q4 Performance Overview</div>
                
                <div data-el="shape" data-shape="rect" data-x="85%" data-y="8%" data-w="10%" data-h="6%" data-fill="#1F2937" data-radius="4" data-stroke="#374151"></div>
                <div data-el="text" data-x="85%" data-y="9.5%" data-w="10%" data-font="12" data-color="#D1D5DB" data-align="center">Export</div>

                <!-- 卡片 1: 总览 -->
                <div data-el="shape" data-shape="rect" data-x="5%" data-y="22%" data-w="28%" data-h="24%" data-fill="#1F2937" data-radius="12" data-stroke="#374151"></div>
                <div data-el="icon" data-x="7%" data-y="24%" data-icon="carbon:chart-line" data-size="24" data-color="#10B981"></div>
                <div data-el="text" data-x="7%" data-y="31%" data-font="12" data-color="#9CA3AF">Total Revenue</div>
                <div data-el="text" data-x="7%" data-y="35%" data-font="28" data-color="#F9FAFB" data-bold="true">$2.4M</div>
                <div data-el="text" data-x="22%" data-y="36%" data-font="12" data-color="#10B981" data-bg="#064E3B" data-padding="2 6" data-radius="4">+12.5%</div>

                <!-- 卡片 2: 用户 -->
                <div data-el="shape" data-shape="rect" data-x="36%" data-y="22%" data-w="28%" data-h="24%" data-fill="#1F2937" data-radius="12" data-stroke="#374151"></div>
                <div data-el="icon" data-x="38%" data-y="24%" data-icon="carbon:user-multiple" data-size="24" data-color="#6366F1"></div>
                <div data-el="text" data-x="38%" data-y="31%" data-font="12" data-color="#9CA3AF">Active Users</div>
                <div data-el="text" data-x="38%" data-y="35%" data-font="28" data-color="#F9FAFB" data-bold="true">85.2K</div>
                <div data-el="text" data-x="53%" data-y="36%" data-font="12" data-color="#6366F1" data-bg="#312E81" data-padding="2 6" data-radius="4">+5.2%</div>

                <!-- 卡片 3: 转化 -->
                <div data-el="shape" data-shape="rect" data-x="67%" data-y="22%" data-w="28%" data-h="24%" data-fill="#1F2937" data-radius="12" data-stroke="#374151"></div>
                <div data-el="icon" data-x="69%" data-y="24%" data-icon="carbon:flash" data-size="24" data-color="#F59E0B"></div>
                <div data-el="text" data-x="69%" data-y="31%" data-font="12" data-color="#9CA3AF">Conversion</div>
                <div data-el="text" data-x="69%" data-y="35%" data-font="28" data-color="#F9FAFB" data-bold="true">3.8%</div>
                <div data-el="text" data-x="84%" data-y="36%" data-font="12" data-color="#EF4444" data-bg="#7F1D1D" data-padding="2 6" data-radius="4">-1.1%</div>

                <!-- 主图表区域 -->
                <div data-el="shape" data-shape="rect" data-x="5%" data-y="50%" data-w="90%" data-h="45%" data-fill="#1F2937" data-radius="12" data-stroke="#374151"></div>
                <div data-el="text" data-x="8%" data-y="55%" data-font="16" data-color="#F9FAFB" data-bold="true">Revenue Growth</div>
                
                <!-- 模拟图表 -->
                <div data-el="image" data-x="8%" data-y="58%" data-w="84%" data-h="35%"
                     data-src="https://quickchart.io/chart?c={type:'line',data:{labels:['Jan','Feb','Mar','Apr','May','Jun'],datasets:[{label:'2024',data:[120,132,101,134,190,230],borderColor:'rgb(99,102,241)',backgroundColor:'rgba(99,102,241,0.1)',fill:true}]},options:{legend:{display:false}}}&w=800&h=300"
                     data-fit="contain"></div>
            </section>

            <!-- Complex Example 3: Magazine Style Layout - 简化版 -->
            <section data-type="freeform" id="slide-complex-magazine" data-bg="#F3F4F6">
                <!-- 左侧大图 -->
                <div data-el="image" data-x="5%" data-y="5%" data-w="40%" data-h="90%"
                     data-src="https://placehold.co/600x1200/1a1a2e/666?text=Image+112"
                     data-fit="cover"></div>

                <!-- 右侧内容 -->
                <div data-el="text" data-x="50%" data-y="10%" data-w="45%" data-font="12" data-color="#EF4444" data-bold="true" data-letter-spacing="2">FEATURED STORY</div>
                <div data-el="text" data-x="50%" data-y="15%" data-w="45%" data-font="48" data-color="#111827" data-bold="true" data-line-height="1.1">
                    The Art of Minimalism
                </div>
                
                <div data-el="line" data-x1="50%" data-y1="33%" data-x2="60%" data-y2="33%" data-stroke="#111827" data-stroke-width="4"></div>
                
                <div data-el="text" data-x="50%" data-y="38%" data-w="45%" data-font="16" data-color="#374151" data-line-height="1.6">
                    "Less is more" is not just a phrase, it's a philosophy. By stripping away the unnecessary, we reveal the essential.
                </div>

                <!-- 底部小图组（移除 grayscale filter） -->
                <div data-el="image" data-x="50%" data-y="60%" data-w="20%" data-h="30%"
                     data-src="https://placehold.co/400x400/1a1a2e/666?text=Image+113"
                     data-fit="cover"></div>
                     
                <div data-el="image" data-x="72%" data-y="60%" data-w="23%" data-h="30%"
                     data-src="https://placehold.co/400x400/1a1a2e/666?text=Image+114"
                     data-fit="cover"></div>
            </section>

            <!-- Complex Example 4: Product Showcase - 简化版 -->
            <section data-type="freeform" id="slide-complex-product" data-bg="#000000">
                <!-- 聚光灯效果（使用透明度代替 blur） -->
                <div data-el="shape" data-shape="circle" data-x="25%" data-y="5%" data-w="50%" data-h="60%" data-fill="#FFFFFF" data-opacity="0.05"></div>
                
                <!-- 产品标题 -->
                <div data-el="text" data-x="0%" data-y="15%" data-w="100%" data-font="16" data-color="#71717A" data-align="center" data-letter-spacing="4">INTRODUCING</div>
                <div data-el="text" data-x="0%" data-y="22%" data-w="100%" data-font="56" data-color="#FFFFFF" data-bold="true" data-align="center">Lumina X</div>
                
                <!-- 产品主图（移除 drop-shadow filter） -->
                <div data-el="image" data-x="25%" data-y="35%" data-w="50%" data-h="40%"
                     data-src="https://placehold.co/800x600/1a1a2e/666?text=Image+115"
                     data-fit="contain"></div>

                <!-- 底部参数 -->
                <div data-el="shape" data-shape="rect" data-x="20%" data-y="82%" data-w="60%" data-h="12%" data-fill="#18181B" data-radius="100" data-stroke="#27272A"></div>
                
                <div data-el="text" data-x="23%" data-y="86%" data-w="17%" data-font="14" data-color="#FFFFFF" data-align="center" data-bold="true">5G Ready</div>
                <div data-el="text" data-x="42%" data-y="86%" data-w="17%" data-font="14" data-color="#FFFFFF" data-align="center" data-bold="true">8K Video</div>
                <div data-el="text" data-x="60%" data-y="86%" data-w="17%" data-font="14" data-color="#FFFFFF" data-align="center" data-bold="true">All Day Battery</div>
            </section>

            <!-- Vectorization Test 1: Tank (像素画) -->
            <section data-type="freeform" id="slide-vector-1" data-bg="#0F172A">
                <div data-el="text" data-x="5%" data-y="5%" data-w="90%" data-font="24" data-color="#F8FAFC" data-bold="true">矢量化测试 1/10 - 像素画</div>
                <div data-el="text" data-x="5%" data-y="11%" data-w="90%" data-font="12" data-color="#64748B">右键图片 → 智能编辑图片 → 转为矢量</div>
                <div data-el="image" data-x="10%" data-y="18%" data-w="80%" data-h="70%" data-src="samples/tank-unit-preview.png" data-fit="contain" data-radius="8"></div>
                <div data-el="text" data-x="5%" data-y="92%" data-w="90%" data-font="11" data-color="#94A3B8" data-align="center">tank-unit-preview.png | 预期: 颜色完整无破洞</div>
            </section>

            <!-- Vectorization Test 2: Weibo (图标) -->
            <section data-type="freeform" id="slide-vector-2" data-bg="#0F172A">
                <div data-el="text" data-x="5%" data-y="5%" data-w="90%" data-font="24" data-color="#F8FAFC" data-bold="true">矢量化测试 2/10 - 图标</div>
                <div data-el="text" data-x="5%" data-y="11%" data-w="90%" data-font="12" data-color="#64748B">右键图片 → 智能编辑图片 → 转为矢量</div>
                <div data-el="image" data-x="10%" data-y="18%" data-w="80%" data-h="70%" data-src="samples/weibo.png" data-fit="contain" data-radius="8"></div>
                <div data-el="text" data-x="5%" data-y="92%" data-w="90%" data-font="11" data-color="#94A3B8" data-align="center">weibo.png | 预期: 边缘锐利、曲线平滑</div>
            </section>

            <!-- Vectorization Test 3: Vectorstock (插画) -->
            <section data-type="freeform" id="slide-vector-3" data-bg="#0F172A">
                <div data-el="text" data-x="5%" data-y="5%" data-w="90%" data-font="24" data-color="#F8FAFC" data-bold="true">矢量化测试 3/10 - 插画</div>
                <div data-el="text" data-x="5%" data-y="11%" data-w="90%" data-font="12" data-color="#64748B">右键图片 → 智能编辑图片 → 转为矢量</div>
                <div data-el="image" data-x="10%" data-y="18%" data-w="80%" data-h="70%" data-src="samples/vectorstock_31191940.png" data-fit="contain" data-radius="8"></div>
                <div data-el="text" data-x="5%" data-y="92%" data-w="90%" data-font="11" data-color="#94A3B8" data-align="center">vectorstock_31191940.png | 预期: 颜色分层清晰</div>
            </section>

            <!-- Vectorization Test 4: K1 (手绘) -->
            <section data-type="freeform" id="slide-vector-4" data-bg="#0F172A">
                <div data-el="text" data-x="5%" data-y="5%" data-w="90%" data-font="24" data-color="#F8FAFC" data-bold="true">矢量化测试 4/10 - 手绘</div>
                <div data-el="text" data-x="5%" data-y="11%" data-w="90%" data-font="12" data-color="#64748B">右键图片 → 智能编辑图片 → 转为矢量</div>
                <div data-el="image" data-x="10%" data-y="18%" data-w="80%" data-h="70%" data-src="samples/K1_drawing.jpg" data-fit="contain" data-radius="8"></div>
                <div data-el="text" data-x="5%" data-y="92%" data-w="90%" data-font="11" data-color="#94A3B8" data-align="center">K1_drawing.jpg | 预期: 线条流畅</div>
            </section>

            <!-- Vectorization Test 5: Gum Tree (矢量风) -->
            <section data-type="freeform" id="slide-vector-5" data-bg="#0F172A">
                <div data-el="text" data-x="5%" data-y="5%" data-w="90%" data-font="24" data-color="#F8FAFC" data-bold="true">矢量化测试 5/10 - 矢量风格</div>
                <div data-el="text" data-x="5%" data-y="11%" data-w="90%" data-font="12" data-color="#64748B">右键图片 → 智能编辑图片 → 转为矢量</div>
                <div data-el="image" data-x="10%" data-y="18%" data-w="80%" data-h="70%" data-src="samples/Gum Tree Vector.jpg" data-fit="contain" data-radius="8"></div>
                <div data-el="text" data-x="5%" data-y="92%" data-w="90%" data-font="11" data-color="#94A3B8" data-align="center">Gum Tree Vector.jpg | 预期: 保持矢量感</div>
            </section>

            <!-- Vectorization Test 6: Cityscape (风景) -->
            <section data-type="freeform" id="slide-vector-6" data-bg="#0F172A">
                <div data-el="text" data-x="5%" data-y="5%" data-w="90%" data-font="24" data-color="#F8FAFC" data-bold="true">矢量化测试 6/10 - 风景</div>
                <div data-el="text" data-x="5%" data-y="11%" data-w="90%" data-font="12" data-color="#64748B">右键图片 → 智能编辑图片 → 转为矢量</div>
                <div data-el="image" data-x="10%" data-y="18%" data-w="80%" data-h="70%" data-src="samples/Cityscape Sunset_DFM3-01.jpg" data-fit="contain" data-radius="8"></div>
                <div data-el="text" data-x="5%" data-y="92%" data-w="90%" data-font="11" data-color="#94A3B8" data-align="center">Cityscape Sunset.jpg | 预期: 色块分明</div>
            </section>

            <!-- Vectorization Test 7: Portrait (照片) -->
            <section data-type="freeform" id="slide-vector-7" data-bg="#0F172A">
                <div data-el="text" data-x="5%" data-y="5%" data-w="90%" data-font="24" data-color="#F8FAFC" data-bold="true">矢量化测试 7/10 - 照片</div>
                <div data-el="text" data-x="5%" data-y="11%" data-w="90%" data-font="12" data-color="#64748B">右键图片 → 智能编辑图片 → 转为矢量</div>
                <div data-el="image" data-x="10%" data-y="18%" data-w="80%" data-h="70%" data-src="samples/angel-luciano-LATYeZyw88c-unsplash-s.jpg" data-fit="contain" data-radius="8"></div>
                <div data-el="text" data-x="5%" data-y="92%" data-w="90%" data-font="11" data-color="#94A3B8" data-align="center">Portrait.jpg | 注意: 照片效果一般，仅供参考</div>
            </section>

            <!-- Vectorization Test 8: test1 (VTracer 测试) -->
            <section data-type="freeform" id="slide-vector-8" data-bg="#0F172A">
                <div data-el="text" data-x="5%" data-y="5%" data-w="90%" data-font="24" data-color="#F8FAFC" data-bold="true">矢量化测试 8/10 - VTracer Test1</div>
                <div data-el="text" data-x="5%" data-y="11%" data-w="90%" data-font="12" data-color="#64748B">右键图片 → 智能编辑图片 → 转为矢量</div>
                <div data-el="image" data-x="10%" data-y="18%" data-w="80%" data-h="70%" data-src="samples/test1.png" data-fit="contain" data-radius="8"></div>
                <div data-el="text" data-x="5%" data-y="92%" data-w="90%" data-font="11" data-color="#94A3B8" data-align="center">test1.png | 预期: 边缘平滑、无杂点</div>
            </section>

            <!-- Vectorization Test 9: test2 (VTracer 测试) -->
            <section data-type="freeform" id="slide-vector-9" data-bg="#0F172A">
                <div data-el="text" data-x="5%" data-y="5%" data-w="90%" data-font="24" data-color="#F8FAFC" data-bold="true">矢量化测试 9/10 - VTracer Test2</div>
                <div data-el="text" data-x="5%" data-y="11%" data-w="90%" data-font="12" data-color="#64748B">右键图片 → 智能编辑图片 → 转为矢量</div>
                <div data-el="image" data-x="10%" data-y="18%" data-w="80%" data-h="70%" data-src="samples/test2.png" data-fit="contain" data-radius="8"></div>
                <div data-el="text" data-x="5%" data-y="92%" data-w="90%" data-font="11" data-color="#94A3B8" data-align="center">test2.png | 预期: 细节保留、曲线流畅</div>
            </section>

            <!-- Vectorization Test 10: duola (OCR 文字识别测试) -->
            <section data-type="freeform" id="slide-vector-10" data-bg="#0F172A">
                <div data-el="text" data-x="5%" data-y="5%" data-w="90%" data-font="24" data-color="#F8FAFC" data-bold="true">矢量化测试 10/10 - OCR 文字识别</div>
                <div data-el="text" data-x="5%" data-y="11%" data-w="90%" data-font="12" data-color="#64748B">右键图片 → 智能编辑图片 → 文字识别 / 矢量化</div>
                <div data-el="image" data-x="5%" data-y="18%" data-w="90%" data-h="70%" data-src="samples/duola.png" data-fit="contain" data-radius="8"></div>
                <div data-el="text" data-x="5%" data-y="92%" data-w="90%" data-font="11" data-color="#94A3B8" data-align="center">duola.png | 预期: OCR 识别中文、去除文字、矢量化</div>
            </section>
        
`;

window.PPT_SAMPLE_HTML = PPT_SAMPLE_HTML;


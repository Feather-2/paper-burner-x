/**
 * PPT Generation Controller (v5.0 - Multi-Agent Command Center)
 * 
 * Implements a complex, multi-agent workflow for PPT generation:
 * 1. Multi-Agent Orchestration (Reader, Analyst, Designer, Reviewer)
 * 2. Parallel Source Processing
 * 3. Real-time Visualization of Agent Activities
 */

class PPTGenerator {
    constructor() {
        this.overlayId = 'pptGeneratorOverlay';
        this.isVisible = false;
        this.currentProject = null;
        
        // Agent State
        this.agents = {
            reader: { status: 'idle', activity: 'Waiting...' },
            analyst: { status: 'idle', activity: 'Waiting...' },
            designer: { status: 'idle', activity: 'Waiting...' },
            reviewer: { status: 'idle', activity: 'Waiting...' }
        };

        // Workflow Data
        this.workflowData = {
            files: [],
            projectSummary: '',
            questions: [],
            userAnswers: {},
            outline: [], // Mind map structure
            script: [], // { id, content, sourceRef }
            segments: [], // { slideId, scriptIds, layout, visual }
            designDecisions: []
        };

        this.processLogs = [];
        this.todos = [];
        
        this.isTodoListExpanded = true;
        
        // DOM Elements
        this.elements = {
            overlay: null,
            container: null
        };

        // Presentation State
        this.currentSlideIndex = 0;
        this.viewMode = 'slide'; // 'slide' or 'outline'

        // 示例 HTML - AI 会输出类似这样的结构 (支持 freeform 自由布局)
        this.sampleHTML = `
            <!-- 1. 封面页：Quantum Leap -->
            <section data-type="freeform" id="slide-1" data-gradient="linear-gradient(135deg, #020617 0%, #0F172A 100%)">
                <!-- Background Accents -->
                <div data-el="shape" data-shape="circle" data-x="50%" data-y="-20%" data-w="80%" data-h="140%" data-fill="#06B6D4" data-opacity="0.05" data-blur="100"></div>
                <div data-el="shape" data-shape="circle" data-x="-10%" data-y="50%" data-w="50%" data-h="80%" data-fill="#8B5CF6" data-opacity="0.05" data-blur="80"></div>
                
                <!-- Main Content -->
                <div data-el="text" data-x="8%" data-y="35%" data-w="80%" data-h="auto" data-font="72" data-color="#F8FAFC" data-bold="true" data-spacing="2" data-shadow="0 0 20px rgba(6,182,212,0.3)">QUANTUM<br><span style="color: #22D3EE">LEAP</span></div>
                <div data-el="line" data-x1="8%" data-y1="65%" data-x2="18%" data-y2="65%" data-stroke="#22D3EE" data-stroke-width="4"></div>
                <div data-el="text" data-x="8%" data-y="70%" data-w="60%" data-h="auto" data-font="24" data-color="#94A3B8" data-spacing="1">Unlocking the Universe's Compute Power</div>
                
                <!-- Footer Info -->
                <div data-el="text" data-x="8%" data-y="88%" data-w="40%" data-h="auto" data-font="14" data-color="#64748B">Paper Burner Research · 2025</div>
            </section>

            <!-- 2. 议程页 -->
            <section data-type="freeform" id="slide-2" data-bg="#0F172A">
                <div data-el="text" data-x="5%" data-y="8%" data-w="40%" data-h="auto" data-font="36" data-color="#F8FAFC" data-bold="true">Agenda</div>
                
                <div data-el="shape" data-shape="rect" data-x="5%" data-y="25%" data-w="28%" data-h="30%" data-fill="#1E293B" data-radius="8" data-border="#334155"></div>
                <div data-el="text" data-x="7%" data-y="28%" data-w="24%" data-h="auto" data-font="20" data-color="#22D3EE" data-bold="true">01. Foundations</div>
                <div data-el="text" data-x="7%" data-y="38%" data-w="24%" data-h="auto" data-font="14" data-color="#94A3B8">Bit vs Qubit, Superposition, Entanglement</div>

                <div data-el="shape" data-shape="rect" data-x="36%" data-y="25%" data-w="28%" data-h="30%" data-fill="#1E293B" data-radius="8" data-border="#334155"></div>
                <div data-el="text" data-x="38%" data-y="28%" data-w="24%" data-h="auto" data-font="20" data-color="#818CF8" data-bold="true">02. Algorithms</div>
                <div data-el="text" data-x="38%" data-y="38%" data-w="24%" data-h="auto" data-font="14" data-color="#94A3B8">Shor's, Grover's, and Exponential Speedup</div>

                <div data-el="shape" data-shape="rect" data-x="67%" data-y="25%" data-w="28%" data-h="30%" data-fill="#1E293B" data-radius="8" data-border="#334155"></div>
                <div data-el="text" data-x="69%" data-y="28%" data-w="24%" data-h="auto" data-font="20" data-color="#F472B6" data-bold="true">03. Hardware</div>
                <div data-el="text" data-x="69%" data-y="38%" data-w="24%" data-h="auto" data-font="14" data-color="#94A3B8">Superconducting, Trapped Ions, Photonics</div>

                <div data-el="shape" data-shape="rect" data-x="5%" data-y="60%" data-w="28%" data-h="30%" data-fill="#1E293B" data-radius="8" data-border="#334155"></div>
                <div data-el="text" data-x="7%" data-y="63%" data-w="24%" data-h="auto" data-font="20" data-color="#34D399" data-bold="true">04. Applications</div>
                <div data-el="text" data-x="7%" data-y="73%" data-w="24%" data-h="auto" data-font="14" data-color="#94A3B8">Cryptography, Drug Discovery, Optimization</div>

                <div data-el="shape" data-shape="rect" data-x="36%" data-y="60%" data-w="28%" data-h="30%" data-fill="#1E293B" data-radius="8" data-border="#334155"></div>
                <div data-el="text" data-x="38%" data-y="63%" data-w="24%" data-h="auto" data-font="20" data-color="#FBBF24" data-bold="true">05. Challenges</div>
                <div data-el="text" data-x="38%" data-y="73%" data-w="24%" data-h="auto" data-font="14" data-color="#94A3B8">Decoherence, Error Correction</div>

                <div data-el="shape" data-shape="rect" data-x="67%" data-y="60%" data-w="28%" data-h="30%" data-fill="#1E293B" data-radius="8" data-border="#334155"></div>
                <div data-el="text" data-x="69%" data-y="63%" data-w="24%" data-h="auto" data-font="20" data-color="#A78BFA" data-bold="true">06. Roadmap</div>
                <div data-el="text" data-x="69%" data-y="73%" data-w="24%" data-h="auto" data-font="14" data-color="#94A3B8">Path to Fault Tolerance</div>
            </section>

            <!-- 3. Bit vs Qubit -->
            <section data-type="freeform" id="slide-3" data-bg="#0F172A">
                <div data-el="text" data-x="5%" data-y="8%" data-w="90%" data-h="auto" data-font="28" data-color="#F8FAFC" data-bold="true">The Fundamental Shift</div>
                
                <!-- Classical Bit -->
                <div data-el="text" data-x="15%" data-y="25%" data-w="30%" data-h="auto" data-font="24" data-color="#94A3B8" data-align="center">Classical Bit</div>
                <div data-el="shape" data-shape="circle" data-x="25%" data-y="35%" data-w="10%" data-h="18%" data-fill="#334155" data-stroke="#475569"></div>
                <div data-el="text" data-x="25%" data-y="42%" data-w="10%" data-h="auto" data-font="32" data-color="#FFFFFF" data-align="center" data-bold="true">0</div>
                <div data-el="text" data-x="15%" data-y="60%" data-w="30%" data-h="auto" data-font="16" data-color="#64748B" data-align="center">Deterministic<br>0 or 1</div>

                <!-- Divider -->
                <div data-el="line" data-x1="50%" data-y1="25%" data-x2="50%" data-y2="75%" data-stroke="#334155" data-stroke-width="2" data-stroke-dash="4"></div>

                <!-- Qubit -->
                <div data-el="text" data-x="55%" data-y="25%" data-w="30%" data-h="auto" data-font="24" data-color="#22D3EE" data-align="center">Quantum Bit (Qubit)</div>
                <div data-el="image" data-x="60%" data-y="35%" data-w="20%" data-h="35%" data-src="https://placehold.co/400x400/1e293b/22d3ee?text=Bloch+Sphere" data-alt="Bloch Sphere"></div>
                <div data-el="text" data-x="55%" data-y="75%" data-w="30%" data-h="auto" data-font="16" data-color="#64748B" data-align="center">Probabilistic<br>Superposition of 0 and 1</div>
            </section>

            <!-- 4. Mathematical Foundation -->
            <section data-type="freeform" id="slide-4" data-bg="#0F172A">
                <div data-el="text" data-x="5%" data-y="8%" data-w="90%" data-h="auto" data-font="28" data-color="#F8FAFC" data-bold="true">Mathematical Representation</div>

                <div data-el="shape" data-shape="rect" data-x="10%" data-y="25%" data-w="80%" data-h="50%" data-fill="#1E293B" data-radius="12" data-border="#334155"></div>

                <div data-el="text" data-x="15%" data-y="35%" data-w="70%" data-h="auto" data-font="20" data-color="#94A3B8">The state of a qubit is a vector in a 2D complex vector space:</div>

                <!-- Formula using KaTeX -->
                <div data-el="formula" data-x="15%" data-y="45%" data-w="70%" data-h="15%" data-font="36" data-color="#22D3EE" data-latex="|\\psi\\rangle = \\alpha|0\\rangle + \\beta|1\\rangle"></div>

                <div data-el="text" data-x="15%" data-y="65%" data-w="70%" data-h="auto" data-font="16" data-color="#64748B" data-align="center">Where α and β are complex numbers satisfying:</div>
                <div data-el="formula" data-x="15%" data-y="72%" data-w="70%" data-h="10%" data-font="24" data-color="#F8FAFC" data-latex="|\\alpha|^2 + |\\beta|^2 = 1"></div>
            </section>

            <!-- 5. Entanglement -->
            <section data-type="freeform" id="slide-5" data-bg="#0F172A">
                <div data-el="text" data-x="5%" data-y="8%" data-w="90%" data-h="auto" data-font="28" data-color="#F8FAFC" data-bold="true">Quantum Entanglement</div>
                <div data-el="text" data-x="5%" data-y="15%" data-w="90%" data-h="auto" data-font="16" data-color="#94A3B8">"Spooky action at a distance" - Albert Einstein</div>

                <div data-el="shape" data-shape="circle" data-x="20%" data-y="40%" data-w="15%" data-h="25%" data-fill="#1E293B" data-stroke="#F472B6" data-stroke-width="2"></div>
                <div data-el="text" data-x="25%" data-y="50%" data-w="5%" data-h="auto" data-font="24" data-color="#F472B6" data-align="center">A</div>

                <div data-el="shape" data-shape="circle" data-x="65%" data-y="40%" data-w="15%" data-h="25%" data-fill="#1E293B" data-stroke="#F472B6" data-stroke-width="2"></div>
                <div data-el="text" data-x="70%" data-y="50%" data-w="5%" data-h="auto" data-font="24" data-color="#F472B6" data-align="center">B</div>

                <!-- Connection -->
                <div data-el="line" data-x1="35%" data-y1="52%" data-x2="65%" data-y2="52%" data-stroke="#F472B6" data-stroke-width="2" data-stroke-dash="4"></div>
                <div data-el="text" data-x="45%" data-y="48%" data-w="10%" data-h="auto" data-font="14" data-color="#F472B6" data-align="center">Entangled</div>

                <!-- Bell State Formula -->
                <div data-el="shape" data-shape="rect" data-x="30%" data-y="75%" data-w="40%" data-h="15%" data-fill="#1E293B" data-radius="8"></div>
                <div data-el="formula" data-x="30%" data-y="77%" data-w="40%" data-h="12%" data-font="24" data-color="#FFFFFF" data-latex="|\\Phi^+\\rangle = \\frac{|00\\rangle + |11\\rangle}{\\sqrt{2}}"></div>
            </section>

            <!-- 6. Algorithms -->
            <section data-type="freeform" id="slide-6" data-bg="#0F172A">
                <div data-el="text" data-x="5%" data-y="8%" data-w="90%" data-h="auto" data-font="28" data-color="#F8FAFC" data-bold="true">Shor's Algorithm</div>
                <div data-el="text" data-x="5%" data-y="15%" data-w="90%" data-h="auto" data-font="16" data-color="#94A3B8">Exponential speedup in integer factorization</div>

                <!-- Complexity Chart -->
                <div data-el="chart" data-x="5%" data-y="30%" data-w="45%" data-h="60%"
                     data-chart-type="line"
                     data-chart-data="Classical:2,4,8,16,32;Quantum:2,3,4,5,6"
                     data-colors="#64748B,#22D3EE"
                     data-labels="Input Size (N)"></div>

                <div data-el="text" data-x="55%" data-y="35%" data-w="40%" data-h="auto" data-font="20" data-color="#F8FAFC" data-bold="true">The Power of Period Finding</div>
                <div data-el="text" data-x="55%" data-y="45%" data-w="40%" data-h="auto" data-font="16" data-color="#94A3B8" data-line-height="1.6">
                    Shor's algorithm utilizes quantum Fourier transform to find the period of a function, breaking RSA encryption.
                </div>

                <div data-el="shape" data-shape="rect" data-x="55%" data-y="65%" data-w="40%" data-h="15%" data-fill="#1E293B" data-radius="8" data-border="#22D3EE"></div>
                <div data-el="formula" data-x="55%" data-y="68%" data-w="40%" data-h="10%" data-font="18" data-color="#22D3EE" data-latex="O((\\log N)^3) \\text{ vs } O(e^{N^{1/3}})"></div>
            </section>

            <!-- 7. Hardware -->
            <section data-type="freeform" id="slide-7" data-bg="#0F172A">
                <div data-el="text" data-x="5%" data-y="8%" data-w="90%" data-h="auto" data-font="28" data-color="#F8FAFC" data-bold="true">Inside the Chandelier</div>
                
                <div data-el="image" data-x="5%" data-y="20%" data-w="40%" data-h="70%" data-src="https://placehold.co/400x600/1e293b/e2e8f0?text=Cryostat+Image" data-alt="Dilution Refrigerator" data-radius="8"></div>
                
                <div data-el="text" data-x="50%" data-y="25%" data-w="45%" data-h="auto" data-font="20" data-color="#22D3EE" data-bold="true">Superconducting Qubits</div>
                <div data-el="text" data-x="50%" data-y="32%" data-w="45%" data-h="auto" data-font="16" data-color="#94A3B8" data-line-height="1.6">
                    Operates at near absolute zero (15mK). Uses Josephson junctions to create artificial atoms.
                </div>

                <div data-el="line" data-x1="50%" data-y1="50%" data-x2="90%" data-y2="50%" data-stroke="#334155" data-stroke-width="1"></div>

                <div data-el="text" data-x="50%" data-y="55%" data-w="45%" data-h="auto" data-font="20" data-color="#A78BFA" data-bold="true">Trapped Ions</div>
                <div data-el="text" data-x="50%" data-y="62%" data-w="45%" data-h="auto" data-font="16" data-color="#94A3B8" data-line-height="1.6">
                    Uses electromagnetic fields to trap individual ions. High coherence times but slower gate speeds.
                </div>
            </section>

            <!-- 8. Applications -->
            <section data-type="freeform" id="slide-8" data-bg="#0F172A">
                <div data-el="text" data-x="5%" data-y="8%" data-w="90%" data-h="auto" data-font="28" data-color="#F8FAFC" data-bold="true">Key Applications</div>
                
                <!-- Card 1 -->
                <div data-el="shape" data-shape="rect" data-x="5%" data-y="25%" data-w="28%" data-h="60%" data-fill="#1E293B" data-radius="8"></div>
                <div data-el="image" data-x="5%" data-y="25%" data-w="28%" data-h="25%" data-src="https://placehold.co/300x200/1e293b/34d399?text=Molecule" data-radius="8 8 0 0"></div>
                <div data-el="text" data-x="7%" data-y="55%" data-w="24%" data-h="auto" data-font="18" data-color="#34D399" data-bold="true">Drug Discovery</div>
                <div data-el="text" data-x="7%" data-y="65%" data-w="24%" data-h="auto" data-font="14" data-color="#94A3B8">Simulating molecular interactions accurately for new pharma.</div>

                <!-- Card 2 -->
                <div data-el="shape" data-shape="rect" data-x="36%" data-y="25%" data-w="28%" data-h="60%" data-fill="#1E293B" data-radius="8"></div>
                <div data-el="image" data-x="36%" data-y="25%" data-w="28%" data-h="25%" data-src="https://placehold.co/300x200/1e293b/f472b6?text=Security" data-radius="8 8 0 0"></div>
                <div data-el="text" data-x="38%" data-y="55%" data-w="24%" data-h="auto" data-font="18" data-color="#F472B6" data-bold="true">Cryptography</div>
                <div data-el="text" data-x="38%" data-y="65%" data-w="24%" data-h="auto" data-font="14" data-color="#94A3B8">Post-quantum cryptography and breaking legacy encryption.</div>

                <!-- Card 3 -->
                <div data-el="shape" data-shape="rect" data-x="67%" data-y="25%" data-w="28%" data-h="60%" data-fill="#1E293B" data-radius="8"></div>
                <div data-el="image" data-x="67%" data-y="25%" data-w="28%" data-h="25%" data-src="https://placehold.co/300x200/1e293b/fbbf24?text=Logistics" data-radius="8 8 0 0"></div>
                <div data-el="text" data-x="69%" data-y="55%" data-w="24%" data-h="auto" data-font="18" data-color="#FBBF24" data-bold="true">Optimization</div>
                <div data-el="text" data-x="69%" data-y="65%" data-w="24%" data-h="auto" data-font="14" data-color="#94A3B8">Solving traveling salesman and portfolio optimization problems.</div>
            </section>

            <!-- 9. Market Growth -->
            <section data-type="freeform" id="slide-9" data-bg="#FFFFFF">
                <div data-el="text" data-x="5%" data-y="8%" data-w="90%" data-h="auto" data-font="28" data-color="#0F172A" data-bold="true">Investment Landscape</div>
                
                <div data-el="chart" data-x="5%" data-y="25%" data-w="90%" data-h="60%"
                     data-chart-type="line"
                     data-chart-data="2020:0.7,2021:1.4,2022:2.3,2023:3.8,2024:5.2,2025:8.5"
                     data-colors="#06B6D4"
                     data-labels="Billion USD"></div>
                
                <div data-el="shape" data-shape="rounded" data-x="70%" data-y="30%" data-w="20%" data-h="15%" data-fill="#ECFEFF" data-radius="8" data-border="#06B6D4"></div>
                <div data-el="text" data-x="72%" data-y="35%" data-w="16%" data-h="auto" data-font="24" data-color="#0891B2" data-bold="true">$8.5B</div>
                <div data-el="text" data-x="72%" data-y="42%" data-w="16%" data-h="auto" data-font="14" data-color="#155E75">Projected 2025</div>
            </section>

            <!-- 10. Challenges -->
            <section data-type="freeform" id="slide-10" data-bg="#0F172A">
                <div data-el="text" data-x="5%" data-y="8%" data-w="90%" data-h="auto" data-font="28" data-color="#F8FAFC" data-bold="true">The Decoherence Problem</div>

                <div data-el="shape" data-shape="rect" data-x="10%" data-y="25%" data-w="35%" data-h="60%" data-fill="#1E293B" data-radius="8"></div>
                <div data-el="text" data-x="12%" data-y="30%" data-w="31%" data-h="auto" data-font="20" data-color="#F87171" data-bold="true">Noise & Errors</div>
                <div data-el="text" data-x="12%" data-y="40%" data-w="31%" data-h="auto" data-font="16" data-color="#94A3B8" data-line-height="1.6">
                    Quantum states are fragile. Interaction with the environment causes information loss (decoherence).
                </div>
                <div data-el="formula" data-x="12%" data-y="65%" data-w="31%" data-h="10%" data-font="18" data-color="#FFFFFF" data-latex="T_1 \\text{ (Relaxation) and } T_2 \\text{ (Dephasing)}"></div>

                <div data-el="shape" data-shape="rect" data-x="55%" data-y="25%" data-w="35%" data-h="60%" data-fill="#1E293B" data-radius="8"></div>
                <div data-el="text" data-x="57%" data-y="30%" data-w="31%" data-h="auto" data-font="20" data-color="#34D399" data-bold="true">Error Correction</div>
                <div data-el="text" data-x="57%" data-y="40%" data-w="31%" data-h="auto" data-font="16" data-color="#94A3B8" data-line-height="1.6">
                    Using multiple physical qubits to form one logical qubit.
                </div>
                <div data-el="formula" data-x="57%" data-y="65%" data-w="31%" data-h="10%" data-font="18" data-color="#FFFFFF" data-latex="\\text{Threshold: } p < p_{th}"></div>
            </section>

            <!-- 11. Roadmap -->
            <section data-type="freeform" id="slide-11" data-bg="#0F172A">
                <div data-el="text" data-x="5%" data-y="8%" data-w="90%" data-h="auto" data-font="28" data-color="#F8FAFC" data-bold="true">Roadmap to Fault Tolerance</div>
                
                <div data-el="line" data-x1="10%" data-y1="50%" data-x2="90%" data-y2="50%" data-stroke="#334155" data-stroke-width="4"></div>

                <!-- 2023 -->
                <div data-el="shape" data-shape="circle" data-x="20%" data-y="50%" data-w="2%" data-h="3.5%" data-fill="#64748B"></div>
                <div data-el="text" data-x="18%" data-y="40%" data-w="10%" data-h="auto" data-font="16" data-color="#94A3B8" data-align="center">2023</div>
                <div data-el="text" data-x="15%" data-y="60%" data-w="12%" data-h="auto" data-font="14" data-color="#64748B" data-align="center">100+ Qubits<br>NISQ Era</div>

                <!-- 2025 -->
                <div data-el="shape" data-shape="circle" data-x="45%" data-y="50%" data-w="2%" data-h="3.5%" data-fill="#22D3EE"></div>
                <div data-el="text" data-x="43%" data-y="40%" data-w="10%" data-h="auto" data-font="16" data-color="#22D3EE" data-align="center">2025</div>
                <div data-el="text" data-x="40%" data-y="60%" data-w="12%" data-h="auto" data-font="14" data-color="#22D3EE" data-align="center">1,000+ Qubits<br>Error Mitigation</div>

                <!-- 2030 -->
                <div data-el="shape" data-shape="circle" data-x="70%" data-y="50%" data-w="2%" data-h="3.5%" data-fill="#8B5CF6"></div>
                <div data-el="text" data-x="68%" data-y="40%" data-w="10%" data-h="auto" data-font="16" data-color="#8B5CF6" data-align="center">2030</div>
                <div data-el="text" data-x="65%" data-y="60%" data-w="12%" data-h="auto" data-font="14" data-color="#8B5CF6" data-align="center">Logical Qubits<br>Fault Tolerance</div>
            </section>

            <!-- 12. 结束页 -->
            <section data-type="freeform" id="slide-12" data-gradient="linear-gradient(135deg, #020617 0%, #0F172A 100%)">
                <div data-el="text" data-x="0%" data-y="35%" data-w="100%" data-h="auto" data-font="48" data-color="#FFFFFF" data-bold="true" data-align="center">The Future is Quantum</div>
                <div data-el="text" data-x="0%" data-y="50%" data-w="100%" data-h="auto" data-font="18" data-color="#94A3B8" data-align="center">Prepare for the paradigm shift.</div>
                
                <div data-el="shape" data-shape="rounded" data-x="35%" data-y="65%" data-w="30%" data-h="12%" data-fill="#1E293B" data-opacity="0.8" data-radius="30" data-border="#334155"></div>
                <div data-el="icon" data-icon="carbon:email" data-x="38%" data-y="69%" data-size="20" data-color="#E2E8F0"></div>
                <div data-el="text" data-x="42%" data-y="69%" data-w="20%" data-h="auto" data-font="14" data-color="#E2E8F0">research@quantum.io</div>
                
                <div data-el="text" data-x="0%" data-y="90%" data-w="100%" data-h="auto" data-font="12" data-color="#475569" data-align="center">© 2025 Quantum Research Institute.</div>
            </section>
        `;

        // 使用 SlideParser 解析 HTML 生成 slides（如果 SlideSystem 可用）
        this.slides = this._initSlides();
    }

    _initSlides() {
        // 如果 SlideParser 可用，从 HTML 解析
        if (typeof SlideParser !== 'undefined') {
            try {
                const parsed = SlideParser.parse(this.sampleHTML);
                if (parsed && parsed.length > 0) {
                    console.log('SlideSystem: Parsed', parsed.length, 'slides from HTML');
                    return parsed;
                }
            } catch (e) {
                console.warn('SlideParser error, using fallback:', e);
            }
        }

        // Fallback: 直接使用 Schema 数据
        return [
            { title: "QUANTUM LEAP", subtitle: "Unlocking the Universe's Compute Power", type: "cover" },
            { title: "Agenda", items: ["Foundations", "Algorithms", "Hardware", "Applications", "Challenges", "Roadmap"], type: "toc" },
            { title: "The Fundamental Shift", type: "comparison", content: "Classical Bit (0/1) vs Qubit (Superposition)" },
            { title: "Mathematical Representation", type: "content", content: "|ψ⟩ = α|0⟩ + β|1⟩" },
            { title: "Quantum Entanglement", type: "diagram", content: "Spooky action at a distance: Bell State" },
            { title: "Shor's Algorithm", type: "chart", content: "Exponential speedup in factorization" },
            { title: "Inside the Chandelier", type: "image_text", content: "Superconducting Qubits & Trapped Ions" },
            { title: "Key Applications", type: "grid", content: "Drug Discovery, Cryptography, Optimization" },
            { title: "Investment Landscape", type: "chart", content: "Projected growth to $8.5B by 2025" },
            { title: "The Decoherence Problem", type: "content", content: "Noise, Errors, and the path to Correction" },
            { title: "Roadmap to Fault Tolerance", type: "timeline", content: "NISQ Era to Logical Qubits (2030)" },
            { title: "The Future is Quantum", subtitle: "Prepare for the paradigm shift.", email: "research@quantum.io", type: "end" }
        ];
    }

    init() {
        this.elements.overlay = document.getElementById(this.overlayId);
        if (!this.elements.overlay) return;
        
        this.elements.overlay.innerHTML = '';
        this._bindLaunchers();
        console.log('PPT Generator initialized (v5.0 Multi-Agent).');
    }

    _bindLaunchers() {
        const launchBtns = [
            document.getElementById('openPptGeneratorBtn'),
            document.getElementById('sidebarPptBtn')
        ].filter(Boolean);
        launchBtns.forEach(btn => btn.addEventListener('click', () => this.show()));
    }

    show() {
        if (this.elements.overlay) {
            this.elements.overlay.classList.remove('hidden');
            this.isVisible = true;
            this.showProjectList();
        }
    }

    hide() {
        if (this.elements.overlay) {
            this.elements.overlay.classList.add('hidden');
            this.isVisible = false;
            this.currentProject = null;
        }
    }

    // ============================================================
    // Navigation & Layout
    // ============================================================

    async showProjectList() {
        this.state = 'idle';
        this.currentProject = null;
        
        let projects = [];
        if (window.pptStorage) {
            projects = await window.pptStorage.loadProjects();
        }

        this.elements.overlay.innerHTML = `
            <div class="ppt-app-shell">
                <header class="ppt-header">
                    <div class="ppt-header-left">
                        <div class="ppt-logo">
                            <img src="public/pure.svg" alt="Logo" class="ppt-logo-img">
                            <span>智能演示文稿生成</span>
                        </div>
                    </div>
                    <div class="ppt-header-right">
                        <button class="ppt-icon-btn" onclick="window.PPTGenerator.hide()">
                            <iconify-icon icon="carbon:close"></iconify-icon>
                        </button>
                    </div>
                </header>
                <main class="ppt-project-list-view">
                    <div class="ppt-welcome-hero">
                        <div class="ppt-hero-logo">
                            <img src="public/pure.svg" alt="Logo">
                        </div>
                        <h1>智能演示文稿生成</h1>
                        <p>从文档到精美演示，只需一键。AI 驱动的专业 PPT 制作助手。</p>
                        <button class="ppt-btn-primary" onclick="window.PPTGenerator.createNewProject()">
                            <iconify-icon icon="carbon:add"></iconify-icon>
                            开始创作
                        </button>
                    </div>
                    <div class="ppt-project-grid">
                        ${projects.map(p => `
                            <div class="ppt-project-card" onclick="window.PPTGenerator.loadProject('${p.id}')">
                                <div class="ppt-card-icon">
                                    <iconify-icon icon="carbon:presentation-file"></iconify-icon>
                                </div>
                                <div class="ppt-card-info">
                                    <h3>${p.title || '未命名项目'}</h3>
                                    <span>${new Date(p.updatedAt).toLocaleDateString()}</span>
                                </div>
                                <button class="ppt-card-delete-btn" onclick="event.stopPropagation(); window.PPTGenerator.confirmDeleteProject('${p.id}')" title="删除项目">
                                    <iconify-icon icon="carbon:trash-can"></iconify-icon>
                                </button>
                            </div>
                        `).join('')}
                    </div>
                </main>
            </div>
        `;
    }

    async createNewProject() {
        const newProject = {
            id: crypto.randomUUID(),
            title: 'New Mission',
            status: 'idle',
            chatHistory: [],
            logs: [],
            todos: [],
            workflowData: {},
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        if (window.pptStorage) {
            await window.pptStorage.saveProject(newProject);
        }
        this.loadProject(newProject.id);
    }

    async loadProject(id) {
        if (window.pptStorage) {
            this.currentProject = await window.pptStorage.getProject(id);
        }
        this.processLogs = this.currentProject.logs || [];
        this.todos = this.currentProject.todos || [];
        
        // Ensure workflowData and its children are initialized
        this.workflowData = this.currentProject.workflowData || {};
        if (!this.workflowData.files) this.workflowData.files = [];
        if (!this.workflowData.questions) this.workflowData.questions = [];
        if (!this.workflowData.outline) this.workflowData.outline = [];

        this.state = this.currentProject.status || 'idle';
        this.enterWorkspace();
    }

    enterWorkspace() {
        this.renderWorkspaceLayout();
        this.renderChatSidebar();
        this.renderPreviewArea();
        
        if (this.state === 'idle' && this.processLogs.length === 0) {
            this.addChatMessage('ai', '智能助手就绪。请上传资料以开始生成演示文稿。');
        }
    }

    renderWorkspaceLayout() {
        this.elements.overlay.innerHTML = `
            <div class="ppt-app-shell">
                <header class="ppt-header">
                    <div class="ppt-header-left">
                        <div class="ppt-logo">
                            <img src="public/pure.svg" alt="Logo" class="ppt-logo-img">
                            <span>智能演示文稿生成</span>
                        </div>
                        <div class="ppt-project-title">${this.currentProject.title}</div>
                    </div>
                    <div class="ppt-header-right">
                        <button class="ppt-icon-btn" onclick="window.PPTGenerator.showProjectList()">
                            <iconify-icon icon="carbon:grid"></iconify-icon>
                        </button>
                        <button class="ppt-icon-btn" onclick="window.PPTGenerator.hide()">
                            <iconify-icon icon="carbon:close"></iconify-icon>
                        </button>
                    </div>
                </header>
                <div class="ppt-workspace">
                    <div class="ppt-preview-area" id="pptPreviewArea">
                        <!-- Dynamic Agent Dashboard -->
                    </div>
                    <div class="ppt-chat-sidebar">
                        <div class="ppt-todo-tracker" id="pptTodoTracker"></div>
                        <div class="ppt-chat-history" id="pptChatHistory"></div>
                        <div class="ppt-chat-input-area">
                            <div class="ppt-chat-input-wrapper">
                                <textarea id="pptChatInput" placeholder="输入您的指令或反馈..."></textarea>
                                <div class="ppt-chat-actions">
                                    <button class="ppt-btn-primary" id="pptSendBtn">
                                        <iconify-icon icon="carbon:send-alt"></iconify-icon> 发送
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.renderTodoList();
        this._bindChatEvents();
    }

    _bindChatEvents() {
        const input = document.getElementById('pptChatInput');
        const sendBtn = document.getElementById('pptSendBtn');

        const sendMessage = () => {
            const text = input.value.trim();
            if (!text) return;
            this.handleUserMessage(text);
            input.value = '';
        };

        sendBtn.addEventListener('click', sendMessage);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
    }

    // ============================================================
    // Agent Dashboard Rendering
    // ============================================================

    renderPreviewArea() {
        const container = document.getElementById('pptPreviewArea');
        if (!container) return;

        if (this.state === 'completed') {
            this.renderPresentationMode(container);
            return;
        }

        // Determine what to show in the central visualization area based on state
        let visContent = '';
        
        if (this.state === 'idle') {
            visContent = this._renderUploadView();
        } else if (this.state === 'questioning') {
            visContent = this._renderQuestionForm();
        } else if (this.state === 'outline_review') {
            visContent = this._renderOutlineReview();
        } else {
            // Default: Simplified Generation View
            visContent = `
                <div class="generation-container">
                    <!-- Progress Stepper -->
                    <div class="gen-stepper">
                        ${this._renderStep('reading', '1', '阅读')}
                        <div class="gen-step-line"></div>
                        ${this._renderStep('questioning', '2', '分析')}
                        <div class="gen-step-line"></div>
                        ${this._renderStep('outline_review', '3', '大纲')}
                        <div class="gen-step-line"></div>
                        ${this._renderStep('scripting', '4', '创作')}
                        <div class="gen-step-line"></div>
                        ${this._renderStep('designer', '5', '设计')}
                    </div>

                    <!-- Main Visualizer -->
                    <div class="gen-visualizer">
                        <div class="gen-status-icon">
                            <iconify-icon icon="${this._getCurrentStatusIcon()}"></iconify-icon>
                        </div>
                        <h2 class="gen-title">${this._getCurrentStatusTitle()}</h2>
                        <p class="gen-subtitle">${this._getCurrentStatusDesc()}</p>

                        <!-- File List (Only show during reading) -->
                        <div id="fileProcessingGrid" class="gen-file-list" style="display: ${this.state === 'reading' ? 'flex' : 'none'}">
                            <!-- Dynamic File Nodes -->
                        </div>

                        <!-- Minimal Log Ticker -->
                        <div class="gen-log-ticker" id="agentTerminal">
                            <!-- Logs go here -->
                        </div>
                    </div>
                </div>
            `;
        }

        // Render Simplified Dashboard (No more grid layout)
        container.innerHTML = visContent;
        
        // Restore logs if terminal exists
        const term = document.getElementById('agentTerminal');
        if (term) {
            this.processLogs.forEach(log => this._appendLogToTerminal(log));
        }
    }

    _renderUploadView() {
        const files = this.workflowData.files || [];
        const hasFiles = files.length > 0;
        
        return `
            <div class="generation-container">
                <div class="ppt-upload-zone" id="pptUploadZone">
                    <iconify-icon icon="carbon:cloud-upload" class="ppt-upload-icon"></iconify-icon>
                    <div class="ppt-upload-text">点击或拖拽上传文档</div>
                    <div class="ppt-upload-subtext">支持 PDF, DOCX, MD, TXT (最大 50MB)</div>
                    <input type="file" id="pptFileInput" class="ppt-file-input" multiple onchange="window.PPTGenerator.handleFileUpload(this.files)">
                </div>

                <div class="ppt-upload-actions">
                    <button class="ppt-upload-btn" onclick="window.PPTGenerator.openHistorySelector()">
                        <iconify-icon icon="carbon:time"></iconify-icon> 从历史项目选择
                    </button>
                    <button class="ppt-upload-btn" onclick="window.PPTGenerator.openUrlInput()">
                        <iconify-icon icon="carbon:link"></iconify-icon> 添加链接资源
                    </button>
                </div>

                ${hasFiles ? `
                    <div class="ppt-upload-list">
                        ${files.map((f, i) => `
                            <div class="ppt-upload-item">
                                <iconify-icon icon="${f.type === 'history' ? 'carbon:time' : 'carbon:document'}" class="ppt-upload-item-icon"></iconify-icon>
                                <div class="ppt-upload-item-info">
                                    <div class="ppt-upload-item-name">${f.name}</div>
                                    <div class="ppt-upload-item-meta">${f.size || 'History Project'}</div>
                                </div>
                                <iconify-icon icon="carbon:close" class="ppt-upload-item-remove" onclick="window.PPTGenerator.removeFile(${i})"></iconify-icon>
                            </div>
                        `).join('')}
                    </div>
                    <button class="ppt-btn-primary" style="margin-top: 24px; width: 100%; max-width: 600px; justify-content: center;" onclick="window.PPTGenerator.startMultiAgentWorkflow()">
                        开始分析 (${files.length} 个资源)
                    </button>
                ` : `
                    <div style="margin-top: 24px; text-align: center; color: var(--ppt-text-secondary); font-size: 13px;">
                        <p>AI 将自动分析文档结构、提取关键信息并生成演示大纲</p>
                    </div>
                `}
            </div>
        `;
    }

    openHistorySelector() {
        // Ensure files array exists
        if (!this.workflowData.files) this.workflowData.files = [];

        // Mock adding a history project
        this.workflowData.files.push({
            name: "Q3 财务报表分析 (History)",
            type: "history",
            size: "Project"
        });
        this.renderPreviewArea();
    }

    openUrlInput() {
        const url = prompt("请输入文章或文档链接:");
        if (url && url.trim()) {
            if (!this.workflowData.files) this.workflowData.files = [];
            this.workflowData.files.push({
                name: url,
                type: "link",
                size: "URL"
            });
            this.renderPreviewArea();
        }
    }

    removeFile(index) {
        this.workflowData.files.splice(index, 1);
        this.renderPreviewArea();
    }

    _renderQuestionForm() {
        const questions = this.workflowData.questions || [];
        return `
            <div class="ppt-question-form">
                <div class="form-header">
                    <h3><iconify-icon icon="carbon:user-speaker"></iconify-icon> 需求确认</h3>
                    <p>AI 已分析文档，请确认以下关键策略以定制演示文稿：</p>
                </div>
                <div class="form-body custom-scrollbar">
                    ${questions.map((q, i) => `
                        <div class="form-group">
                            <label>${i + 1}. ${q.text}</label>
                            <div class="form-options-wrapper">
                                <div class="form-radio-group">
                                    ${q.options.map(opt => `
                                        <label class="radio-option">
                                            <input type="radio" name="q_${i}" value="${opt}" ${opt === q.default ? 'checked' : ''}>
                                            <div class="radio-content">
                                                <span class="radio-label">${opt}</span>
                                                <iconify-icon icon="carbon:checkmark-filled" class="radio-check-icon"></iconify-icon>
                                            </div>
                                        </label>
                                    `).join('')}
                                </div>
                                <div class="form-custom-input-wrapper">
                                    <input type="text" class="ppt-input-field" placeholder="或输入自定义回答..." name="q_${i}_custom">
                                    <button class="ppt-icon-btn" title="咨询 AI 助手" onclick="window.PPTGenerator.askAssistantAboutQuestion(${i})">
                                        <iconify-icon icon="carbon:chat-bot"></iconify-icon>
                                    </button>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
                <div class="form-footer">
                    <div style="flex: 1; display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--ppt-text-secondary);">
                        <iconify-icon icon="carbon:information"></iconify-icon>
                        <span>您也可以在右侧聊天栏直接提出修改意见</span>
                    </div>
                    <button class="ppt-btn-secondary" onclick="window.PPTGenerator.autoFillAnswers()">
                        <iconify-icon icon="carbon:magic-wand"></iconify-icon> AI 自动决策
                    </button>
                    <button class="ppt-btn-primary" onclick="window.PPTGenerator.submitAnswers()">
                        确认并继续 <iconify-icon icon="carbon:arrow-right"></iconify-icon>
                    </button>
                </div>
            </div>
        `;
    }

    askAssistantAboutQuestion(index) {
        const question = this.workflowData.questions[index];
        this.addChatMessage('ai', `关于问题 **"${question.text}"**，根据文档分析，我建议选择 **"${question.default}"**，因为文档主要侧重于...`);
    }

    _renderOutlineReview() {
        // Mock outline data if not present or empty
        let outline = this.workflowData.outline;
        if (!outline || outline.length === 0) {
            outline = [
                { title: "项目背景与痛点", subs: ["当前文档处理效率低下", "非结构化数据提取困难"] },
                { title: "核心解决方案", subs: ["AI 深度阅读引擎", "多智能体协同架构"] },
                { title: "技术优势", subs: ["上下文语义理解", "跨文档知识融合"] },
                { title: "商业价值", subs: ["降低 80% 人力成本", "提升 40% 准确率"] }
            ];
            // Save the mock outline so edits are preserved
            this.workflowData.outline = outline;
        }

        const html = `
            <div class="ppt-question-form">
                <div class="form-header" style="padding-bottom: 16px; margin-bottom: 16px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <iconify-icon icon="carbon:tree-view-alt" style="font-size: 20px; color: var(--ppt-primary);"></iconify-icon>
                            <h3 style="margin: 0; font-size: 18px;">大纲确认</h3>
                            <span style="font-size: 13px; color: var(--ppt-text-muted);">请确认或调整</span>
                        </div>
                        <div style="display: flex; gap: 8px;">
                            <button class="ppt-btn-secondary" onclick="window.PPTGenerator.addOutlineItem()" style="font-size: 12px; padding: 6px 12px;">
                                <iconify-icon icon="carbon:add-alt"></iconify-icon> 添加章节
                            </button>
                            <button class="ppt-btn-secondary" onclick="window.PPTGenerator.toggleOutlineEditMode()" style="font-size: 12px; padding: 6px 12px;">
                                <iconify-icon icon="carbon:edit"></iconify-icon> Markdown
                            </button>
                        </div>
                    </div>
                </div>
                <div class="form-body custom-scrollbar">
                    
                    <div id="pptOutlineVisualEditor" class="ppt-outline-editor" style="padding-bottom: 100px;">
                        ${outline.map((item, i) => `
                            <div class="outline-node-card" draggable="true" ondragstart="window.PPTGenerator.handleDragStart(event, ${i})" ondragover="window.PPTGenerator.handleDragOver(event)" ondrop="window.PPTGenerator.handleDrop(event, ${i})" style="margin-bottom: 16px; padding: 16px; border: 1px solid var(--ppt-border); border-radius: 8px; position: relative; cursor: grab;">
                                <button class="ppt-icon-btn" onclick="window.PPTGenerator.removeOutlineItem(${i})" title="删除章节" style="position: absolute; top: 8px; right: 8px; width: 24px; height: 24px; padding: 4px; z-index: 10;">
                                    <iconify-icon icon="carbon:trash-can"></iconify-icon>
                                </button>
                                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px; padding-right: 30px;">
                                    <span style="font-weight: 600; color: var(--ppt-accent); cursor: move;"><iconify-icon icon="carbon:draggable"></iconify-icon> ${i + 1}.</span>
                                    <input type="text" class="ppt-input-field" value="${item.title}" style="flex: 1; min-width: 0; font-weight: 600;" onchange="window.PPTGenerator.updateOutlineTitle(${i}, this.value)">
                                </div>
                                <div style="padding-left: 24px;">
                                    ${item.subs.map((sub, j) => `
                                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                                            <iconify-icon icon="carbon:dot-mark" style="color: var(--ppt-text-muted); font-size: 10px;"></iconify-icon>
                                            <input type="text" class="ppt-input-field" value="${sub}" style="flex: 1; min-width: 0; font-size: 13px; padding: 6px 8px;" onchange="window.PPTGenerator.updateOutlineSub(${i}, ${j}, this.value)">
                                            <button class="ppt-icon-btn" onclick="window.PPTGenerator.removeOutlineSub(${i}, ${j})" title="删除子项" style="padding: 4px; width: 24px; height: 24px; flex-shrink: 0;">
                                                <iconify-icon icon="carbon:close"></iconify-icon>
                                            </button>
                                        </div>
                                    `).join('')}
                                    <button class="ppt-btn-secondary" onclick="window.PPTGenerator.addOutlineSub(${i})" style="margin-top: 8px; padding: 4px 12px; font-size: 12px;">
                                        <iconify-icon icon="carbon:add"></iconify-icon> 添加子项
                                    </button>
                                </div>
                            </div>
                        `).join('')}
                    </div>

                    <div id="pptOutlineMarkdownEditor" class="hidden" style="flex: 1; min-height: 0; gap: 20px; display: none;">
                        <div style="flex: 1; display: flex; flex-direction: column; min-height: 0;">
                            <textarea id="pptOutlineMarkdownInput" class="w-full p-4 border border-slate-200 rounded-lg font-mono text-sm" style="flex: 1; resize: none; margin-bottom: 8px;" placeholder="# 章节标题&#10;- 子项内容" oninput="window.PPTGenerator.updateMindMapPreview()"></textarea>
                            <div style="text-align: right; flex-shrink: 0;">
                                <button class="ppt-btn-primary" onclick="window.PPTGenerator.saveMarkdownOutline()">
                                    <iconify-icon icon="carbon:save"></iconify-icon> 保存并返回
                                </button>
                            </div>
                        </div>
                        <div class="mindmap-preview" style="flex: 2; border: 1px solid var(--ppt-border); border-radius: 8px; background: #f8fafc; overflow: hidden; display: flex; flex-direction: column; min-height: 0;">
                            <div style="padding: 8px 12px; background: white; border-bottom: 1px solid var(--ppt-border); font-size: 12px; font-weight: 600; color: var(--ppt-text-secondary);">
                                <iconify-icon icon="carbon:mindmap"></iconify-icon> 思维导图预览
                            </div>
                            <div id="pptMindMapContainer" style="flex: 1; overflow: auto; padding: 20px; position: relative;">
                                <!-- Mindmap SVG will be rendered here -->
                                <div style="color: var(--ppt-text-muted); font-size: 12px; text-align: center; margin-top: 40px;">输入内容以生成预览</div>
                            </div>
                            <div style="padding: 8px 12px; background: #f1f5f9; border-top: 1px solid var(--ppt-border); font-size: 11px; color: var(--ppt-text-secondary); display: flex; justify-content: space-between;">
                                <span><iconify-icon icon="carbon:mouse-right-click"></iconify-icon> 右键点击节点可添加/删除</span>
                                <span><iconify-icon icon="carbon:touch-1"></iconify-icon> 左键点击编辑文本</span>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="form-footer">
                    <button class="ppt-btn-secondary" onclick="window.PPTGenerator.regenerateOutline()">
                        <iconify-icon icon="carbon:renew"></iconify-icon> 重新生成
                    </button>
                    <button class="ppt-btn-primary" onclick="window.PPTGenerator.confirmOutline()">
                        确认大纲 <iconify-icon icon="carbon:arrow-right"></iconify-icon>
                    </button>
                </div>
            </div>
            
            <!-- Context Menu -->
            <div id="pptMindMapContextMenu" class="ppt-context-menu">
                <div class="ppt-context-menu-item" onclick="window.PPTGenerator.triggerContextAction('edit')">
                    <iconify-icon icon="carbon:edit"></iconify-icon> 编辑内容
                </div>
                <div class="ppt-context-menu-item" onclick="window.PPTGenerator.triggerContextAction('add')">
                    <iconify-icon icon="carbon:add-alt"></iconify-icon> 添加子节点
                </div>
                <div class="ppt-context-menu-divider"></div>
                <div class="ppt-context-menu-item danger" onclick="window.PPTGenerator.triggerContextAction('delete')">
                    <iconify-icon icon="carbon:trash-can"></iconify-icon> 删除节点
                </div>
            </div>
        `;
        
        // Add global click listener to close menu
        setTimeout(() => {
            document.removeEventListener('click', this._closeContextMenuHandler);
            document.addEventListener('click', this._closeContextMenuHandler);
        }, 0);
        
        return html;
    }

    _closeContextMenuHandler = (e) => {
        const menu = document.getElementById('pptMindMapContextMenu');
        if (menu && !menu.contains(e.target)) {
            menu.style.display = 'none';
        }
    }

    // Drag and Drop Handlers
    handleDragStart(e, index) {
        this.draggedItemIndex = index;
        e.dataTransfer.effectAllowed = 'move';
        e.target.style.opacity = '0.5';
    }

    handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        return false;
    }

    handleDrop(e, targetIndex) {
        e.stopPropagation();
        const draggedIndex = this.draggedItemIndex;
        
        // Reset opacity
        const cards = document.querySelectorAll('.outline-node-card');
        if (cards[draggedIndex]) cards[draggedIndex].style.opacity = '1';

        if (draggedIndex !== targetIndex && this.workflowData.outline) {
            const item = this.workflowData.outline[draggedIndex];
            // Remove from old position
            this.workflowData.outline.splice(draggedIndex, 1);
            // Insert at new position
            this.workflowData.outline.splice(targetIndex, 0, item);
            this.renderPreviewArea();
        }
        return false;
    }

    updateMindMapPreview() {
        const input = document.getElementById('pptOutlineMarkdownInput');
        const container = document.getElementById('pptMindMapContainer');
        if (!input || !container) return;

        const text = input.value;
        if (!text.trim()) {
            container.innerHTML = '<div style="color: var(--ppt-text-muted); font-size: 12px;">输入内容以生成预览</div>';
            return;
        }

        // Simple Mermaid-like rendering logic (using pure SVG for zero-dependency)
        // Parse structure
        const lines = text.split('\n');
        const nodes = [];
        let currentParent = null;

        // Root node
        nodes.push({ id: 'root', text: this.currentProject.title || '演示文稿', level: 0, children: [] });

        lines.forEach((line, idx) => {
            const trimmed = line.trim();
            if (trimmed.startsWith('#')) {
                const title = trimmed.replace(/^#+\s*/, '');
                const node = { id: `h-${idx}`, text: title, level: 1, children: [] };
                nodes[0].children.push(node);
                currentParent = node;
            } else if ((trimmed.startsWith('-') || trimmed.startsWith('*')) && currentParent) {
                const sub = trimmed.replace(/^[-*]\s*/, '');
                currentParent.children.push({ id: `s-${idx}`, text: sub, level: 2 });
            }
        });

        // Render SVG
        const svg = this._generateMindMapSVG(nodes[0]);
        container.innerHTML = svg;
    }

    _generateMindMapSVG(root) {
        // Improved layout calculation for Mind Map
        const nodeHeight = 30;
        const nodeWidth = 120; // Increased width for better text visibility
        const xGap = 180; // Increased gap
        const yGap = 15;
        
        // Calculate subtree heights first
        function calculateHeight(node) {
            if (!node.children || node.children.length === 0) {
                node.subtreeHeight = nodeHeight + yGap;
                return node.subtreeHeight;
            }
            let h = 0;
            node.children.forEach(child => {
                h += calculateHeight(child);
            });
            node.subtreeHeight = h;
            return h;
        }
        
        calculateHeight(root);

        // Layout nodes based on subtree heights
        let maxX = 0;
        let maxY = 0;

        function layout(node, x, y) {
            node.x = x;
            node.y = y + node.subtreeHeight / 2 - nodeHeight / 2;
            
            if (x + nodeWidth > maxX) maxX = x + nodeWidth;
            if (y + node.subtreeHeight > maxY) maxY = y + node.subtreeHeight;

            let currentChildY = y;
            if (node.children) {
                node.children.forEach(child => {
                    layout(child, x + xGap, currentChildY);
                    currentChildY += child.subtreeHeight;
                });
            }
        }

        layout(root, 20, 20);
        
        // Dynamic SVG size with padding
        const width = maxX + 50;
        const height = maxY + 40;

        let svgContent = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="font-family: sans-serif; font-size: 12px; background-color: #f8fafc;">`;
        
        // Draw connections (Curved lines)
        function drawLines(node) {
            let lines = '';
            if (node.children) {
                node.children.forEach(child => {
                    // Bezier curve from right of parent to left of child
                    const startX = node.x + nodeWidth;
                    const startY = node.y + nodeHeight / 2;
                    const endX = child.x;
                    const endY = child.y + nodeHeight / 2;
                    
                    const cp1X = startX + (endX - startX) / 2;
                    const cp1Y = startY;
                    const cp2X = startX + (endX - startX) / 2;
                    const cp2Y = endY;

                    const path = `M ${startX} ${startY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${endX} ${endY}`;
                    lines += `<path d="${path}" stroke="#cbd5e1" stroke-width="1.5" fill="none" />`;
                    lines += drawLines(child);
                });
            }
            return lines;
        }
        svgContent += drawLines(root);

        // Draw nodes
        function drawNodes(node) {
            let nodesSvg = '';
            const color = node.level === 0 ? '#4f46e5' : node.level === 1 ? '#0ea5e9' : '#64748b';
            const bgColor = node.level === 0 ? '#e0e7ff' : node.level === 1 ? '#e0f2fe' : '#ffffff';
            const textColor = node.level === 0 ? '#312e81' : node.level === 1 ? '#0369a1' : '#334155';
            const strokeWidth = node.level === 0 ? 2 : 1;
            
            // Truncate text if too long
            const maxChars = 14;
            const displayText = node.text.length > maxChars ? node.text.substring(0, maxChars) + '...' : node.text;

            // Add onclick event to update markdown
            const clickHandler = `window.PPTGenerator.handleMindMapNodeClick('${node.id}', '${node.text.replace(/'/g, "\\'")}')`;
            
            // Add context menu event for right click
            const contextMenuHandler = `window.PPTGenerator.handleMindMapContextMenu(event, '${node.id}')`;

            nodesSvg += `
                <g transform="translate(${node.x}, ${node.y})" onclick="${clickHandler}" oncontextmenu="${contextMenuHandler}" style="cursor: pointer;">
                    <rect width="${nodeWidth}" height="${nodeHeight}" rx="6" fill="${bgColor}" stroke="${color}" stroke-width="${strokeWidth}" filter="drop-shadow(0 1px 2px rgb(0 0 0 / 0.05))" />
                    <text x="${nodeWidth/2}" y="19" text-anchor="middle" fill="${textColor}" style="pointer-events: none; font-weight: ${node.level === 0 ? '600' : '400'}">${displayText}</text>
                    <title>${node.text} (左键编辑，右键菜单)</title>
                </g>
            `;
            if (node.children) {
                node.children.forEach(child => nodesSvg += drawNodes(child));
            }
            return nodesSvg;
        }
        svgContent += drawNodes(root);
        
        svgContent += '</svg>';
        return svgContent;
    }

    handleMindMapContextMenu(e, nodeId) {
        e.preventDefault();
        e.stopPropagation();
        
        this.activeContextNodeId = nodeId;
        
        const menu = document.getElementById('pptMindMapContextMenu');
        if (!menu) return;
        
        // Position menu
        const rect = this.elements.overlay.getBoundingClientRect();
        let x = e.clientX;
        let y = e.clientY;
        
        // Adjust if close to edge
        if (x + 150 > window.innerWidth) x -= 150;
        if (y + 120 > window.innerHeight) y -= 120;
        
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        menu.style.display = 'block';
    }

    triggerContextAction(action) {
        const menu = document.getElementById('pptMindMapContextMenu');
        if (menu) menu.style.display = 'none';
        
        if (!this.activeContextNodeId) return;
        
        if (action === 'edit') {
            // Find current text to prepopulate
            // We don't have easy access to text here without parsing again or passing it in.
            // For now, let's just trigger the click handler which does the prompt.
            // A better way would be to store the text in the node element dataset.
            const nodeEl = document.querySelector(`g[onclick*="${this.activeContextNodeId}"] text`);
            const currentText = nodeEl ? nodeEl.textContent : "";
            this.handleMindMapNodeClick(this.activeContextNodeId, currentText);
        } else if (action === 'add') {
            this.addMindMapChild(this.activeContextNodeId);
        } else if (action === 'delete') {
            this.deleteMindMapNode(this.activeContextNodeId);
        }
    }

    addMindMapChild(parentId) {
        const mdInput = document.getElementById('pptOutlineMarkdownInput');
        if (!mdInput) return;
        
        // Instant add without prompt for better UX
        const newText = "新节点";

        const lines = mdInput.value.split('\n');
        
        // If root, append h1 at end? No, root is virtual in this simple parser usually,
        // but here root is the title.
        // If parent is h-X (header), we append a list item after it or after its last list item.
        // If parent is s-X (sub item), we can't nest deeper in this simple 2-level model.
        
        if (parentId === 'root') {
            // Add new H1 at end
            lines.push(`\n# ${newText}`);
        } else if (parentId.startsWith('h-')) {
            const lineIndex = parseInt(parentId.split('-')[1]);
            // Find where the next header starts to insert before it, or end of file
            let insertIndex = lineIndex + 1;
            while (insertIndex < lines.length && !lines[insertIndex].trim().startsWith('#')) {
                insertIndex++;
            }
            lines.splice(insertIndex, 0, `- ${newText}`);
        } else {
            alert("暂不支持三级嵌套");
            return;
        }
        
        mdInput.value = lines.join('\n');
        this.updateMindMapPreview();
    }

    deleteMindMapNode(nodeId) {
        if (nodeId === 'root') {
            alert("不能删除根节点");
            return;
        }
        
        // Only confirm for headers (sections), delete sub-items instantly
        if (nodeId.startsWith('h-')) {
            if (!confirm("确定要删除此章节及其所有子项吗？")) return;
        }

        const mdInput = document.getElementById('pptOutlineMarkdownInput');
        if (!mdInput) return;
        
        const lineIndex = parseInt(nodeId.split('-')[1]);
        const lines = mdInput.value.split('\n');
        
        if (nodeId.startsWith('s-')) {
            // Just remove the line
            lines.splice(lineIndex, 1);
        } else if (nodeId.startsWith('h-')) {
            // Remove header and its children (until next header)
            let count = 1;
            while (lineIndex + count < lines.length && !lines[lineIndex + count].trim().startsWith('#')) {
                count++;
            }
            lines.splice(lineIndex, count);
        }
        
        mdInput.value = lines.join('\n');
        this.updateMindMapPreview();
    }

    handleMindMapNodeClick(nodeId, currentText) {
        const newText = prompt("编辑节点内容:", currentText);
        if (newText !== null && newText !== currentText) {
            const mdInput = document.getElementById('pptOutlineMarkdownInput');
            if (!mdInput) return;

            // Simple regex replacement based on line index stored in ID
            // Note: This is a basic implementation. For robust syncing, we'd need a better data model.
            // Here we rely on the fact that we generated IDs based on line index.
            const lineIndex = parseInt(nodeId.split('-')[1]);
            const lines = mdInput.value.split('\n');
            
            if (lines[lineIndex]) {
                if (nodeId.startsWith('h-')) {
                    lines[lineIndex] = lines[lineIndex].replace(/^#+\s*.*/, `# ${newText}`);
                } else if (nodeId.startsWith('s-')) {
                    lines[lineIndex] = lines[lineIndex].replace(/^([-*])\s*.*/, `$1 ${newText}`);
                }
                mdInput.value = lines.join('\n');
                this.updateMindMapPreview(); // Refresh preview
            }
        }
    }

    addOutlineItem() {
        if (!this.workflowData.outline) this.workflowData.outline = [];
        this.workflowData.outline.push({ title: "新章节", subs: ["新子项"] });
        this.renderPreviewArea();
    }

    removeOutlineItem(index) {
        if (!this.workflowData.outline) return;
        this.workflowData.outline.splice(index, 1);
        this.renderPreviewArea();
    }

    toggleOutlineEditMode() {
        const visualEditor = document.getElementById('pptOutlineVisualEditor');
        const mdEditor = document.getElementById('pptOutlineMarkdownEditor');
        const mdInput = document.getElementById('pptOutlineMarkdownInput');
        
        if (visualEditor && mdEditor) {
            if (mdEditor.classList.contains('hidden')) {
                // Switch to Markdown
                const mdText = this.workflowData.outline.map(item => {
                    return `# ${item.title}\n${item.subs.map(sub => `- ${sub}`).join('\n')}`;
                }).join('\n\n');
                
                mdInput.value = mdText;
                visualEditor.classList.add('hidden');
                mdEditor.classList.remove('hidden');
                mdEditor.style.display = 'flex';
                
                // Trigger preview update
                this.updateMindMapPreview();
            } else {
                // Switch to Visual (Cancel)
                mdEditor.classList.add('hidden');
                mdEditor.style.display = 'none';
                visualEditor.classList.remove('hidden');
            }
        }
    }

    saveMarkdownOutline() {
        const mdInput = document.getElementById('pptOutlineMarkdownInput');
        if (!mdInput) return;

        const text = mdInput.value;
        const lines = text.split('\n');
        const newOutline = [];
        let currentItem = null;

        lines.forEach(line => {
            const trimmed = line.trim();
            if (trimmed.startsWith('#')) {
                if (currentItem) newOutline.push(currentItem);
                currentItem = { title: trimmed.replace(/^#+\s*/, ''), subs: [] };
            } else if (trimmed.startsWith('-') || trimmed.startsWith('*')) {
                if (currentItem) {
                    currentItem.subs.push(trimmed.replace(/^[-*]\s*/, ''));
                }
            } else if (trimmed.length > 0 && currentItem) {
                 // Treat plain text as sub item if under a header
                 currentItem.subs.push(trimmed);
            }
        });
        if (currentItem) newOutline.push(currentItem);

        this.workflowData.outline = newOutline;
        this.renderPreviewArea();
    }

    _renderStep(stepState, num, label) {
        // Simple logic to determine active/completed state
        const states = ['idle', 'reading', 'questioning', 'outline_review', 'scripting', 'designer', 'reviewer', 'completed'];
        const currentIndex = states.indexOf(this.state);
        const stepIndex = states.indexOf(stepState);
        
        let className = 'gen-step';
        if (this.state === stepState) className += ' active';
        if (currentIndex > stepIndex) className += ' completed';

        return `
            <div class="${className}">
                <div class="gen-step-icon">
                    ${currentIndex > stepIndex ? '<iconify-icon icon="carbon:checkmark"></iconify-icon>' : num}
                </div>
                <span class="gen-step-label">${label}</span>
            </div>
        `;
    }

    _getCurrentStatusIcon() {
        if (this.state === 'reading') return 'carbon:document-view';
        if (this.state === 'questioning') return 'carbon:user-speaker';
        if (this.state === 'scripting') return 'carbon:edit';
        if (this.state === 'designer') return 'carbon:paint-brush';
        return 'carbon:bot';
    }

    _getCurrentStatusTitle() {
        if (this.state === 'reading') return '正在深度阅读文档...';
        if (this.state === 'questioning') return '需要您的确认';
        if (this.state === 'outline_review') return '大纲确认';
        if (this.state === 'scripting') return '正在构建演示大纲...';
        if (this.state === 'designer') return '正在进行视觉设计...';
        return '准备就绪';
    }

    _getCurrentStatusDesc() {
        if (this.state === 'reading') return 'AI 正在分析文档结构并提取关键信息';
        if (this.state === 'questioning') return '请确认几个关键选项以定制演示风格';
        if (this.state === 'outline_review') return 'AI 已根据您的需求生成演示大纲，请确认或调整';
        if (this.state === 'scripting') return '正在梳理逻辑结构并撰写演讲备注';
        if (this.state === 'designer') return '正在匹配最佳模板并生成页面布局';
        return '请上传文档或输入主题开始';
    }

    // ============================================================
    // Workflow Logic: Multi-Agent Orchestration
    // ============================================================

    handleFileUpload(fileList) {
        // Convert FileList to array and mock processing
        const newFiles = Array.from(fileList).map(f => ({ name: f.name, size: this._formatSize(f.size), type: 'file' }));
        if (newFiles.length === 0) return;

        if (!this.workflowData.files) this.workflowData.files = [];
        this.workflowData.files = [...this.workflowData.files, ...newFiles];
        this.renderPreviewArea();
    }

    _formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    async startMultiAgentWorkflow() {
        this.state = 'reading';
        this.updateTodos([
            { text: '深度阅读与信息提取', status: 'active' },
            { text: '关键需求分析与确认', status: 'pending' },
            { text: '生成演示大纲与脚本', status: 'pending' },
            { text: '智能分段与内容映射', status: 'pending' },
            { text: '视觉设计与排版优化', status: 'pending' },
            { text: '最终渲染与质量检查', status: 'pending' }
        ]);
        this.renderPreviewArea();

        await this.phase1_DeepReading();
    }

    // --- Phase 1: Reader Agent (Deep Metadata Extraction) ---
    async phase1_DeepReading() {
        this._setAgentStatus('reader', 'active', 'Analyzing document structure...');
        
        const files = (this.workflowData.files && this.workflowData.files.length > 0) ? this.workflowData.files : [
            { name: 'Project_Nebula_Specs.pdf', size: '2.4MB', type: 'file' },
            { name: 'Market_Research_2025.docx', size: '1.1MB', type: 'file' }
        ];
        this._renderFileGrid(files);

        // Step 1.1: Initial 3000 chars scan
        await this.logTerminal('AI 阅读', `正在并行扫描 ${files.length} 个资源 (前 3000 字符)...`, 'normal');
        await this._simulateParallelReading(files, 30); // 30% progress
        
        // Simulate finding incomplete info
        await new Promise(r => setTimeout(r, 800));
        const firstFile = files[0] || { name: 'Document' };
        await this.logTerminal('AI 阅读', `提示: "${firstFile.name}" 摘要不完整，正在深入扫描...`, 'warning');

        // Step 1.2: Extended 10000 chars scan
        await new Promise(r => setTimeout(r, 800));
        await this.logTerminal('AI 阅读', '扩展扫描范围至 10,000 字符...', 'highlight');
        await this._simulateParallelReading(files, 70); // 70% progress
        await this.logTerminal('AI 阅读', '信息确认: 已定位 "预算" 相关章节。上下文置信度: 85%。', 'normal');

        // Step 1.3: Search Agent fallback (Simulated)
        await new Promise(r => setTimeout(r, 800));
        await this.logTerminal('AI 阅读', '正在调用搜索助手补充 "竞品分析" 数据...', 'highlight');
        await this.logTerminal('AI 搜索', '正在查询内部知识库...', 'normal');
        await new Promise(r => setTimeout(r, 1000));
        await this.logTerminal('AI 搜索', '找到 2 份相关报告，正在合并上下文。', 'success');
        
        // Finish Phase 1
        this._renderFileGrid(files, 100); // 100% progress
        this._setAgentStatus('reader', 'idle', 'Metadata Extracted');
        
        this.updateTodos([
            { text: '深度阅读与信息提取', status: 'completed' },
            { text: '关键需求分析与确认', status: 'active' },
            { text: '生成演示大纲与脚本', status: 'pending' },
            { text: '智能分段与内容映射', status: 'pending' },
            { text: '视觉设计与排版优化', status: 'pending' },
            { text: '最终渲染与质量检查', status: 'pending' }
        ]);

        this.phase2_QuestionGeneration();
    }

    // --- Phase 2: Analyst Agent (Question Generation) ---
    async phase2_QuestionGeneration() {
        this.state = 'questioning';
        this._setAgentStatus('analyst', 'active', 'Formulating strategy questions...');
        
        await this.logTerminal('AI 分析', '正在分析内容密度...', 'normal');
        await new Promise(r => setTimeout(r, 1000));
        await this.logTerminal('AI 分析', '识别出 3 个关键决策点，需要用户确认。', 'success');

        // Mock Questions
        this.workflowData.questions = [
            {
                text: "目标受众的技术背景如何？",
                options: ["非技术高管 (侧重商业价值)", "技术团队 (侧重架构细节)", "混合受众"],
                default: "混合受众"
            },
            {
                text: "演示文稿的色调风格偏好？",
                options: ["深色科技风 (Dark Modern)", "学术严谨 (Academic)", "商务极简 (Business Light)"],
                default: "深色科技风 (Dark Modern)"
            },
            {
                text: "是否需要包含详细的财务报表数据？",
                options: ["是，包含详细图表", "否，仅展示关键指标摘要"],
                default: "否，仅展示关键指标摘要"
            }
        ];

        this.addChatMessage('ai', '已完成深度扫描。为了生成更精准的演示文稿，请确认右侧的关键选项。');
        this.renderPreviewArea(); // Will render Question Form
    }

    autoFillAnswers() {
        // Simulate AI decision
        this.submitAnswers();
    }

    async submitAnswers() {
        // In a real app, we'd gather form data here.
        this.state = 'outline_review';
        this.renderPreviewArea(); // Show Outline Review
        
        this.updateTodos([
            { text: '深度阅读与信息提取', status: 'completed' },
            { text: '关键需求分析与确认', status: 'completed' },
            { text: '生成演示大纲与脚本', status: 'active' }, // Still active as outline is part of this
            { text: '智能分段与内容映射', status: 'pending' },
            { text: '视觉设计与排版优化', status: 'pending' },
            { text: '最终渲染与质量检查', status: 'pending' }
        ]);
    }

    confirmOutline() {
        this.state = 'scripting';
        this.renderPreviewArea(); // Switch back to terminal view
        this.phase3_Scripting();
    }

    regenerateOutline() {
        this.addChatMessage('ai', '正在重新生成大纲，请稍候...');
        // Mock regeneration delay
        setTimeout(() => {
            this.renderPreviewArea();
        }, 1000);
    }

    updateOutlineTitle(index, value) {
        if (!this.workflowData.outline) return;
        this.workflowData.outline[index].title = value;
    }

    updateOutlineSub(parentIndex, subIndex, value) {
        if (!this.workflowData.outline) return;
        this.workflowData.outline[parentIndex].subs[subIndex] = value;
    }

    addOutlineSub(parentIndex) {
        if (!this.workflowData.outline) return;
        this.workflowData.outline[parentIndex].subs.push("新子项");
        this.renderPreviewArea();
    }

    removeOutlineSub(parentIndex, subIndex) {
        if (!this.workflowData.outline) return;
        this.workflowData.outline[parentIndex].subs.splice(subIndex, 1);
        this.renderPreviewArea();
    }

    // --- Phase 3: Analyst Agent (Scripting) ---
    async phase3_Scripting() {
        this._setAgentStatus('analyst', 'active', 'Drafting presentation script...');
        
        await this.logTerminal('AI 分析', '正在处理用户反馈...', 'normal');
        await this.logTerminal('AI 分析', '构建叙事结构: 问题 -> 解决方案 -> 价值影响', 'highlight');
        
        // Simulate batch processing of script generation
        const sections = ['引言', '市场痛点', '解决方案', '技术架构', '未来规划'];
        for (const sec of sections) {
            await new Promise(r => setTimeout(r, 600));
            await this.logTerminal('AI 分析', `正在撰写章节: ${sec}...`, 'normal');
        }
        
        await this.logTerminal('AI 分析', '演讲稿脚本生成完成。共 2500 字。', 'success');
        this._setAgentStatus('analyst', 'idle', 'Script Ready');

        this.updateTodos([
            { text: '深度阅读与信息提取', status: 'completed' },
            { text: '关键需求分析与确认', status: 'completed' },
            { text: '生成演示大纲与脚本', status: 'completed' },
            { text: '智能分段与内容映射', status: 'active' },
            { text: '视觉设计与排版优化', status: 'pending' },
            { text: '最终渲染与质量检查', status: 'pending' }
        ]);

        this.phase4_Segmentation();
    }

    // --- Phase 4: Designer Agent (Segmentation & Mapping) ---
    async phase4_Segmentation() {
        this._setAgentStatus('designer', 'active', 'Segmenting script into slides...');
        
        await this.logTerminal('AI 设计', '正在分析语义边界...', 'normal');
        await this.logTerminal('AI 设计', '正在建立内容溯源映射...', 'highlight');
        
        // Simulate segmentation
        await new Promise(r => setTimeout(r, 1000));
        await this.logTerminal('AI 设计', '已生成 12 个幻灯片分段。', 'success');
        
        // Mock Source Mapping
        const sourceFiles = this.workflowData.files.length > 0 ? this.workflowData.files : [{name: 'Project_Nebula_Specs.pdf'}];
        await this.logTerminal('AI 设计', `分段 3 已关联至 "${sourceFiles[0].name}" (p.14)`, 'normal');
        if (sourceFiles.length > 1) {
            await this.logTerminal('AI 设计', `分段 7 已关联至 "${sourceFiles[1].name}" (line 45)`, 'normal');
        }

        this.updateTodos([
            { text: '深度阅读与信息提取', status: 'completed' },
            { text: '关键需求分析与确认', status: 'completed' },
            { text: '生成演示大纲与脚本', status: 'completed' },
            { text: '智能分段与内容映射', status: 'completed' },
            { text: '视觉设计与排版优化', status: 'active' },
            { text: '最终渲染与质量检查', status: 'pending' }
        ]);

        this.phase5_DesignOptimization();
    }

    // --- Phase 5: Designer Agent (Design Optimization) ---
    async phase5_DesignOptimization() {
        this._setAgentStatus('designer', 'active', 'Optimizing visual layout...');
        
        // Simulate batch design decision making (JSON output)
        const designSteps = [
            { msg: '正在评估幻灯片 1-12 的文本密度...', type: 'normal' },
            { msg: '决策: 幻灯片 4 需要柱状图 (检测到数据)。', type: 'highlight' },
            { msg: '决策: 幻灯片 2 需要首图 (概念性内容)。', type: 'highlight' },
            { msg: '决策: 幻灯片 8 使用分栏布局 (检测到对比内容)。', type: 'highlight' },
            { msg: '正在应用 "深色科技" 风格主题...', type: 'normal' }
        ];

        for (const step of designSteps) {
            await new Promise(r => setTimeout(r, 800));
            await this.logTerminal('AI 设计', step.msg, step.type);
        }

        this._setAgentStatus('designer', 'idle', 'Design Complete');
        
        this.updateTodos([
            { text: '深度阅读与信息提取', status: 'completed' },
            { text: '关键需求分析与确认', status: 'completed' },
            { text: '生成演示大纲与脚本', status: 'completed' },
            { text: '智能分段与内容映射', status: 'completed' },
            { text: '视觉设计与排版优化', status: 'completed' },
            { text: '最终渲染与质量检查', status: 'active' }
        ]);

        this.phase6_FinalReview();
    }

    // --- Phase 6: Reviewer Agent ---
    async phase6_FinalReview() {
        this._setAgentStatus('reviewer', 'active', 'Final compliance check...');
        await new Promise(r => setTimeout(r, 1000));
        await this.logTerminal('AI 审查', '所有约束条件已满足。', 'success');
        this._setAgentStatus('reviewer', 'idle', 'Approved');

        this.updateTodos([
            { text: '深度阅读与信息提取', status: 'completed' },
            { text: '关键需求分析与确认', status: 'completed' },
            { text: '生成演示大纲与脚本', status: 'completed' },
            { text: '智能分段与内容映射', status: 'completed' },
            { text: '视觉设计与排版优化', status: 'completed' },
            { text: '最终渲染与质量检查', status: 'completed' }
        ]);

        this.state = 'completed';
        this.currentProject.status = 'completed';
        this._saveProject();
        
        this.addChatMessage('ai', '任务完成。演示文稿已生成。');
        setTimeout(() => this.renderPreviewArea(), 1000);
    }

    _setAgentStatus(id, status, activity) {
        this.agents[id] = { status, activity };
        // Re-render just the agent cards if possible, or full area
        this.renderPreviewArea();
    }

    _renderFileGrid(files) {
        const grid = document.getElementById('fileProcessingGrid');
        if (!grid) return;
        
        grid.innerHTML = files.map((f, i) => `
            <div class="gen-file-item" id="file-node-${i}">
                <div class="gen-file-icon">
                    <iconify-icon icon="carbon:document"></iconify-icon>
                </div>
                <div class="gen-file-name">${f.name}</div>
                <div class="gen-file-status">
                    <span class="file-percent">0%</span>
                </div>
            </div>
        `).join('');
    }

    async _simulateParallelReading(files, targetProgress = 100) {
        // If we are continuing, we need to know current progress.
        // For simplicity in this simulation, we just animate from 0 or previous known state.
        // But here we'll just animate to targetProgress.
        
        const updates = files.map(() => ({ progress: 0 })); // Reset for demo or track properly
        
        return new Promise(resolve => {
            const interval = setInterval(() => {
                let allReached = true;
                files.forEach((_, i) => {
                    if (updates[i].progress < targetProgress) {
                        updates[i].progress += Math.random() * 5; // Slower
                        if (updates[i].progress > targetProgress) updates[i].progress = targetProgress;
                        
                        // Update DOM
                        const node = document.getElementById(`file-node-${i}`);
                        if (node) {
                            // node.querySelector('.file-progress-bar').style.width = `${updates[i].progress}%`; // Removed bar
                            node.querySelector('.file-percent').innerText = `${Math.floor(updates[i].progress)}%`;
                            if (updates[i].progress === 100) {
                                node.querySelector('.gen-file-status').innerHTML = '<iconify-icon icon="carbon:checkmark-filled" style="color: var(--ppt-success)"></iconify-icon>';
                            }
                        }
                        allReached = false;
                    }
                });
                
                if (allReached) {
                    clearInterval(interval);
                    resolve();
                }
            }, 100);
        });
    }

    async logTerminal(agent, msg, type = 'normal') {
        const entry = { time: new Date().toLocaleTimeString(), agent, msg, type };
        this.processLogs.push(entry);
        this.currentProject.logs = this.processLogs;
        this._saveProject();
        this._appendLogToTerminal(entry);
        await new Promise(r => setTimeout(r, 300)); // Typing delay
    }

    _appendLogToTerminal(log) {
        const term = document.getElementById('agentTerminal');
        if (!term) return;
        
        // Minimal ticker style: just show the latest message with a dot
        term.innerHTML = `
            <div class="gen-log-dot"></div>
            <div class="gen-log-content">
                <span style="font-weight: 600; color: var(--ppt-accent);">${log.agent}:</span>
                <span>${log.msg}</span>
            </div>
        `;
        
        // Ensure the terminal scrolls to show the latest message if needed,
        // though currently it replaces content. If we want history, we'd append.
        // For now, just ensuring the container can handle the height.
    }

    // ============================================================
    // Final Presentation Mode (Dark Theme)
    // ============================================================

    renderPresentationMode(container) {
        container.innerHTML = `
            <div class="pres-container">
                <!-- Top Toolbar -->
                <div class="pres-toolbar">
                    <div class="pres-toolbar-left">
                        <button class="ppt-icon-btn" onclick="window.PPTGenerator.enterWorkspace()">
                            <iconify-icon icon="carbon:arrow-left"></iconify-icon>
                        </button>
                        <div class="pres-title-wrapper">
                            <input type="text" class="pres-title-input" value="${this.currentProject.title}" onblur="window.PPTGenerator.updateProjectTitle(this.value)" onkeydown="if(event.key === 'Enter') this.blur()">
                            <iconify-icon icon="carbon:edit" class="pres-title-icon"></iconify-icon>
                        </div>
                    </div>
                    <div class="pres-toolbar-center">
                        <button class="pres-view-btn ${this.viewMode === 'slide' ? 'active' : ''}" onclick="window.PPTGenerator.toggleViewMode('slide')">幻灯片</button>
                        <button class="pres-view-btn ${this.viewMode === 'outline' ? 'active' : ''}" onclick="window.PPTGenerator.toggleViewMode('outline')">大纲视图</button>
                    </div>
                    <div class="ppt-header-right">
                        <div class="ppt-export-dropdown">
                            <button class="ppt-export-btn" onclick="window.PPTGenerator.toggleExportMenu()">
                                <iconify-icon icon="carbon:export"></iconify-icon>
                                <span>导出</span>
                                <iconify-icon icon="carbon:chevron-down" class="ppt-export-chevron"></iconify-icon>
                            </button>
                            <div class="ppt-export-menu" id="pptExportMenu">
                                <button class="ppt-export-item" onclick="window.PPTGenerator.exportAs('pptx')">
                                    <iconify-icon icon="carbon:document"></iconify-icon>
                                    <div class="ppt-export-item-info">
                                        <span class="ppt-export-item-title">PowerPoint</span>
                                        <span class="ppt-export-item-desc">.pptx 演示文稿</span>
                                    </div>
                                </button>
                                <button class="ppt-export-item" onclick="window.PPTGenerator.exportAs('pdf')">
                                    <iconify-icon icon="carbon:document-pdf"></iconify-icon>
                                    <div class="ppt-export-item-info">
                                        <span class="ppt-export-item-title">PDF 文档</span>
                                        <span class="ppt-export-item-desc">.pdf 便于分享</span>
                                    </div>
                                </button>
                                <button class="ppt-export-item" onclick="window.PPTGenerator.exportAs('html-raw')">
                                    <iconify-icon icon="carbon:code"></iconify-icon>
                                    <div class="ppt-export-item-info">
                                        <span class="ppt-export-item-title">原始 HTML</span>
                                        <span class="ppt-export-item-desc">AI 输出的 data-* 格式</span>
                                    </div>
                                </button>
                                <button class="ppt-export-item" onclick="window.PPTGenerator.exportAs('html-rendered')">
                                    <iconify-icon icon="carbon:view"></iconify-icon>
                                    <div class="ppt-export-item-info">
                                        <span class="ppt-export-item-title">渲染后 HTML</span>
                                        <span class="ppt-export-item-desc">经过样式处理的 HTML</span>
                                    </div>
                                </button>
                                <div class="ppt-export-divider"></div>
                                <button class="ppt-export-item" onclick="window.PPTGenerator.exportAs('images')">
                                    <iconify-icon icon="carbon:image"></iconify-icon>
                                    <div class="ppt-export-item-info">
                                        <span class="ppt-export-item-title">图片打包</span>
                                        <span class="ppt-export-item-desc">.zip 每页一张 PNG</span>
                                    </div>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Main Area -->
                <div class="pres-main-area">
                    <!-- Canvas -->
                    <div class="pres-canvas-wrapper">
                        ${this.viewMode === 'slide' ? `
                            <div class="pres-slide" id="presSlideCanvas">
                                ${this._renderSlideContent(this.slides[this.currentSlideIndex])}
                            </div>

                            <!-- Floating Pagination -->
                            <div class="pres-pagination">
                                <button class="pres-page-btn" onclick="window.PPTGenerator.prevSlide()"><iconify-icon icon="carbon:chevron-left"></iconify-icon></button>
                                <span class="pres-page-info" id="presPageInfo">${this.currentSlideIndex + 1} / ${this.slides.length}</span>
                                <button class="pres-page-btn" onclick="window.PPTGenerator.nextSlide()"><iconify-icon icon="carbon:chevron-right"></iconify-icon></button>
                            </div>
                        ` : `
                            <div class="pres-outline-view custom-scrollbar">
                                ${this._renderOutlineContent()}
                            </div>
                        `}
                    </div>
                </div>

                <!-- Bottom Thumbnail Strip -->
                <div class="pres-bottom-strip">
                    <div class="pres-strip-header">
                        <span>幻灯片概览</span>
                        <span style="cursor: pointer"><iconify-icon icon="carbon:maximize"></iconify-icon></span>
                    </div>
                    <div class="pres-thumbnails custom-scrollbar" id="presThumbnails">
                        ${this.slides.map((slide, index) => `
                            <div class="pres-thumb-card ${index === this.currentSlideIndex ? 'active' : ''}" onclick="window.PPTGenerator.goToSlide(${index})">
                                <div class="pres-thumb-preview" style="${index === 0 ? 'background: #eff6ff; color: #3b82f6;' : ''}">${slide.title}</div>
                                <div class="pres-thumb-num">${index + 1}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    // ============================================================
    // Presentation Navigation Logic
    // ============================================================

    _renderSlideContent(slide) {
        // 使用统一的 HTMLSlideRenderer（与 PPTX 导出共享逻辑）
        if (typeof HTMLSlideRenderer !== 'undefined') {
            if (!this._htmlRenderer) {
                this._htmlRenderer = new HTMLSlideRenderer();
            }
            return this._htmlRenderer.render(slide, this.currentSlideIndex);
        }
        // Fallback
        return this._renderSlideContentLegacy(slide);
    }

    _renderSlideContentLegacy(slide) {
        if (slide.type === 'cover') {
            return `
                <div class="slide-modern-cover">
                    <h1 contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'title', this.innerText)" style="font-size: 48px; font-weight: 800; margin-bottom: 20px;">${slide.title}</h1>
                    <p contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'subtitle', this.innerText)" style="font-size: 24px; opacity: 0.8;">${slide.subtitle}</p>
                    <div style="margin-top: 40px; font-size: 14px; opacity: 0.6;">Generated by Paper Burner X</div>
                </div>
            `;
        } else if (slide.type === 'toc') {
            // 目录页 - 带序号的列表
            return `
                <div style="padding: 60px; height: 100%; display: flex; flex-direction: column;">
                    <h2 contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'title', this.innerText)" style="font-size: 36px; font-weight: 700; color: var(--ppt-text-main); margin-bottom: 48px;">${slide.title}</h2>
                    <div style="display: flex; flex-direction: column; gap: 20px;">
                        ${slide.items.map((item, i) => `
                            <div style="display: flex; align-items: center; gap: 20px;">
                                <span style="width: 40px; height: 40px; background: var(--ppt-primary); color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 18px;">${i + 1}</span>
                                <span contenteditable="true" onblur="window.PPTGenerator.updateSlideItem(${this.currentSlideIndex}, ${i}, this.innerText)" style="font-size: 24px; color: var(--ppt-text-secondary);">${item}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        } else if (slide.type === 'stats') {
            // 数据统计页 - 大数字展示
            return `
                <div style="padding: 60px; height: 100%; display: flex; flex-direction: column;">
                    <h2 contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'title', this.innerText)" style="font-size: 36px; font-weight: 700; color: var(--ppt-text-main); margin-bottom: 48px;">${slide.title}</h2>
                    <div style="flex: 1; display: grid; grid-template-columns: repeat(${Math.min(slide.stats.length, 4)}, 1fr); gap: 32px; align-items: center;">
                        ${slide.stats.map((stat, i) => `
                            <div style="text-align: center; padding: 24px;">
                                <div contenteditable="true" onblur="window.PPTGenerator.updateSlideStat(${this.currentSlideIndex}, ${i}, 'value', this.innerText)" style="font-size: 56px; font-weight: 800; color: var(--ppt-primary); margin-bottom: 12px;">${stat.value}</div>
                                <div contenteditable="true" onblur="window.PPTGenerator.updateSlideStat(${this.currentSlideIndex}, ${i}, 'label', this.innerText)" style="font-size: 16px; color: var(--ppt-text-secondary);">${stat.label}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        } else if (slide.type === 'comparison') {
            // 对比页 - 左右分栏
            return `
                <div style="padding: 60px; height: 100%; display: flex; flex-direction: column;">
                    <h2 contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'title', this.innerText)" style="font-size: 36px; font-weight: 700; color: var(--ppt-text-main); margin-bottom: 40px;">${slide.title}</h2>
                    <div style="flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 40px;">
                        <div style="background: #fee2e2; border-radius: 16px; padding: 32px;">
                            <h3 contenteditable="true" style="font-size: 24px; font-weight: 600; color: #dc2626; margin-bottom: 24px;">${slide.left.title}</h3>
                            <ul style="list-style: none; padding: 0; margin: 0;">
                                ${slide.left.items.map((item, i) => `
                                    <li style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px; font-size: 18px; color: #991b1b;">
                                        <iconify-icon icon="carbon:close-filled" style="color: #dc2626;"></iconify-icon>
                                        <span contenteditable="true">${item}</span>
                                    </li>
                                `).join('')}
                            </ul>
                        </div>
                        <div style="background: #dcfce7; border-radius: 16px; padding: 32px;">
                            <h3 contenteditable="true" style="font-size: 24px; font-weight: 600; color: #16a34a; margin-bottom: 24px;">${slide.right.title}</h3>
                            <ul style="list-style: none; padding: 0; margin: 0;">
                                ${slide.right.items.map((item, i) => `
                                    <li style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px; font-size: 18px; color: #166534;">
                                        <iconify-icon icon="carbon:checkmark-filled" style="color: #16a34a;"></iconify-icon>
                                        <span contenteditable="true">${item}</span>
                                    </li>
                                `).join('')}
                            </ul>
                        </div>
                    </div>
                </div>
            `;
        } else if (slide.type === 'image_text') {
            // 图文混排页
            return `
                <div style="padding: 60px; height: 100%; display: grid; grid-template-columns: 1fr 1fr; gap: 48px; align-items: center;">
                    <div>
                        <h2 contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'title', this.innerText)" style="font-size: 36px; font-weight: 700; color: var(--ppt-text-main); margin-bottom: 24px;">${slide.title}</h2>
                        <p contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'content', this.innerText)" style="font-size: 20px; color: var(--ppt-text-secondary); line-height: 1.7;">${slide.content}</p>
                    </div>
                    <div style="background: linear-gradient(135deg, #e0e7ff 0%, #c7d2fe 100%); border-radius: 16px; height: 280px; display: flex; align-items: center; justify-content: center; color: var(--ppt-primary); font-size: 18px;">
                        <iconify-icon icon="carbon:image" style="font-size: 48px; opacity: 0.5; margin-right: 12px;"></iconify-icon>
                        ${slide.imagePlaceholder || '图片占位'}
                    </div>
                </div>
            `;
        } else if (slide.type === 'icon_grid') {
            // 图标网格页
            return `
                <div style="padding: 60px; height: 100%; display: flex; flex-direction: column;">
                    <h2 contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'title', this.innerText)" style="font-size: 36px; font-weight: 700; color: var(--ppt-text-main); margin-bottom: 48px;">${slide.title}</h2>
                    <div style="flex: 1; display: grid; grid-template-columns: repeat(${Math.min(slide.items.length, 4)}, 1fr); gap: 32px;">
                        ${slide.items.map((item, i) => `
                            <div style="background: var(--ppt-bg-subtle); border-radius: 16px; padding: 32px; text-align: center;">
                                <div style="width: 64px; height: 64px; background: var(--ppt-primary-subtle); border-radius: 16px; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px auto;">
                                    <iconify-icon icon="${item.icon}" style="font-size: 32px; color: var(--ppt-primary);"></iconify-icon>
                                </div>
                                <h4 contenteditable="true" style="font-size: 20px; font-weight: 600; color: var(--ppt-text-main); margin-bottom: 8px;">${item.title}</h4>
                                <p contenteditable="true" style="font-size: 14px; color: var(--ppt-text-secondary); margin: 0;">${item.desc}</p>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        } else if (slide.type === 'quote') {
            // 引用/评价页
            return `
                <div style="padding: 80px; height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; background: linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%);">
                    <iconify-icon icon="carbon:quotes" style="font-size: 64px; color: var(--ppt-primary); opacity: 0.3; margin-bottom: 32px;"></iconify-icon>
                    <p contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'quote', this.innerText)" style="font-size: 28px; color: var(--ppt-text-main); line-height: 1.6; max-width: 700px; margin-bottom: 40px; font-style: italic;">"${slide.quote}"</p>
                    <div>
                        <div contenteditable="true" style="font-size: 20px; font-weight: 600; color: var(--ppt-text-main);">${slide.author}</div>
                        <div contenteditable="true" style="font-size: 16px; color: var(--ppt-text-secondary); margin-top: 4px;">${slide.company}</div>
                    </div>
                </div>
            `;
        } else if (slide.type === 'timeline') {
            // 时间轴/路线图页
            return `
                <div style="padding: 60px; height: 100%; display: flex; flex-direction: column;">
                    <h2 contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'title', this.innerText)" style="font-size: 36px; font-weight: 700; color: var(--ppt-text-main); margin-bottom: 48px;">${slide.title}</h2>
                    <div style="flex: 1; display: flex; align-items: center; position: relative;">
                        <div style="position: absolute; top: 50%; left: 0; right: 0; height: 4px; background: var(--ppt-border); transform: translateY(-50%);"></div>
                        <div style="display: grid; grid-template-columns: repeat(${slide.items.length}, 1fr); gap: 24px; width: 100%; position: relative;">
                            ${slide.items.map((item, i) => `
                                <div style="text-align: center;">
                                    <div style="width: 56px; height: 56px; background: var(--ppt-primary); color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 16px; margin: 0 auto 16px auto; position: relative; z-index: 1;">${item.phase}</div>
                                    <div contenteditable="true" style="font-size: 18px; font-weight: 600; color: var(--ppt-text-main); margin-bottom: 8px;">${item.title}</div>
                                    <div contenteditable="true" style="font-size: 14px; color: var(--ppt-text-secondary);">${item.desc}</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
            `;
        } else if (slide.type === 'end') {
            // 结束页
            return `
                <div class="slide-modern-cover" style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);">
                    <h1 contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'title', this.innerText)" style="font-size: 48px; font-weight: 800; margin-bottom: 16px;">${slide.title}</h1>
                    <p contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'subtitle', this.innerText)" style="font-size: 24px; opacity: 0.7; margin-bottom: 40px;">${slide.subtitle || ''}</p>
                    ${slide.email ? `<div style="font-size: 18px; opacity: 0.5;"><iconify-icon icon="carbon:email"></iconify-icon> ${slide.email}</div>` : ''}
                    <div style="margin-top: 60px; font-size: 14px; opacity: 0.4;">Generated by Paper Burner X</div>
                </div>
            `;
        } else if (slide.type === 'list') {
            return `
                <div style="padding: 60px; height: 100%; display: flex; flex-direction: column;">
                    <h2 contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'title', this.innerText)" style="font-size: 36px; font-weight: 700; color: var(--ppt-text-main); margin-bottom: 40px;">${slide.title}</h2>
                    <ul style="font-size: 24px; color: var(--ppt-text-secondary); line-height: 1.8; padding-left: 40px;">
                        ${slide.items.map((item, i) => `<li contenteditable="true" onblur="window.PPTGenerator.updateSlideItem(${this.currentSlideIndex}, ${i}, this.innerText)">${item}</li>`).join('')}
                    </ul>
                </div>
            `;
        } else {
            return `
                <div style="padding: 60px; height: 100%; display: flex; flex-direction: column; justify-content: center;">
                    <h2 contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'title', this.innerText)" style="font-size: 36px; font-weight: 700; color: var(--ppt-text-main); margin-bottom: 24px;">${slide.title}</h2>
                    <p contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'content', this.innerText)" style="font-size: 24px; color: var(--ppt-text-secondary); line-height: 1.6;">${slide.content}</p>
                </div>
            `;
        }
    }

    updateSlideContent(slideIndex, field, value) {
        if (this.slides[slideIndex]) {
            this.slides[slideIndex][field] = value;
            // Also update outline view if visible
            if (this.viewMode === 'outline') {
                this.renderPresentationMode(document.getElementById('pptPreviewArea'));
            } else {
                // Update thumbnails
                this._updateSlideView();
            }
        }
    }

    updateSlideItem(slideIndex, itemIndex, value) {
        if (this.slides[slideIndex] && this.slides[slideIndex].items) {
            this.slides[slideIndex].items[itemIndex] = value;
            this._updateSlideView();
        }
    }

    updateSlideStat(slideIndex, statIndex, field, value) {
        if (this.slides[slideIndex] && this.slides[slideIndex].stats && this.slides[slideIndex].stats[statIndex]) {
            this.slides[slideIndex].stats[statIndex][field] = value;
            this._updateSlideView();
        }
    }

    toggleViewMode(mode) {
        this.viewMode = mode;
        this.renderPresentationMode(document.getElementById('pptPreviewArea'));
    }

    _getScriptForSlide(index) {
        const scripts = [
            "Welcome. Today we explore the next frontier of computation: Quantum Computing. We call this the 'Quantum Leap'.",
            "Our agenda covers the physics foundations, key algorithms, hardware approaches, real-world applications, and the roadmap ahead.",
            "It starts with a fundamental shift. Unlike classical bits that are 0 or 1, Qubits exist in a superposition, represented here by the Bloch Sphere.",
            "Mathematically, this is a vector in a complex vector space. The coefficients alpha and beta determine the probability of measuring 0 or 1.",
            "Then there's Entanglement. Einstein called it 'spooky action at a distance'. It allows qubits to be perfectly correlated, instantly.",
            "This power enables algorithms like Shor's, which offers exponential speedup in factoring large numbers, threatening current encryption.",
            "Building this is hard. We use dilution refrigerators to cool superconducting qubits to near absolute zero, or trap individual ions with lasers.",
            "The applications are vast. From simulating molecules for new drugs, to breaking cryptography, and optimizing complex logistics networks.",
            "The market is responding. Investment is surging, with projections reaching $8.5 Billion by 2025 as we move from research to commercialization.",
            "But challenges remain. Decoherence—noise from the environment—destroys quantum states. Error correction is the holy grail.",
            "Our roadmap takes us from the current NISQ era of noisy intermediate-scale quantum devices to fully fault-tolerant logical qubits by 2030.",
            "The future is Quantum. It will solve problems that are impossible today. Join us in preparing for this paradigm shift. Thank you."
        ];
        return scripts[index] || "No speaker notes available.";
    }

    _renderOutlineContent() {
        return `
            <div class="ppt-outline-container">
                ${this.slides.map((slide, index) => `
                    <div class="ppt-outline-item" onclick="window.PPTGenerator.goToSlideFromOutline(${index})">
                        <div class="ppt-outline-num">${index + 1}</div>
                        <div class="ppt-outline-content">
                            <div class="ppt-outline-title">${slide.title}</div>
                            ${slide.subtitle ? `<div class="ppt-outline-text">${slide.subtitle}</div>` : ''}
                            ${slide.content ? `<div class="ppt-outline-text">${slide.content}</div>` : ''}
                            ${slide.items ? `
                                <ul class="ppt-outline-list">
                                    ${slide.items.map(item => `<li>${item}</li>`).join('')}
                                </ul>
                            ` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    goToSlideFromOutline(index) {
        this.currentSlideIndex = index;
        this.toggleViewMode('slide');
    }

    goToSlide(index) {
        if (index >= 0 && index < this.slides.length) {
            this.currentSlideIndex = index;
            this._updateSlideView();
        }
    }

    prevSlide() {
        if (this.currentSlideIndex > 0) {
            this.currentSlideIndex--;
            this._updateSlideView();
        }
    }

    nextSlide() {
        if (this.currentSlideIndex < this.slides.length - 1) {
            this.currentSlideIndex++;
            this._updateSlideView();
        }
    }

    _updateSlideView() {
        // Update Canvas
        const canvas = document.getElementById('presSlideCanvas');
        if (canvas) {
            canvas.innerHTML = this._renderSlideContent(this.slides[this.currentSlideIndex]);
        }

        // Update Pagination Text
        const pageInfo = document.getElementById('presPageInfo');
        if (pageInfo) {
            pageInfo.innerText = `${this.currentSlideIndex + 1} / ${this.slides.length}`;
        }

        // Update Thumbnails
        const thumbsContainer = document.getElementById('presThumbnails');
        if (thumbsContainer) {
            const thumbs = thumbsContainer.querySelectorAll('.pres-thumb-card');
            thumbs.forEach((thumb, index) => {
                if (index === this.currentSlideIndex) {
                    thumb.classList.add('active');
                    thumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                } else {
                    thumb.classList.remove('active');
                }
            });
        }
    }

    // ============================================================
    // Shared Utilities
    // ============================================================

    updateTodos(newTodos) {
        this.todos = newTodos;
        this.currentProject.todos = newTodos;
        this._saveProject();
        this.renderTodoList();
    }

    renderTodoList() {
        const container = document.getElementById('pptTodoTracker');
        if (!container) return;
        
        if (this.todos.length === 0) {
            container.style.display = 'none';
            return;
        }
        container.style.display = 'block';
        
        const listHtml = this.todos.map(todo => `
            <div class="ppt-todo-item ${todo.status}">
                <div class="ppt-todo-icon">
                    ${todo.status === 'completed' ? '<iconify-icon icon="carbon:checkmark-filled"></iconify-icon>' :
                      todo.status === 'active' ? '<iconify-icon icon="carbon:circle-dash" class="animate-spin"></iconify-icon>' :
                      '<iconify-icon icon="carbon:radio-button"></iconify-icon>'}
                </div>
                <span>${todo.text}</span>
            </div>
        `).join('');

        const completedCount = this.todos.filter(t => t.status === 'completed').length;
        const totalCount = this.todos.length;
        const progressText = !this.isTodoListExpanded ? `<span style="font-weight: normal; color: var(--ppt-text-muted); margin-left: 8px;">(${completedCount}/${totalCount})</span>` : '';

        const chevronIcon = this.isTodoListExpanded ? 'carbon:chevron-up' : 'carbon:chevron-down';
        const contentStyle = this.isTodoListExpanded ? '' : 'display: none;';

        container.innerHTML = `
            <div class="ppt-todo-header" onclick="window.PPTGenerator.toggleTodoList()">
                <div style="display: flex; align-items: center;">
                    <span>当前任务进度</span>
                    ${progressText}
                </div>
                <iconify-icon icon="${chevronIcon}"></iconify-icon>
            </div>
            <div class="ppt-todo-content" style="${contentStyle}">
                ${listHtml}
            </div>
        `;
    }

    toggleTodoList() {
        this.isTodoListExpanded = !this.isTodoListExpanded;
        this.renderTodoList();
    }

    renderChatSidebar() {
        const container = document.getElementById('pptChatHistory');
        if (!container) return;
        container.innerHTML = '';
        this.currentProject.chatHistory.forEach(msg => this._appendMessageToDOM(msg));
        this._scrollToBottom();
    }

    addChatMessage(role, content, actionHtml = null) {
        const msg = { role, content, action: actionHtml, timestamp: Date.now() };
        this.currentProject.chatHistory.push(msg);
        this._saveProject();
        this._appendMessageToDOM(msg);
        this._scrollToBottom();
    }

    _appendMessageToDOM(msg) {
        const container = document.getElementById('pptChatHistory');
        const div = document.createElement('div');
        div.className = `ppt-message ${msg.role}`;
        
        // Only show avatar for user, or if it's the very first message for AI to establish context
        // But user requested "ugly AI avatar" to be removed. Let's make it cleaner.
        // We'll remove the avatar circle for AI and just use a clean label or nothing if continuous.
        // For now, let's just remove the AI avatar circle as requested and keep user's.
        
        let avatarHtml = '';
        if (msg.role === 'user') {
            avatarHtml = `
                <div class="ppt-avatar user">
                    <iconify-icon icon="carbon:user"></iconify-icon>
                </div>
            `;
        } else {
            // For AI, maybe just a small icon or nothing if we want it cleaner?
            // User said "logo don't show always". Let's try a minimal approach.
            // We'll skip the big 'AI' circle.
            avatarHtml = `
                <div class="ppt-avatar ai-minimal">
                    <iconify-icon icon="carbon:bot"></iconify-icon>
                </div>
            `;
        }

        div.innerHTML = `
            ${avatarHtml}
            <div class="ppt-bubble">
                ${marked.parse(msg.content)}
                ${msg.action ? `<div class="ppt-bubble-action">${msg.action}</div>` : ''}
            </div>
        `;
        container.appendChild(div);
    }

    _scrollToBottom() {
        const container = document.getElementById('pptChatHistory');
        if (container) container.scrollTop = container.scrollHeight;
    }

    async handleUserMessage(text) {
        this.addChatMessage('user', text);
        setTimeout(() => {
            this.addChatMessage('ai', '指令已接收。正在为您安排任务...');
        }, 1000);
    }

    async _saveProject() {
        if (window.pptStorage && this.currentProject) {
            await window.pptStorage.saveProject(this.currentProject);
        }
    }

    async updateProjectTitle(newTitle) {
        if (this.currentProject && newTitle.trim()) {
            this.currentProject.title = newTitle.trim();
            await this._saveProject();
            // Update header title if visible
            const headerTitle = document.querySelector('.ppt-project-title');
            if (headerTitle) headerTitle.innerText = this.currentProject.title;
        }
    }

    // ============================================================
    // Project Deletion (Multi-step Confirmation)
    // ============================================================

    confirmDeleteProject(id) {
        this.projectToDelete = id;
        this.deleteStep = 1;
        this._renderDeleteModal();
    }

    _renderDeleteModal() {
        let modal = document.getElementById('pptDeleteModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'pptDeleteModal';
            modal.className = 'ppt-modal-overlay';
            document.body.appendChild(modal);
        }

        let content = '';
        if (this.deleteStep === 1) {
            content = `
                <div class="ppt-modal-card">
                    <div class="ppt-modal-header">
                        <h3><iconify-icon icon="carbon:warning-alt" style="color: var(--ppt-warning)"></iconify-icon> 确认删除</h3>
                    </div>
                    <div class="ppt-modal-body">
                        <p>您确定要删除此项目吗？此操作不可恢复。</p>
                    </div>
                    <div class="ppt-modal-footer">
                        <button class="ppt-btn-secondary" onclick="window.PPTGenerator.closeDeleteModal()">取消</button>
                        <button class="ppt-btn-danger" onclick="window.PPTGenerator.advanceDeleteStep()">继续删除</button>
                    </div>
                </div>
            `;
        } else if (this.deleteStep === 2) {
            content = `
                <div class="ppt-modal-card">
                    <div class="ppt-modal-header">
                        <h3><iconify-icon icon="carbon:warning-filled" style="color: #ef4444"></iconify-icon> 最终确认</h3>
                    </div>
                    <div class="ppt-modal-body">
                        <p>请输入 <strong>"确认删除"</strong> 以永久删除此项目。</p>
                        <input type="text" id="pptDeleteConfirmInput" class="ppt-input-field" placeholder="确认删除">
                    </div>
                    <div class="ppt-modal-footer">
                        <button class="ppt-btn-secondary" onclick="window.PPTGenerator.closeDeleteModal()">取消</button>
                        <button class="ppt-btn-danger" id="pptFinalDeleteBtn" disabled onclick="window.PPTGenerator.executeDelete()">永久删除</button>
                    </div>
                </div>
            `;
        }

        modal.innerHTML = content;
        modal.classList.remove('hidden');

        if (this.deleteStep === 2) {
            const input = document.getElementById('pptDeleteConfirmInput');
            const btn = document.getElementById('pptFinalDeleteBtn');
            input.addEventListener('input', (e) => {
                btn.disabled = e.target.value !== '确认删除';
            });
        }
    }

    advanceDeleteStep() {
        this.deleteStep = 2;
        this._renderDeleteModal();
    }

    closeDeleteModal() {
        const modal = document.getElementById('pptDeleteModal');
        if (modal) {
            modal.classList.add('hidden');
            setTimeout(() => modal.remove(), 200); // Allow for fade out if added
        }
        this.projectToDelete = null;
        this.deleteStep = 0;
    }

    async executeDelete() {
        if (this.projectToDelete && window.pptStorage) {
            await window.pptStorage.deleteProject(this.projectToDelete);
            this.closeDeleteModal();
            this.showProjectList(); // Refresh list
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // 导出功能
    // ═══════════════════════════════════════════════════════════════

    toggleExportMenu() {
        const dropdown = document.querySelector('.ppt-export-dropdown');
        if (dropdown) {
            dropdown.classList.toggle('open');

            // 点击外部关闭
            if (dropdown.classList.contains('open')) {
                const closeHandler = (e) => {
                    if (!dropdown.contains(e.target)) {
                        dropdown.classList.remove('open');
                        document.removeEventListener('click', closeHandler);
                    }
                };
                setTimeout(() => document.addEventListener('click', closeHandler), 0);
            }
        }
    }

    async exportAs(format) {
        // 关闭菜单
        const dropdown = document.querySelector('.ppt-export-dropdown');
        if (dropdown) dropdown.classList.remove('open');

        const btn = document.querySelector('.ppt-export-btn');
        const originalContent = btn?.innerHTML;

        try {
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<iconify-icon icon="carbon:circle-dash" class="animate-spin"></iconify-icon> 导出中...';
            }

            switch (format) {
                case 'pptx':
                    await this._exportPPTX();
                    break;
                case 'pdf':
                    await this._exportPDF();
                    break;
                case 'html-raw':
                    this._exportHTMLRaw();
                    break;
                case 'html-rendered':
                    this._exportHTMLRendered();
                    break;
                case 'images':
                    await this._exportImages();
                    break;
                default:
                    throw new Error('不支持的导出格式');
            }

            if (btn) {
                btn.innerHTML = '<iconify-icon icon="carbon:checkmark"></iconify-icon> 导出成功';
                setTimeout(() => {
                    btn.disabled = false;
                    btn.innerHTML = originalContent;
                }, 2000);
            }
        } catch (e) {
            console.error('Export error:', e);
            alert('导出失败: ' + e.message);
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalContent;
            }
        }
    }

    async _exportPPTX() {
        if (typeof PPTXSlideRenderer !== 'undefined') {
            const renderer = new PPTXSlideRenderer();
            const filename = `${this.currentProject?.title || 'presentation'}.pptx`;
            await renderer.render(this.slides, filename);
        } else {
            throw new Error('PPTX 渲染器未加载');
        }
    }

    async _exportPDF() {
        // 使用 html2canvas + jsPDF
        if (typeof html2canvas === 'undefined' || typeof window.jspdf === 'undefined') {
            // 动态加载库
            await this._loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
            await this._loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
        }

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [960, 540] });

        const slideContainer = document.createElement('div');
        slideContainer.style.cssText = 'position: fixed; left: -9999px; top: 0; width: 960px; height: 540px; z-index: -9999;';
        document.body.appendChild(slideContainer);

        const renderer = new HTMLSlideRenderer();

        for (let i = 0; i < this.slides.length; i++) {
            if (i > 0) pdf.addPage([960, 540], 'landscape');

            slideContainer.innerHTML = `<div style="width: 960px; height: 540px; overflow: hidden;">${renderer.render(this.slides[i], i)}</div>`;

            // 等待 iconify-icon Web Component 渲染完成
            await this._waitForIconsToLoad(slideContainer);

            // 等待 KaTeX 渲染并内联样式
            await this._waitForKatexAndInlineStyles(slideContainer);

            const canvas = await html2canvas(slideContainer.firstChild, {
                scale: 2,
                useCORS: true,
                allowTaint: true,
                backgroundColor: '#ffffff',
                logging: false,
            });

            const imgData = canvas.toDataURL('image/jpeg', 0.95);
            pdf.addImage(imgData, 'JPEG', 0, 0, 960, 540);
        }

        document.body.removeChild(slideContainer);
        pdf.save(`${this.currentProject?.title || 'presentation'}.pdf`);
    }

    /**
     * 等待 KaTeX 渲染完成并内联所有样式
     * 解决 html2canvas 对 KaTeX 样式处理不完善的问题
     */
    async _waitForKatexAndInlineStyles(container) {
        // 等待 KaTeX 渲染
        await new Promise(resolve => setTimeout(resolve, 200));

        // 获取所有 KaTeX 元素
        const katexElements = container.querySelectorAll('.katex');
        if (katexElements.length === 0) return;

        // 首先确保所有公式容器都允许溢出
        container.querySelectorAll('[data-el="formula"]').forEach(el => {
            el.style.overflow = 'visible';
        });

        // 递归内联样式的辅助函数
        const inlineStyles = (el) => {
            if (el.nodeType !== 1) return;

            const computed = window.getComputedStyle(el);
            const styles = [];

            // 需要内联的关键样式属性
            const props = [
                'display', 'position', 'top', 'left', 'right', 'bottom',
                'width', 'height', 'min-width', 'min-height',
                'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
                'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
                'font-family', 'font-size', 'font-weight', 'font-style',
                'line-height', 'text-align',
                'color', 'background-color',
                'border', 'border-top', 'border-bottom', 'border-left', 'border-right',
                'border-width', 'border-style', 'border-color',
                'transform', 'opacity', 'box-sizing',
            ];

            props.forEach(prop => {
                const value = computed.getPropertyValue(prop);
                if (value && value !== 'none' && value !== 'auto' && value !== 'normal' &&
                    value !== '0px' && value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') {
                    styles.push(`${prop}: ${value}`);
                }
            });

            // 强制设置 overflow: visible
            styles.push('overflow: visible');

            // 特殊处理 vertical-align - KaTeX 大量使用 em 单位
            const va = computed.getPropertyValue('vertical-align');
            if (va && va !== 'baseline') {
                if (va.endsWith('em')) {
                    const emVal = parseFloat(va);
                    const fontSizePx = parseFloat(computed.getPropertyValue('font-size'));
                    const pxVal = emVal * fontSizePx;
                    styles.push(`vertical-align: ${pxVal}px`);
                } else {
                    styles.push(`vertical-align: ${va}`);
                }
            }

            if (styles.length > 0) {
                el.style.cssText = styles.join('; ') + ';';
            }

            // 递归处理子元素
            Array.from(el.children).forEach(inlineStyles);
        };

        // 处理每个 KaTeX 容器及其父元素
        katexElements.forEach(katex => {
            // 确保父元素也允许溢出
            let parent = katex.parentElement;
            while (parent && parent !== container) {
                parent.style.overflow = 'visible';
                parent = parent.parentElement;
            }
            inlineStyles(katex);
        });

        // 特殊处理分数线
        container.querySelectorAll('.frac-line').forEach(el => {
            const computed = window.getComputedStyle(el);
            el.style.borderBottomWidth = computed.borderBottomWidth || '1px';
            el.style.borderBottomStyle = 'solid';
            el.style.borderBottomColor = computed.color || 'currentColor';
            el.style.width = '100%';
            el.style.display = 'block';
        });

        // 特殊处理根号线
        container.querySelectorAll('.sqrt-line').forEach(el => {
            el.style.borderTopWidth = '1px';
            el.style.borderTopStyle = 'solid';
        });

        // 特殊处理上下标的 strut
        container.querySelectorAll('.strut').forEach(el => {
            const computed = window.getComputedStyle(el);
            el.style.height = computed.height;
            el.style.display = 'inline-block';
            el.style.verticalAlign = 'baseline';
        });

        // 特殊处理 .katex-html 确保完整显示
        container.querySelectorAll('.katex-html').forEach(el => {
            el.style.overflow = 'visible';
        });

        // 额外等待确保样式应用
        await new Promise(resolve => setTimeout(resolve, 50));
    }

    /**
     * 等待容器内所有 iconify-icon 图标加载完成，并转换为内联 SVG
     * html2canvas 无法渲染 Shadow DOM，所以需要将图标提取出来
     */
    async _waitForIconsToLoad(container, timeout = 5000) {
        const icons = Array.from(container.querySelectorAll('iconify-icon'));
        if (icons.length === 0) return;

        // 使用 Iconify API 获取 SVG（更可靠）
        for (const icon of icons) {
            const iconName = icon.getAttribute('icon');
            if (!iconName) continue;

            try {
                // 获取计算样式
                const computedStyle = window.getComputedStyle(icon);
                const size = computedStyle.fontSize || '24px';
                const color = computedStyle.color || 'currentColor';

                // 尝试从 Iconify API 获取 SVG
                const [prefix, name] = iconName.includes(':') ? iconName.split(':') : ['carbon', iconName];
                const apiUrl = `https://api.iconify.design/${prefix}/${name}.svg?color=${encodeURIComponent(color)}`;

                const response = await fetch(apiUrl);
                if (response.ok) {
                    const svgText = await response.text();
                    const wrapper = document.createElement('span');
                    wrapper.innerHTML = svgText;
                    const svg = wrapper.querySelector('svg');
                    if (svg) {
                        svg.style.width = size;
                        svg.style.height = size;
                        svg.style.display = 'inline-block';
                        svg.style.verticalAlign = 'middle';
                        svg.style.flexShrink = '0';
                        icon.replaceWith(svg);
                        continue;
                    }
                }
            } catch (e) {
                console.warn('Failed to fetch icon from API:', e);
            }

            // 回退方案：尝试从 Shadow DOM 获取
            const startTime = Date.now();
            while (Date.now() - startTime < timeout) {
                const svg = icon.shadowRoot?.querySelector('svg');
                if (svg) {
                    const clonedSvg = svg.cloneNode(true);
                    const computedStyle = window.getComputedStyle(icon);
                    clonedSvg.style.width = computedStyle.fontSize || '1em';
                    clonedSvg.style.height = computedStyle.fontSize || '1em';
                    clonedSvg.style.color = computedStyle.color;
                    clonedSvg.style.fill = 'currentColor';
                    clonedSvg.style.display = 'inline-block';
                    clonedSvg.style.verticalAlign = 'middle';
                    icon.replaceWith(clonedSvg);
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        // 额外等待确保 DOM 更新
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    _exportHTMLRaw() {
        // 导出 AI 输出的原始 HTML（data-* 格式，无样式处理）
        const htmlContent = this.sampleHTML || '';

        const fullHTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${this.currentProject?.title || 'Presentation'} - 原始 HTML</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: "Source Han Sans SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
            background: #f5f5f5;
            padding: 20px;
        }
        .info-banner {
            background: #fef3c7;
            border: 1px solid #f59e0b;
            color: #92400e;
            padding: 12px 20px;
            border-radius: 8px;
            margin-bottom: 20px;
            max-width: 960px;
            margin-left: auto;
            margin-right: auto;
        }
        section {
            width: 960px;
            height: 540px;
            margin: 20px auto;
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
            overflow: hidden;
            position: relative;
            background: #fff;
        }
        /* 原始 data-* 元素只显示为占位框 */
        [data-el] {
            position: absolute;
            border: 2px dashed #ccc;
            background: rgba(200,200,200,0.1);
            font-size: 12px;
            color: #666;
            padding: 4px;
            overflow: hidden;
        }
        [data-el]::before {
            content: attr(data-el) " | " attr(data-x) "," attr(data-y);
            font-family: monospace;
            font-size: 10px;
            color: #999;
        }
    </style>
    <script src="https://code.iconify.design/iconify-icon/1.0.7/iconify-icon.min.js"></script>
</head>
<body>
<div class="info-banner">
    <strong>⚠️ 原始 HTML 格式</strong><br>
    这是 AI 输出的 data-* 属性格式，尚未经过样式渲染。元素显示为占位框，标注了类型和位置信息。
</div>
${htmlContent}
</body>
</html>`;

        this._downloadHTML(fullHTML, 'raw');
    }

    _exportHTMLRendered() {
        // 导出渲染后的 HTML（带完整内联样式）
        const renderer = new HTMLSlideRenderer();
        const slides = this.slides || [];

        const renderedSlides = slides.map((slide, i) => {
            const content = renderer.render(slide, i);
            // 获取背景样式
            let bgStyle = 'background: #ffffff;';
            if (slide.background) {
                if (slide.background.gradient) {
                    bgStyle = 'background: ' + slide.background.gradient + ';';
                } else if (slide.background.color) {
                    bgStyle = 'background-color: ' + slide.background.color + ';';
                } else if (slide.background.image) {
                    bgStyle = "background-image: url('" + slide.background.image + "'); background-size: cover; background-position: center;";
                }
            }
            return '<section style="width: 960px; height: 540px; position: relative; overflow: hidden; ' + bgStyle + '">' + content + '</section>';
        }).join('\n\n');

        const title = (this.currentProject?.title || 'Presentation') + ' - 渲染后';
        const fullHTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: "Source Han Sans SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
            background: #1a1a2e;
            padding: 40px 20px;
        }
        .info-banner {
            background: #d1fae5;
            border: 1px solid #10b981;
            color: #065f46;
            padding: 12px 20px;
            border-radius: 8px;
            margin-bottom: 20px;
            max-width: 960px;
            margin-left: auto;
            margin-right: auto;
        }
        section {
            margin: 20px auto;
            box-shadow: 0 8px 32px rgba(0,0,0,0.3);
            border-radius: 4px;
        }
    </style>
    <script src="https://code.iconify.design/iconify-icon/1.0.7/iconify-icon.min.js"></script>
</head>
<body>
<div class="info-banner">
    <strong>✅ 渲染后 HTML</strong><br>
    这是经过 HTMLSlideRenderer 处理后的结果，所有 data-* 属性已转换为内联样式。
</div>
${renderedSlides}
</body>
</html>`;

        this._downloadHTML(fullHTML, 'rendered');
    }

    _downloadHTML(content, suffix) {
        const blob = new Blob([content], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const filename = (this.currentProject?.title || 'presentation') + '-' + suffix + '.html';
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    _generateHTMLFromSlides() {
        const renderer = new HTMLSlideRenderer();
        return this.slides.map((slide, i) => {
            const content = renderer.render(slide, i);
            return `<section data-type="${slide.type}" id="slide-${i}">\n${content}\n</section>`;
        }).join('\n\n');
    }

    async _exportImages() {
        if (typeof html2canvas === 'undefined') {
            await this._loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
        }
        if (typeof JSZip === 'undefined') {
            await this._loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
        }

        const zip = new JSZip();
        const slideContainer = document.createElement('div');
        slideContainer.style.cssText = 'position: fixed; left: -9999px; width: 960px; height: 540px;';
        document.body.appendChild(slideContainer);

        const renderer = new HTMLSlideRenderer();

        for (let i = 0; i < this.slides.length; i++) {
            slideContainer.innerHTML = `<div style="width: 960px; height: 540px; overflow: hidden;">${renderer.render(this.slides[i], i)}</div>`;

            // 等待 iconify-icon 加载并转换为内联 SVG
            await this._waitForIconsToLoad(slideContainer);

            const canvas = await html2canvas(slideContainer.firstChild, {
                scale: 2,
                useCORS: true,
                allowTaint: true,
                backgroundColor: '#ffffff'
            });

            const imgData = canvas.toDataURL('image/png').split(',')[1];
            zip.file(`slide-${String(i + 1).padStart(2, '0')}.png`, imgData, { base64: true });
        }

        document.body.removeChild(slideContainer);

        const content = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(content);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.currentProject?.title || 'presentation'}-images.zip`;
        a.click();
        URL.revokeObjectURL(url);
    }

    _loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    // 保留旧的 exportPPTX 方法用于兼容
    exportPPTX() {
        return this.exportAs('pptx');
    }

    async _exportWithSlideSystem() {
        const btn = document.querySelector('.ppt-export-btn');
        const originalContent = btn?.innerHTML;

        btn.disabled = true;
        btn.innerHTML = '<iconify-icon icon="carbon:circle-dash" class="animate-spin"></iconify-icon> 正在打包...';

        try {
            const renderer = new PPTXSlideRenderer();
            const filename = `${this.currentProject?.title || 'presentation'}.pptx`;

            await renderer.render(this.slides, filename);

            btn.innerHTML = '<iconify-icon icon="carbon:checkmark"></iconify-icon> 导出成功';
            btn.style.backgroundColor = 'var(--ppt-success)';
            setTimeout(() => {
                btn.disabled = false;
                btn.innerHTML = originalContent;
                btn.style.backgroundColor = '';
            }, 2000);
        } catch (e) {
            console.error('SlideSystem export error:', e);
            alert('导出失败: ' + e.message);
            btn.disabled = false;
            btn.innerHTML = originalContent;
        }
    }

    _exportLegacy() {
        if (typeof PptxGenJS === 'undefined') {
            alert('PPTX 生成库未加载，请检查网络连接。');
            return;
        }

        const btn = document.querySelector('.ppt-header-right .ppt-btn-primary');
        const originalContent = btn.innerHTML;

        btn.disabled = true;
        btn.innerHTML = '<iconify-icon icon="carbon:circle-dash" class="animate-spin"></iconify-icon> 正在打包...';

        try {
            const pres = new PptxGenJS();
            pres.layout = 'LAYOUT_16x9';
            pres.title = this.currentProject.title || 'Presentation';

            // 尺寸常量
            const SLIDE_W = 10;
            const SLIDE_H = 5.625;

            // 颜色定义
            const COLORS = {
                primary: '4f46e5',
                primaryLight: 'e0e7ff',
                textMain: '0f172a',
                textSecondary: '475569',
                textMuted: '94a3b8',
                success: '16a34a',
                successBg: 'dcfce7',
                danger: 'dc2626',
                dangerBg: 'fee2e2',
                border: 'e2e8f0',
                bgSubtle: 'f8fafc',
                purple: 'faf5ff'
            };

            // Add Slides
            this.slides.forEach(slideData => {
                const slide = pres.addSlide();
                slide.background = { color: 'FFFFFF' };

                const padding = 0.7;  // ~60px
                const contentWidth = SLIDE_W - padding * 2;

                if (slideData.type === 'cover') {
                    // 封面页 - 渐变背景
                    const coverPadding = 0.93;  // ~80px
                    slide.background = { color: COLORS.primary };

                    // 渐变覆盖层
                    slide.addShape('rect', {
                        x: 0, y: 0, w: '100%', h: '100%',
                        fill: { type: 'solid', color: '3b82f6', transparency: 50 },
                        line: { transparency: 100 }
                    });

                    // 右上角装饰圆
                    slide.addShape('ellipse', {
                        x: SLIDE_W - 3.5, y: -1.4, w: 4.6, h: 4.6,
                        fill: { type: 'solid', color: 'FFFFFF', transparency: 90 },
                        line: { transparency: 100 }
                    });

                    // 垂直居中内容
                    const startY = SLIDE_H * 0.35;
                    slide.addText(slideData.title, {
                        x: coverPadding, y: startY, w: SLIDE_W - coverPadding * 2, h: 0.8,
                        fontSize: 44, color: 'FFFFFF', bold: true, align: 'left'
                    });
                    slide.addText(slideData.subtitle || '', {
                        x: coverPadding, y: startY + 0.9, w: SLIDE_W - coverPadding * 2, h: 0.5,
                        fontSize: 22, color: 'FFFFFF', transparency: 20, align: 'left'
                    });
                    slide.addText('Generated by Paper Burner X', {
                        x: coverPadding, y: SLIDE_H - 0.6, w: SLIDE_W - coverPadding * 2, h: 0.3,
                        fontSize: 11, color: 'FFFFFF', transparency: 50, align: 'left'
                    });

                } else if (slideData.type === 'toc') {
                    // 目录页 - 带序号圆圈
                    slide.addText(slideData.title, {
                        x: padding, y: padding, w: contentWidth, h: 0.6,
                        fontSize: 32, color: COLORS.textMain, bold: true
                    });

                    const items = slideData.items || [];
                    const startY = padding + 0.9;
                    const itemHeight = 0.55;

                    items.forEach((item, i) => {
                        const y = startY + i * itemHeight;
                        // 序号圆圈
                        slide.addShape('ellipse', {
                            x: padding, y: y, w: 0.4, h: 0.4,
                            fill: { color: COLORS.primary },
                            line: { transparency: 100 }
                        });
                        slide.addText(String(i + 1), {
                            x: padding, y: y, w: 0.4, h: 0.4,
                            fontSize: 14, color: 'FFFFFF', bold: true, align: 'center', valign: 'middle'
                        });
                        // 文本
                        slide.addText(item, {
                            x: padding + 0.55, y: y, w: contentWidth - 0.55, h: 0.4,
                            fontSize: 20, color: COLORS.textSecondary, valign: 'middle'
                        });
                    });

                } else if (slideData.type === 'stats') {
                    // 数据统计页 - 大数字
                    slide.addText(slideData.title, {
                        x: padding, y: padding, w: contentWidth, h: 0.6,
                        fontSize: 32, color: COLORS.textMain, bold: true
                    });

                    const stats = slideData.stats || [];
                    const cols = Math.min(stats.length, 4);
                    const cardW = (contentWidth - 0.3 * (cols - 1)) / cols;
                    const cardH = 1.8;
                    const startY = (SLIDE_H - cardH) / 2;

                    stats.forEach((stat, i) => {
                        const x = padding + i * (cardW + 0.3);
                        // 数值
                        slide.addText(stat.value, {
                            x: x, y: startY, w: cardW, h: 1,
                            fontSize: 48, color: COLORS.primary, bold: true, align: 'center', valign: 'bottom'
                        });
                        // 标签
                        slide.addText(stat.label, {
                            x: x, y: startY + 1.1, w: cardW, h: 0.5,
                            fontSize: 14, color: COLORS.textSecondary, align: 'center', valign: 'top'
                        });
                    });

                } else if (slideData.type === 'comparison') {
                    // 对比页 - 左右分栏
                    slide.addText(slideData.title, {
                        x: padding, y: padding, w: contentWidth, h: 0.6,
                        fontSize: 32, color: COLORS.textMain, bold: true
                    });

                    const boxW = (contentWidth - 0.4) / 2;
                    const boxH = SLIDE_H - padding * 2 - 1;
                    const boxY = padding + 0.8;

                    // 左侧 - 红色
                    slide.addShape('roundRect', {
                        x: padding, y: boxY, w: boxW, h: boxH,
                        fill: { color: COLORS.dangerBg },
                        line: { transparency: 100 },
                        rectRadius: 0.15
                    });
                    slide.addText(slideData.left?.title || '', {
                        x: padding + 0.3, y: boxY + 0.25, w: boxW - 0.6, h: 0.4,
                        fontSize: 20, color: COLORS.danger, bold: true
                    });
                    const leftItems = (slideData.left?.items || []).map(item => ({
                        text: '✕  ' + item,
                        options: { fontSize: 16, color: '991b1b', breakLine: true }
                    }));
                    slide.addText(leftItems, {
                        x: padding + 0.3, y: boxY + 0.75, w: boxW - 0.6, h: boxH - 1,
                        lineSpacing: 32, valign: 'top'
                    });

                    // 右侧 - 绿色
                    const rightX = padding + boxW + 0.4;
                    slide.addShape('roundRect', {
                        x: rightX, y: boxY, w: boxW, h: boxH,
                        fill: { color: COLORS.successBg },
                        line: { transparency: 100 },
                        rectRadius: 0.15
                    });
                    slide.addText(slideData.right?.title || '', {
                        x: rightX + 0.3, y: boxY + 0.25, w: boxW - 0.6, h: 0.4,
                        fontSize: 20, color: COLORS.success, bold: true
                    });
                    const rightItems = (slideData.right?.items || []).map(item => ({
                        text: '✓  ' + item,
                        options: { fontSize: 16, color: '166534', breakLine: true }
                    }));
                    slide.addText(rightItems, {
                        x: rightX + 0.3, y: boxY + 0.75, w: boxW - 0.6, h: boxH - 1,
                        lineSpacing: 32, valign: 'top'
                    });

                } else if (slideData.type === 'image_text') {
                    // 图文混排页 - 左文右图
                    const halfW = (contentWidth - 0.5) / 2;
                    const centerY = SLIDE_H / 2;

                    // 左侧文字
                    slide.addText(slideData.title, {
                        x: padding, y: centerY - 1.2, w: halfW, h: 0.6,
                        fontSize: 32, color: COLORS.textMain, bold: true
                    });
                    slide.addText(slideData.content || '', {
                        x: padding, y: centerY - 0.4, w: halfW, h: 1.5,
                        fontSize: 18, color: COLORS.textSecondary, lineSpacing: 28
                    });

                    // 右侧图片占位
                    const imgX = padding + halfW + 0.5;
                    const imgH = 2.8;
                    const imgY = (SLIDE_H - imgH) / 2;
                    slide.addShape('roundRect', {
                        x: imgX, y: imgY, w: halfW, h: imgH,
                        fill: { color: COLORS.primaryLight },
                        line: { transparency: 100 },
                        rectRadius: 0.15
                    });
                    slide.addText(slideData.imagePlaceholder || '图片', {
                        x: imgX, y: imgY, w: halfW, h: imgH,
                        fontSize: 16, color: COLORS.primary, align: 'center', valign: 'middle'
                    });

                } else if (slideData.type === 'icon_grid') {
                    // 图标网格页
                    slide.addText(slideData.title, {
                        x: padding, y: padding, w: contentWidth, h: 0.6,
                        fontSize: 32, color: COLORS.textMain, bold: true
                    });

                    const items = slideData.items || [];
                    const cols = Math.min(items.length, 4);
                    const cardW = (contentWidth - 0.3 * (cols - 1)) / cols;
                    const cardH = 2;
                    const startY = padding + 1;

                    items.forEach((item, i) => {
                        const x = padding + i * (cardW + 0.3);
                        // 卡片背景
                        slide.addShape('roundRect', {
                            x: x, y: startY, w: cardW, h: cardH,
                            fill: { color: COLORS.bgSubtle },
                            line: { transparency: 100 },
                            rectRadius: 0.15
                        });
                        // 图标背景
                        const iconSize = 0.6;
                        const iconX = x + (cardW - iconSize) / 2;
                        slide.addShape('roundRect', {
                            x: iconX, y: startY + 0.3, w: iconSize, h: iconSize,
                            fill: { color: COLORS.primaryLight },
                            line: { transparency: 100 },
                            rectRadius: 0.1
                        });
                        // 标题
                        slide.addText(item.title, {
                            x: x, y: startY + 1.1, w: cardW, h: 0.35,
                            fontSize: 16, color: COLORS.textMain, bold: true, align: 'center'
                        });
                        // 描述
                        slide.addText(item.desc, {
                            x: x + 0.1, y: startY + 1.45, w: cardW - 0.2, h: 0.4,
                            fontSize: 12, color: COLORS.textSecondary, align: 'center'
                        });
                    });

                } else if (slideData.type === 'quote') {
                    // 引用页 - 紫色背景
                    slide.background = { color: COLORS.purple };

                    // 引号装饰
                    slide.addText('"', {
                        x: padding, y: 0.8, w: 1, h: 1,
                        fontSize: 72, color: COLORS.primary, transparency: 70
                    });

                    // 引用文本
                    const quote = slideData.quote || '';
                    slide.addText(`"${quote}"`, {
                        x: padding + 0.5, y: (SLIDE_H - 1.5) / 2, w: contentWidth - 1, h: 1.5,
                        fontSize: 26, color: COLORS.textMain, align: 'center', valign: 'middle', italic: true
                    });

                    // 作者信息
                    slide.addText(slideData.author || '', {
                        x: padding, y: SLIDE_H - 1.2, w: contentWidth, h: 0.35,
                        fontSize: 18, color: COLORS.textMain, bold: true, align: 'center'
                    });
                    slide.addText(slideData.company || '', {
                        x: padding, y: SLIDE_H - 0.8, w: contentWidth, h: 0.3,
                        fontSize: 14, color: COLORS.textSecondary, align: 'center'
                    });

                } else if (slideData.type === 'timeline') {
                    // 时间轴页
                    slide.addText(slideData.title, {
                        x: padding, y: padding, w: contentWidth, h: 0.6,
                        fontSize: 32, color: COLORS.textMain, bold: true
                    });

                    const items = slideData.items || [];
                    const cols = items.length;
                    const nodeW = contentWidth / cols;
                    const lineY = SLIDE_H / 2;

                    // 横线
                    slide.addShape('rect', {
                        x: padding, y: lineY - 0.02, w: contentWidth, h: 0.04,
                        fill: { color: COLORS.border },
                        line: { transparency: 100 }
                    });

                    items.forEach((item, i) => {
                        const centerX = padding + nodeW * i + nodeW / 2;
                        // 圆点
                        const circleR = 0.28;
                        slide.addShape('ellipse', {
                            x: centerX - circleR, y: lineY - circleR, w: circleR * 2, h: circleR * 2,
                            fill: { color: COLORS.primary },
                            line: { transparency: 100 }
                        });
                        slide.addText(item.phase, {
                            x: centerX - circleR, y: lineY - circleR, w: circleR * 2, h: circleR * 2,
                            fontSize: 12, color: 'FFFFFF', bold: true, align: 'center', valign: 'middle'
                        });
                        // 标题
                        slide.addText(item.title, {
                            x: centerX - nodeW / 2 + 0.1, y: lineY + 0.4, w: nodeW - 0.2, h: 0.35,
                            fontSize: 16, color: COLORS.textMain, bold: true, align: 'center'
                        });
                        // 描述
                        slide.addText(item.desc, {
                            x: centerX - nodeW / 2 + 0.1, y: lineY + 0.75, w: nodeW - 0.2, h: 0.4,
                            fontSize: 12, color: COLORS.textSecondary, align: 'center'
                        });
                    });

                } else if (slideData.type === 'end') {
                    // 结束页 - 深色背景
                    slide.background = { color: '0f172a' };

                    // 渐变层
                    slide.addShape('rect', {
                        x: 0, y: 0, w: '100%', h: '100%',
                        fill: { type: 'solid', color: '1e293b', transparency: 50 },
                        line: { transparency: 100 }
                    });

                    // 装饰圆
                    slide.addShape('ellipse', {
                        x: SLIDE_W - 3.5, y: -1.4, w: 4.6, h: 4.6,
                        fill: { type: 'solid', color: 'FFFFFF', transparency: 95 },
                        line: { transparency: 100 }
                    });

                    // 内容
                    const centerY = SLIDE_H * 0.4;
                    slide.addText(slideData.title, {
                        x: padding, y: centerY, w: contentWidth, h: 0.8,
                        fontSize: 44, color: 'FFFFFF', bold: true, align: 'left'
                    });
                    slide.addText(slideData.subtitle || '', {
                        x: padding, y: centerY + 0.9, w: contentWidth, h: 0.5,
                        fontSize: 22, color: 'FFFFFF', transparency: 30, align: 'left'
                    });
                    if (slideData.email) {
                        slide.addText(slideData.email, {
                            x: padding, y: centerY + 1.6, w: contentWidth, h: 0.4,
                            fontSize: 16, color: 'FFFFFF', transparency: 50, align: 'left'
                        });
                    }
                    slide.addText('Generated by Paper Burner X', {
                        x: padding, y: SLIDE_H - 0.6, w: contentWidth, h: 0.3,
                        fontSize: 11, color: 'FFFFFF', transparency: 60, align: 'left'
                    });

                } else if (slideData.type === 'list') {
                    // 列表页
                    slide.addText(slideData.title, {
                        x: padding, y: padding, w: contentWidth, h: 0.6,
                        fontSize: 32, color: COLORS.textMain, bold: true
                    });

                    if (slideData.items && slideData.items.length > 0) {
                        const listY = padding + 0.9;
                        const items = slideData.items.map(item => ({
                            text: item,
                            options: { fontSize: 20, color: COLORS.textSecondary, breakLine: true }
                        }));
                        slide.addText(items, {
                            x: padding, y: listY, w: contentWidth, h: SLIDE_H - listY - padding,
                            bullet: { type: 'bullet', code: '2022' },
                            lineSpacing: 40, valign: 'top'
                        });
                    }

                } else {
                    // 默认内容页 - 垂直居中
                    const titleH = 0.6;
                    const contentH = 1.5;
                    const totalH = titleH + 0.3 + contentH;
                    const startY = (SLIDE_H - totalH) / 2;

                    slide.addText(slideData.title, {
                        x: padding, y: startY, w: contentWidth, h: titleH,
                        fontSize: 32, color: COLORS.textMain, bold: true
                    });
                    slide.addText(slideData.content || '', {
                        x: padding, y: startY + titleH + 0.3, w: contentWidth, h: contentH,
                        fontSize: 20, color: COLORS.textSecondary, lineSpacing: 32
                    });
                }
            });

            // Save
            pres.writeFile({ fileName: `${this.currentProject.title || 'presentation'}.pptx` })
                .then(() => {
                    btn.innerHTML = '<iconify-icon icon="carbon:checkmark"></iconify-icon> 导出成功';
                    btn.style.backgroundColor = 'var(--ppt-success)';
                    setTimeout(() => {
                        btn.disabled = false;
                        btn.innerHTML = originalContent;
                        btn.style.backgroundColor = '';
                    }, 2000);
                })
                .catch(err => {
                    console.error(err);
                    alert('导出失败: ' + err.message);
                    btn.disabled = false;
                    btn.innerHTML = originalContent;
                });

        } catch (e) {
            console.error(e);
            alert('生成 PPTX 时发生错误');
            btn.disabled = false;
            btn.innerHTML = originalContent;
        }
    }
}

// Initialize
window.PPTGenerator = new PPTGenerator();
document.addEventListener('DOMContentLoaded', () => {
    if (window.PPTGenerator) window.PPTGenerator.init();
});

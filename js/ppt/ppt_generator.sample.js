const PPT_SAMPLE_HTML = `

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

window.PPT_SAMPLE_HTML = PPT_SAMPLE_HTML;

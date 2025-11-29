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
        
        this.isTodoListExpanded = false;
        
        // DOM Elements
        this.elements = {
            overlay: null,
            container: null
        };

        // Presentation State
        this.currentSlideIndex = 0;
        this.viewMode = 'slide'; // 'slide' or 'outline'

        // 示例 HTML - AI 会输出类似这样的结构 (支持 freeform 自由布局)
        this.sampleHTML = window.PPT_SAMPLE_HTML || "";

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
            if (typeof this.showProjectList === 'function') {
                this.showProjectList();
            } else {
                console.error('showProjectList is not defined on PPTGenerator instance');
            }
        }
    }

    hide() {
        if (this.elements.overlay) {
            this.elements.overlay.classList.add('hidden');
            this.isVisible = false;
            this.currentProject = null;
        }
    }

}

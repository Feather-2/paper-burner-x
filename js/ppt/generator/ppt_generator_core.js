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

        // Workflow Mode: auto (Auto-pilot) | guided | manual
        this.workflowMode = 'auto';

        // Unified ProjectBrief (shared contract across stages)
        this.projectBrief = {
            taskGoal: '',
            projectSummary: '',
            audience: '',
            tone: ''
        };
        
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

    setWorkflowMode(mode) {
        const allowed = new Set(['auto', 'guided', 'manual']);
        const next = allowed.has(mode) ? mode : 'auto';
        this.workflowMode = next;

        if (!this.workflowData) this.workflowData = {};
        this.workflowData.workflowMode = next;
        if (this.currentProject && this.currentProject.workflowData) {
            this.currentProject.workflowData.workflowMode = next;
        }

        this.setAutoSaveNeeded?.();
        this.renderPreviewArea?.();
    }

    setProjectBrief(brief) {
        const b = brief && typeof brief === 'object' ? brief : {};
        const taskGoal = typeof b.taskGoal === 'string' ? b.taskGoal.trim() : '';
        const projectSummary = typeof b.projectSummary === 'string' ? b.projectSummary.trim() : '';
        const audience = typeof b.audience === 'string' ? b.audience.trim() : '';
        const tone = typeof b.tone === 'string' ? b.tone.trim() : '';

        this.projectBrief = { taskGoal, projectSummary, audience, tone };

        if (!this.workflowData) this.workflowData = {};
        this.workflowData.projectBrief = { taskGoal, projectSummary, audience, tone };

        // Backward-compatible fields (existing UI code may read/write these).
        if (projectSummary) this.workflowData.projectSummary = projectSummary;
        if (taskGoal) this.workflowData.taskGoal = taskGoal;
        if (audience) this.workflowData.audience = audience;
        if (tone) this.workflowData.tone = tone;

        if (this.currentProject && this.currentProject.workflowData) {
            this.currentProject.workflowData.projectBrief = { taskGoal, projectSummary, audience, tone };
            if (projectSummary) this.currentProject.workflowData.projectSummary = projectSummary;
            if (taskGoal) this.currentProject.workflowData.taskGoal = taskGoal;
            if (audience) this.currentProject.workflowData.audience = audience;
            if (tone) this.currentProject.workflowData.tone = tone;
        }

        this.setAutoSaveNeeded?.();
        this.renderPreviewArea?.();
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

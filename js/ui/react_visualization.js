/**
 * ReAct Visualization UI
 * Renders the thought process of the ReAct Engine
 */

class ReActVisualization {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            console.error(`ReActVisualization: Container #${containerId} not found`);
            return;
        }
        this.stepsContainer = null;
        this.statusEl = null;
        this.init();
    }

    init() {
        this.container.innerHTML = '';
        this.container.className = 'react-viz-container';
        
        // Header
        const header = document.createElement('div');
        header.className = 'react-viz-header';
        header.innerHTML = `
            <div class="react-viz-title">
                <iconify-icon icon="carbon:ibm-watson-discovery" width="18"></iconify-icon>
                <span>ReAct Reasoning Engine</span>
            </div>
            <div id="react-status" class="react-status-badge react-status-idle">Idle</div>
        `;
        this.container.appendChild(header);

        // Steps Container
        this.stepsContainer = document.createElement('div');
        this.stepsContainer.className = 'react-steps-container';
        this.container.appendChild(this.stepsContainer);

        this.statusEl = this.container.querySelector('#react-status');
    }

    reset() {
        if (this.stepsContainer) {
            this.stepsContainer.innerHTML = '';
        }
        this.updateStatus('Idle', 'react-status-idle');
    }

    updateStatus(text, className) {
        if (this.statusEl) {
            this.statusEl.textContent = text;
            this.statusEl.className = `react-status-badge ${className}`;
        }
    }

    /**
     * Bind to a ReActEngine instance
     * @param {ReActEngine} engine 
     */
    bind(engine) {
        // Session Start
        engine.on('session_start', (data) => {
            this.reset();
            this.updateStatus('Thinking...', 'react-status-thinking');
            this.addSystemMessage(`Goal: ${data.question}`);
        });

        // Iteration Start
        engine.on('iteration_start', (data) => {
            this.updateStatus(`Step ${data.iteration}/${data.maxIterations}: Thinking`, 'react-status-thinking');
        });

        // Reasoning Complete (Thought)
        engine.on('reasoning_complete', (data) => {
            if (data.thought) {
                this.addStep(data.iteration, 'thought', data.thought);
            }
        });

        // Tool Call Start (Action)
        engine.on('tool_call_start', (data) => {
            this.updateStatus(`Step ${data.iteration}: Executing ${data.tool}`, 'react-status-executing');
            const paramsStr = typeof data.params === 'string' ? data.params : JSON.stringify(data.params, null, 2);
            this.addStep(data.iteration, 'action', `Tool: ${data.tool}\nInput: ${paramsStr}`);
        });

        // Tool Call Complete (Observation)
        engine.on('tool_call_complete', (data) => {
            const resultStr = typeof data.result === 'string' ? data.result : JSON.stringify(data.result, null, 2);
            // Truncate long observations for display
            const displayResult = resultStr.length > 500 ? resultStr.slice(0, 500) + '... (truncated)' : resultStr;
            this.addStep(data.iteration, 'observation', displayResult);
        });

        // Final Answer
        engine.on('final_answer', (data) => {
            this.updateStatus('Completed', 'react-status-completed');
            this.addStep('Final', 'answer', data.answer);
        });

        // Error
        engine.on('error', (data) => {
            this.updateStatus('Error', 'react-status-error');
            this.addSystemMessage(`Error: ${data.error}`, 'text-red-500');
        });

        // Context Pruned
        engine.on('context_pruned', (data) => {
            this.addSystemMessage(`Context pruned: ${data.before} -> ${data.after} tokens`);
        });
    }

    addStep(stepNum, type, content) {
        const stepEl = document.createElement('div');
        stepEl.className = 'react-step-item';
        
        let icon = '';
        let title = '';
        let typeClass = '';

        switch (type) {
            case 'thought':
                icon = 'carbon:idea';
                title = `Thought ${stepNum}`;
                typeClass = 'step-thought';
                break;
            case 'action':
                icon = 'carbon:tools';
                title = `Action ${stepNum}`;
                typeClass = 'step-action';
                break;
            case 'observation':
                icon = 'carbon:view';
                title = `Observation ${stepNum}`;
                typeClass = 'step-observation';
                break;
            case 'answer':
                icon = 'carbon:checkmark-filled';
                title = 'Final Answer';
                typeClass = 'step-answer';
                break;
            default:
                typeClass = '';
        }

        stepEl.classList.add(typeClass);
        
        // Format content
        const formattedContent = this.formatContent(content);

        stepEl.innerHTML = `
            <div class="react-step-header">
                <iconify-icon icon="${icon}"></iconify-icon>
                <span>${title}</span>
            </div>
            <div class="react-step-content">${formattedContent}</div>
        `;

        this.stepsContainer.appendChild(stepEl);
        
        // Auto scroll
        this.stepsContainer.scrollTop = this.stepsContainer.scrollHeight;
    }

    addSystemMessage(text) {
        const msg = document.createElement('div');
        msg.className = 'react-system-message';
        msg.textContent = text;
        this.stepsContainer.appendChild(msg);
        this.stepsContainer.scrollTop = this.stepsContainer.scrollHeight;
    }

    formatContent(text) {
        if (!text) return '';
        // Basic escaping to avoid XSS while preserving display
        let safe = text.replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
        
        // Highlight code blocks roughly
        safe = safe.replace(/```([\s\S]*?)```/g, '<code class="block bg-black/5 p-2 rounded my-1">$1</code>');
        safe = safe.replace(/`([^`]+)`/g, '<code class="bg-black/5 px-1 rounded">$1</code>');
        
        return safe;
    }
}

// Export
if (typeof window !== 'undefined') {
    window.ReActVisualization = ReActVisualization;
}

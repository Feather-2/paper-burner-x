/**
 * ReAct Engine
 * Implements Reason + Act loop for complex task solving
 * 
 * This engine follows the ReAct pattern:
 * 1. Thought: Analyze the current situation
 * 2. Action: Decide to use a tool
 * 3. Observation: See the result of the tool
 * 4. Repeat until Final Answer
 */

class ReActEngine {
    /**
     * @param {Object} config
     * @param {number} config.maxSteps - Maximum number of steps before timeout
     * @param {Function} config.llmCaller - Function(prompt) => Promise<string>
     */
    constructor(config = {}) {
        this.maxSteps = config.maxSteps || 10;
        this.llmCaller = config.llmCaller; 
        this.tools = new Map(); 
        this.history = [];
        this.listeners = new Map();
        this.abortController = null;
    }

    /**
     * Register a tool for the engine to use
     * @param {string} name - Tool name (e.g., "Search")
     * @param {string} description - Tool description
     * @param {Function} executeFunc - Async function to execute the tool
     */
    registerTool(name, description, executeFunc) {
        this.tools.set(name, {
            name,
            description,
            execute: executeFunc
        });
    }

    /**
     * Subscribe to engine events
     * @param {string} event - Event name (start, thinking, thought, action_start, action_end, success, error, timeout)
     * @param {Function} callback 
     */
    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);
    }

    emit(event, data) {
        if (this.listeners.has(event)) {
            this.listeners.get(event).forEach(cb => cb(data));
        }
    }

    /**
     * Stop the current execution
     */
    abort() {
        if (this.abortController) {
            this.abortController.abort();
            this.emit('abort', {});
        }
    }

    /**
     * Run the ReAct loop
     * @param {string} goal - The user's question or task
     */
    async run(goal) {
        this.history = [];
        this.abortController = new AbortController();
        this.emit('start', { goal });

        let stepCount = 0;
        
        try {
            while (stepCount < this.maxSteps) {
                if (this.abortController.signal.aborted) {
                    throw new Error('Aborted by user');
                }

                stepCount++;
                
                // 1. Construct Prompt
                const prompt = this.constructPrompt(goal);
                
                // 2. Get Thought and Action from LLM
                this.emit('thinking', { step: stepCount, prompt });
                
                let llmResponse;
                try {
                    llmResponse = await this.llmCaller(prompt, this.abortController.signal);
                } catch (err) {
                    if (err.name === 'AbortError') throw err;
                    throw new Error(`LLM Call failed: ${err.message}`);
                }

                // Clean up response (sometimes LLMs repeat the prompt or add extra newlines)
                llmResponse = llmResponse.trim();
                
                this.emit('thought', { step: stepCount, content: llmResponse });

                // 3. Parse Response
                const parsed = this.parseResponse(llmResponse);
                
                if (parsed.finalAnswer) {
                    this.emit('success', { answer: parsed.finalAnswer, history: this.history });
                    return parsed.finalAnswer;
                }

                if (!parsed.action) {
                    // If no action found, treat as a thought or clarification request
                    // We append it to history so the LLM knows what it just said
                    this.history.push({ type: 'thought', content: parsed.thought || llmResponse });
                    
                    // If the LLM just outputs thoughts without actions for too long, it might be stuck.
                    // But for now we continue.
                    continue; 
                }

                // 4. Execute Action
                const toolName = parsed.action.tool;
                const toolArgs = parsed.action.args;
                
                this.emit('action_start', { step: stepCount, tool: toolName, args: toolArgs });
                
                let observation;
                try {
                    const tool = this.tools.get(toolName);
                    if (!tool) {
                        observation = `Error: Tool '${toolName}' not found. Available tools: ${Array.from(this.tools.keys()).join(', ')}`;
                    } else {
                        observation = await tool.execute(toolArgs);
                    }
                } catch (error) {
                    observation = `Error executing tool '${toolName}': ${error.message}`;
                }

                // Truncate observation if too long to avoid context window issues
                if (typeof observation === 'string' && observation.length > 2000) {
                    observation = observation.substring(0, 2000) + '... (truncated)';
                }

                this.emit('action_end', { step: stepCount, tool: toolName, output: observation });

                // 5. Update History
                this.history.push({
                    type: 'step',
                    thought: parsed.thought,
                    action: parsed.action,
                    observation: observation
                });
            }

            this.emit('timeout', { maxSteps: this.maxSteps });
            throw new Error('Max steps reached without final answer');

        } catch (error) {
            if (error.message === 'Aborted by user') {
                // Handled gracefully
            } else {
                this.emit('error', { error: error.message });
                throw error;
            }
        } finally {
            this.abortController = null;
        }
    }

    constructPrompt(goal) {
        const toolDescriptions = Array.from(this.tools.values())
            .map(t => `${t.name}: ${t.description}`)
            .join('\n');

        let prompt = `Answer the following questions as best you can. You have access to the following tools:

${toolDescriptions}

Use the following format:

Question: the input question you must answer
Thought: you should always think about what to do
Action: the action to take, should be one of [${Array.from(this.tools.keys()).join(', ')}]
Action Input: the input to the action
Observation: the result of the action
... (this Thought/Action/Action Input/Observation can repeat N times)
Thought: I now know the final answer
Final Answer: the final answer to the original input question

Begin!

Question: ${goal}
`;

        for (const step of this.history) {
            if (step.type === 'step') {
                prompt += `Thought: ${step.thought}\n`;
                prompt += `Action: ${step.action.tool}\n`;
                prompt += `Action Input: ${step.action.args}\n`;
                prompt += `Observation: ${step.observation}\n`;
            } else if (step.type === 'thought') {
                prompt += `Thought: ${step.content}\n`;
            }
        }
        
        // Prompt for the next step
        prompt += `Thought:`;

        return prompt;
    }

    parseResponse(response) {
        // Handle case where LLM includes "Thought:" prefix in the response
        let content = response;
        if (content.startsWith('Thought:')) {
            content = content.substring(8).trim();
        }

        // Look for Final Answer
        const finalAnswerRegex = /Final Answer:([\s\S]+)/i;
        const finalMatch = content.match(finalAnswerRegex);
        if (finalMatch) {
            return { finalAnswer: finalMatch[1].trim() };
        }

        // Look for Action and Action Input
        // We look for the LAST occurrence of Action/Action Input if multiple are hallucinated, 
        // but typically we stop generation at Observation so there should be only one.
        const actionRegex = /Action:\s*(.+?)(?:\n|$)/i;
        const inputRegex = /Action Input:\s*([\s\S]+?)(?:\n|$)/i;

        const actionMatch = content.match(actionRegex);
        const inputMatch = content.match(inputRegex);

        if (actionMatch) {
            const tool = actionMatch[1].trim();
            let args = '';
            if (inputMatch) {
                args = inputMatch[1].trim();
            }
            
            // Extract thought (everything before Action)
            const thoughtEndIndex = content.indexOf('Action:');
            const thought = content.substring(0, thoughtEndIndex).trim();

            return {
                thought,
                action: {
                    tool,
                    args
                }
            };
        }

        // If no action, everything is a thought
        return { thought: content };
    }
}

// Export
if (typeof window !== 'undefined') {
    window.ReActEngine = ReActEngine;
}
if (typeof module !== 'undefined') {
    module.exports = ReActEngine;
}
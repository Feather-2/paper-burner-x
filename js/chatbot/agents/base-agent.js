// js/chatbot/agents/base-agent.js
// ---------------------------------
// (Optional) Provides a base class or a set of common utilities
// for other agents if there's significant shared logic.
// For example, common methods for interacting with ChatbotCore,
// logging, or managing agent state.

window.BaseAgent = {
  agentName: "BaseAgent",

  initialize: function(config) {
    console.log(`[${this.agentName}] Initializing with config:`, config);
    this.config = config;
    // Common initialization logic
  },

  log: function(message, level = "info") {
    // Ensure console[level] is a function before calling it
    if (typeof console[level] === 'function') {
      console[level](`[${this.agentName}] ${message}`);
    } else {
      console.info(`[${this.agentName}] ${message}`); // Fallback to info
    }
  },

  // Example utility: Get chatbot configuration safely
  getChatbotConfig: function() {
    if (window.ChatbotCore && typeof window.ChatbotCore.getChatbotConfig === 'function') {
      return window.ChatbotCore.getChatbotConfig();
    }
    this.log("ChatbotCore.getChatbotConfig is not available.", "warn");
    return null;
  },

  // Example utility: Send a simple request to an LLM (non-streaming)
  // This would be a simplified wrapper around ChatbotCore functionalities
  // or direct fetch if an agent needs to operate independently for some tasks.
  askLLM: async function(prompt, systemMessage = "You are a helpful assistant.") {
    this.log(`Asking LLM (mock): ${prompt}`);
    // This is a highly simplified placeholder.
    // In a real scenario, this would integrate with buildCustomApiConfig,
    // handle API keys, model selection, error handling etc., likely via ChatbotCore.
    return new Promise(resolve => {
      setTimeout(() => {
        resolve({
          success: true,
          response: `LLM mock response to: "${prompt.substring(0, 50)}..."`
        });
      }, 500);
    });
  }
};

console.log("BaseAgent loaded.");
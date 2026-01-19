/**
 * JSDoc types for DesignAgentLoop.
 */

/**
 * @typedef {object} DesignLoopConstructorOptions
 * @property {number} [batchSize]
 * @property {import("../../../shared/index.js").Archive|null} [archive]
 * @property {any} [eventBus]
 * @property {Record<string, Function>|null} [tools]
 * @property {any} [memoryStore]
 * @property {any} [stateEngine]
 * @property {any} [container]
 */

/**
 * Minimal Stage API surface used by the design loop.
 * Keep it permissive (JSDoc-only typing) to reduce `checkJs` friction.
 *
 * @typedef {object} DesignStageApi
 * @property {{ runId?: string, constraints?: any, userConfig?: any }=} [runContext]
 * @property {(eventName: string, record: { actor?: string, status?: string, payload?: any }) => void=} [emit]
 * @property {any=} [eventBus]
 * @property {AbortSignal=} [signal]
 * @property {any=} [aiApiService]
 * @property {any=} [modelRouter]
 * @property {any=} [imageService]
 * @property {any=} [imageProvider]
 * @property {any=} [traceContext]
 * @property {any=} [runtimeHints]
 * @property {any=} [flushCompression]
 * @property {any=} [errorBoundaryConfig]
 * @property {boolean=} [errorBoundaryDegrade]
 * @property {boolean=} [degradeOnError]
 * @property {any=} [eventBusBackpressure]
 * @property {any=} [backpressure]
 * @property {any=} [memoryStore]
 * @property {any=} [stateEngine]
 * @property {any=} [watchdog]
 * @property {boolean=} [resumed]
 * @property {any=} [resumeState]
 * @property {any=} [toolExecutor]
 * @property {any=} [tools]
 * @property {boolean=} [enablePlanning]
 * @property {boolean=} [enableLayout]
 * @property {boolean=} [enableFinalReview]
 * @property {any=} [interactionMode]
 * @property {boolean=} [skipReview]
 * @property {any=} [userConfig]
 */

/**
 * @typedef {object} DesignPhaseState
 * @property {string} status
 */

/**
 * @typedef {Error & { code?: any, timeoutMs?: number }} ErrorWithCode
 */

/**
 * @typedef {object} DesignLoopState
 * @property {any} contentPackage
 * @property {any[]} slideIntents
 * @property {any} designSystem
 * @property {Record<string, any>} constraints
 * @property {Record<string, any>} userConfig
 * @property {any} plans
 * @property {any[]} generated
 * @property {any[]} slideHtmls
 * @property {any[]} slidesMeta
 * @property {any[]} imageSlots
 * @property {any[]} visualSlots
 * @property {string} deckHtmlDsl
 * @property {any[]} pendingImages
 * @property {any} brainstormResult
 * @property {any=} layoutData
 * @property {any=} baseDeckHtmlDsl
 * @property {any=} degradedCount
 * @property {any=} finalImageSlots
 * @property {any=} imageReport
 * @property {any=} visualReport
 * @property {any=} refineResult
 * @property {any=} reviewResult
 */

export {};

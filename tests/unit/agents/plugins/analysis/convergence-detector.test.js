import { describe, it, expect, vi, beforeEach } from "vitest";

const loggerMocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

const createLoggerMock = vi.hoisted(() => vi.fn(() => loggerMocks));

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  createLogger: createLoggerMock,
}));

import ConvergenceDetector, {
  ConvergenceDetector as NamedConvergenceDetector,
  tokenize,
  ngrams,
  termFrequency,
  entropy,
  jaccardSimilarity,
  cosineSimilarity,
} from "../../../../../js/agents/plugins/analysis/convergence-detector.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ConvergenceDetector", () => {
  it("exports the class as both named and default", () => {
    expect(ConvergenceDetector).toBe(NamedConvergenceDetector);
  });

  it("initializes with defaults and clamps windowSize boundaries", () => {
    const defaults = new ConvergenceDetector({});
    expect(defaults._windowSize).toBe(5);
    expect(defaults._entropyThreshold).toBe(0.3);
    expect(defaults._similarityThreshold).toBe(0.85);

    const zeroWindow = new ConvergenceDetector({ windowSize: 0 });
    const negativeWindow = new ConvergenceDetector({ windowSize: -1 });
    const stringWindow = new ConvergenceDetector({ windowSize: "3" });
    const maxWindow = new ConvergenceDetector({ windowSize: Number.MAX_SAFE_INTEGER });

    expect(zeroWindow._windowSize).toBe(2);
    expect(negativeWindow._windowSize).toBe(2);
    expect(stringWindow._windowSize).toBe(3);
    expect(maxWindow._windowSize).toBe(Number.MAX_SAFE_INTEGER);

    const invalidCallback = new ConvergenceDetector({ onConvergence: "nope" });
    expect(invalidCallback._onConvergence).toBeNull();
  });

  it("returns safe metrics defaults with empty history", () => {
    const detector = new ConvergenceDetector();
    const metrics = detector.getMetrics();

    expect(metrics).toMatchObject({
      entropy: 1,
      avgSimilarity: 0,
      diversityScore: 1,
      isConverged: false,
      sampleCount: 0,
    });
    expect(metrics.vocabSize).toBeUndefined();
  });

  it("handles nullish, whitespace, and nested inputs without converging", () => {
    const inputs = [null, undefined, "", "   ", { deep: { nest: { value: [] } } }];

    for (const input of inputs) {
      const detector = new ConvergenceDetector();
      const result = detector.addSample(input);

      expect(result.converged).toBe(false);
      expect(result.metrics.sampleCount).toBe(1);
    }
  });

  it("accepts long strings as samples without error", () => {
    const detector = new ConvergenceDetector();
    const longText = "token ".repeat(2000).trim();

    const result = detector.addSample(longText);

    expect(result.converged).toBe(false);
    expect(result.metrics.sampleCount).toBe(1);
  });

  it("detects convergence and calls the callback once", () => {
    const onConvergence = vi.fn();
    const detector = new ConvergenceDetector({ windowSize: 4, onConvergence });

    detector.addSample("repeat");
    detector.addSample("repeat");
    detector.addSample("repeat");
    const finalResult = detector.addSample("repeat");

    expect(finalResult.converged).toBe(true);
    expect(detector.isConverged()).toBe(true);
    expect(onConvergence).toHaveBeenCalledTimes(1);
    expect(loggerMocks.info).toHaveBeenCalledWith(
      "Convergence detected",
      expect.any(Object)
    );

    detector.addSample("repeat");
    expect(onConvergence).toHaveBeenCalledTimes(1);
  });

  it("suggests stopping when converged", () => {
    const detector = new ConvergenceDetector({ windowSize: 4 });

    detector.addSample("repeat");
    detector.addSample("repeat");
    detector.addSample("repeat");
    detector.addSample("repeat");

    const suggestion = detector.getSuggestion();

    expect(suggestion.action).toBe("stop");
    expect(suggestion.reason).toMatch(/Output converged/);
  });

  it("suggests diversifying when outputs are overly similar", () => {
    const detector = new ConvergenceDetector({ windowSize: 4 });

    detector.addSample("alpha beta alpha beta");
    detector.addSample("alpha beta alpha beta");
    detector.addSample("alpha beta alpha beta");
    detector.addSample("alpha beta alpha beta");

    const suggestion = detector.getSuggestion();

    expect(suggestion.action).toBe("diversify");
    expect(suggestion.reason).toMatch(/diversifying/);
  });

  it("suggests focusing when entropy remains high", () => {
    const detector = new ConvergenceDetector({ windowSize: 4 });

    detector.addSample("alpha beta gamma delta epsilon zeta eta theta iota kappa");
    detector.addSample("lambda mu nu xi omicron pi rho sigma tau upsilon");

    const suggestion = detector.getSuggestion();

    expect(suggestion.action).toBe("focus");
    expect(suggestion.reason).toMatch(/High entropy/);
  });

  it("suggests continuing when not converged and not otherwise flagged", () => {
    const detector = new ConvergenceDetector({ windowSize: 4 });

    detector.addSample("repeat");
    detector.addSample("repeat");

    const suggestion = detector.getSuggestion();

    expect(suggestion.action).toBe("continue");
    expect(suggestion.reason).toMatch(/Not yet converged/);
  });

  it("resets history and convergence state", () => {
    const detector = new ConvergenceDetector({ windowSize: 4 });

    detector.addSample("repeat");
    detector.addSample("repeat");
    detector.reset();

    expect(detector.isConverged()).toBe(false);
    expect(detector.getMetrics().sampleCount).toBe(0);
  });

  it("trims history with rapid consecutive calls", () => {
    const detector = new ConvergenceDetector({ windowSize: 2 });

    for (let i = 0; i < 10; i++) {
      detector.addSample(`sample ${i} text`);
    }

    expect(detector.getMetrics().sampleCount).toBe(4);
  });

  it("handles concurrent addSample calls", async () => {
    const detector = new ConvergenceDetector({ windowSize: 10 });
    const inputs = ["alpha", "beta", "gamma", "delta", "epsilon"];

    const results = await Promise.all(
      inputs.map((input) => Promise.resolve(detector.addSample(input)))
    );

    expect(results).toHaveLength(inputs.length);
    expect(detector.getMetrics().sampleCount).toBe(inputs.length);
  });
});

describe("tokenize", () => {
  it("normalizes case, strips punctuation, and filters short tokens", () => {
    const result = tokenize("Hello, WORLD! 123 a");
    expect(result).toEqual(["hello", "world", "123"]);
  });

  it("returns empty array for nullish, empty, whitespace, or non-string values", () => {
    const inputs = [null, undefined, "", "   ", 0, false, [], {}];

    for (const input of inputs) {
      expect(tokenize(input)).toEqual([]);
    }
  });

  it("handles very large input strings", () => {
    const largeInput = "word ".repeat(10000).trim();

    const tokens = tokenize(largeInput);

    expect(tokens.length).toBe(10000);
    expect(tokens[0]).toBe("word");
  });

  it("returns empty array for deeply nested objects", () => {
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    expect(tokenize(deep)).toEqual([]);
  });
});

describe("ngrams", () => {
  it("builds n-grams for token sequences", () => {
    const result = ngrams(["alpha", "beta", "gamma"], 2);
    expect(result).toEqual(["alpha_beta", "beta_gamma"]);
  });

  it("returns the tokens when input is too short", () => {
    expect(ngrams(["solo"], 2)).toEqual(["solo"]);
    expect(ngrams([], 2)).toEqual([]);
  });
});

describe("termFrequency", () => {
  it("counts token frequencies", () => {
    const freq = termFrequency(["alpha", "beta", "alpha"]);

    expect(freq.get("alpha")).toBe(2);
    expect(freq.get("beta")).toBe(1);
    expect(freq.size).toBe(2);
  });

  it("handles empty arrays", () => {
    expect(termFrequency([]).size).toBe(0);
  });

  it("throws for non-iterable inputs", () => {
    expect(() => termFrequency({})).toThrow(TypeError);
  });
});

describe("entropy", () => {
  it("computes entropy for uniform distributions", () => {
    const freq = new Map([
      ["alpha", 1],
      ["beta", 1],
    ]);

    expect(entropy(freq)).toBeCloseTo(1, 5);
  });

  it("returns 0 for empty or zero-count maps", () => {
    expect(entropy(new Map())).toBe(0);
    expect(entropy(new Map([["alpha", 0]]))).toBe(0);
  });

  it("throws for null or undefined", () => {
    expect(() => entropy(null)).toThrow(TypeError);
    expect(() => entropy(undefined)).toThrow(TypeError);
  });
});

describe("jaccardSimilarity", () => {
  it("computes similarity based on intersection and union", () => {
    const result = jaccardSimilarity(new Set(["a", "b"]), new Set(["b", "c"]));
    expect(result).toBeCloseTo(1 / 3, 5);
  });

  it("returns 1 when both sets are empty", () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(1);
  });

  it("returns 0 when one set is empty", () => {
    expect(jaccardSimilarity(new Set(), new Set(["x"]))).toBe(0);
  });
});

describe("cosineSimilarity", () => {
  it("returns 1 for proportional vectors", () => {
    const a = new Map([
      ["x", 1],
      ["y", 2],
    ]);
    const b = new Map([
      ["x", 2],
      ["y", 4],
    ]);

    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
  });

  it("returns 0 for disjoint vectors", () => {
    const a = new Map([["x", 1]]);
    const b = new Map([["y", 1]]);

    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it("returns 0 when both vectors are empty", () => {
    expect(cosineSimilarity(new Map(), new Map())).toBe(0);
  });
});

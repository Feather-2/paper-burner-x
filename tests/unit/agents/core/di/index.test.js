// Verifies DI index re-exports via mocked modules, covering boundaries and errors.
// Focuses on passthrough behavior plus concurrency edge handling for factories.
import { beforeEach, describe, expect, it, vi } from "vitest";

const containerMocks = vi.hoisted(() => ({
  Container: vi.fn(function MockContainer(...args) {
    this.args = args;
  }),
  SINGLETON: Symbol("singleton"),
  TRANSIENT: Symbol("transient"),
  createContainer: vi.fn(),
}));

const defaultsMocks = vi.hoisted(() => ({
  ServiceId: Object.freeze({
    LOGGER: "logger",
    LLM: "llm",
  }),
  createAgentContainer: vi.fn(),
  createTestContainer: vi.fn(),
}));

vi.mock("../../../../../js/agents/core/di/container.js", () => containerMocks);
vi.mock("../../../../../js/agents/core/di/defaults.js", () => defaultsMocks);

import {
  Container,
  SINGLETON,
  TRANSIENT,
  createContainer,
  ServiceId,
  createAgentContainer,
  createTestContainer,
} from "../../../../../js/agents/core/di/index.js";

const boundary = {
  nullValue: null,
  undefinedValue: undefined,
  emptyString: "",
  whitespaceString: "   ",
  emptyArray: [],
  emptyObject: {},
  zero: 0,
  negativeOne: -1,
  maxSafe: Number.MAX_SAFE_INTEGER,
  stringNumber: "123",
  objectAsArray: { 0: "a", length: 1 },
  longString: "x".repeat(10000),
  deepObject: { level1: { level2: { level3: { value: "deep" } } } },
  largeFile: { name: "big.bin", content: "x".repeat(50000) },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Container", () => {
  it("re-exports the Container implementation", () => {
    expect(Container).toBe(containerMocks.Container);
  });

  it("constructs with normal inputs", () => {
    const instance = new Container("config");
    expect(containerMocks.Container).toHaveBeenCalledWith("config");
    expect(instance.args).toEqual(["config"]);
  });

  it("accepts boundary inputs", () => {
    const values = [boundary.emptyString, boundary.emptyArray, boundary.emptyObject];
    values.forEach((value) => {
      new Container(value);
    });
    expect(containerMocks.Container.mock.calls.map((args) => args[0])).toEqual(values);
  });

  it("propagates constructor errors", () => {
    containerMocks.Container.mockImplementationOnce(function () {
      throw new Error("boom");
    });
    expect(() => new Container("bad")).toThrow("boom");
  });
});

describe("SINGLETON", () => {
  it("re-exports the singleton scope", () => {
    expect(SINGLETON).toBe(containerMocks.SINGLETON);
  });
});

describe("TRANSIENT", () => {
  it("re-exports the transient scope", () => {
    expect(TRANSIENT).toBe(containerMocks.TRANSIENT);
  });
});

describe("createContainer", () => {
  it("exposes the underlying implementation", () => {
    expect(createContainer).toBe(containerMocks.createContainer);
  });

  it("returns the underlying value for normal inputs", () => {
    containerMocks.createContainer.mockReturnValueOnce({ id: "ok" });
    const result = createContainer({ name: "agent" });
    expect(result).toEqual({ id: "ok" });
    expect(containerMocks.createContainer).toHaveBeenCalledWith({ name: "agent" });
  });

  it("forwards boundary inputs", () => {
    const values = [
      boundary.nullValue,
      boundary.undefinedValue,
      boundary.emptyString,
      boundary.whitespaceString,
      boundary.emptyArray,
      boundary.emptyObject,
      boundary.zero,
      boundary.negativeOne,
      boundary.maxSafe,
    ];
    values.forEach((value) => {
      createContainer(value);
    });
    expect(containerMocks.createContainer.mock.calls.map((args) => args[0])).toEqual(values);
  });

  it("propagates errors", () => {
    containerMocks.createContainer.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    expect(() => createContainer("bad")).toThrow("boom");
  });
});

describe("ServiceId", () => {
  it("re-exports the service identifiers", () => {
    expect(ServiceId).toBe(defaultsMocks.ServiceId);
  });

  it("provides stable identifiers", () => {
    expect(ServiceId).toEqual({
      LOGGER: "logger",
      LLM: "llm",
    });
  });
});

describe("createAgentContainer", () => {
  it("exposes the underlying implementation", () => {
    expect(createAgentContainer).toBe(defaultsMocks.createAgentContainer);
  });

  it("returns the underlying value for normal inputs", () => {
    defaultsMocks.createAgentContainer.mockReturnValueOnce({ mode: "agent" });
    const result = createAgentContainer({ overrides: { foo: "bar" } });
    expect(result).toEqual({ mode: "agent" });
    expect(defaultsMocks.createAgentContainer).toHaveBeenCalledWith({ overrides: { foo: "bar" } });
  });

  it("forwards type boundary inputs", () => {
    const values = [boundary.stringNumber, boundary.objectAsArray];
    values.forEach((value) => {
      createAgentContainer(value);
    });
    expect(defaultsMocks.createAgentContainer.mock.calls.map((args) => args[0])).toEqual(values);
  });

  it("propagates errors", () => {
    defaultsMocks.createAgentContainer.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    expect(() => createAgentContainer("bad")).toThrow("boom");
  });

  it("handles concurrent calls", async () => {
    defaultsMocks.createAgentContainer
      .mockImplementationOnce(async (value) => `ok:${value}`)
      .mockImplementationOnce(async (value) => `ok:${value}`);

    const results = await Promise.all([
      createAgentContainer("alpha"),
      createAgentContainer("beta"),
    ]);

    expect(results).toEqual(["ok:alpha", "ok:beta"]);
    expect(defaultsMocks.createAgentContainer).toHaveBeenCalledTimes(2);
  });
});

describe("createTestContainer", () => {
  it("exposes the underlying implementation", () => {
    expect(createTestContainer).toBe(defaultsMocks.createTestContainer);
  });

  it("returns the underlying value for normal inputs", () => {
    defaultsMocks.createTestContainer.mockReturnValueOnce({ mode: "test" });
    const result = createTestContainer({ mocks: { foo: "bar" } });
    expect(result).toEqual({ mode: "test" });
    expect(defaultsMocks.createTestContainer).toHaveBeenCalledWith({ mocks: { foo: "bar" } });
  });

  it("forwards resource boundary inputs", () => {
    const values = [boundary.longString, boundary.deepObject, boundary.largeFile];
    values.forEach((value) => {
      createTestContainer(value);
    });
    expect(defaultsMocks.createTestContainer.mock.calls.map((args) => args[0])).toEqual(values);
  });

  it("propagates errors", () => {
    defaultsMocks.createTestContainer.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    expect(() => createTestContainer("bad")).toThrow("boom");
  });

  it("handles rapid consecutive calls", () => {
    const values = ["v1", "v2", "v3", "v4", "v5"];
    values.forEach(() => {
      defaultsMocks.createTestContainer.mockImplementationOnce((value) => `ok:${value}`);
    });

    const results = values.map((value) => createTestContainer(value));

    expect(results).toEqual(values.map((value) => `ok:${value}`));
    expect(defaultsMocks.createTestContainer).toHaveBeenCalledTimes(values.length);
  });
});

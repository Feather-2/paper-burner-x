/**
 * @file tests/unit/agents/stages/design/index.test.js
 * @description js/agents/stages/design/index.js re-export tests.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => {
  const makeFn = (name) => vi.fn((...args) => ({ name, args }));
  const makeClass = (name) => {
    const instances = [];
    const MockClass = class {
      constructor(...args) {
        if (args[0] === "__throw__") {
          throw new Error(`${name} ctor error`);
        }
        this.args = args;
        instances.push(this);
      }
    };
    Object.defineProperty(MockClass, "name", { value: name });
    return { MockClass, instances };
  };
  const makeConst = (label) => Object.freeze({ __tag: label });

  const generateDesignTokens = makeFn("generateDesignTokens");
  const buildSlideHtml = makeFn("buildSlideHtml");
  const generateBatch = makeFn("generateBatch");
  const validateSlide = makeFn("validateSlide");
  const runDesignStage = makeFn("runDesignStage");
  const runReactRefiner = makeFn("runReactRefiner");
  const createToolExecutor = makeFn("createToolExecutor");
  const fillImagePlaceholders = makeFn("fillImagePlaceholders");
  const fillSvgPlaceholders = makeFn("fillSvgPlaceholders");
  const createEditToolExecutor = makeFn("createEditToolExecutor");
  const isValidBrainstormStatus = makeFn("isValidBrainstormStatus");
  const isValidDesignPhase = makeFn("isValidDesignPhase");
  const isValidDesignLoopStatus = makeFn("isValidDesignLoopStatus");
  const isValidSlideStatus = makeFn("isValidSlideStatus");
  const isValidVisualSlotStatus = makeFn("isValidVisualSlotStatus");
  const isValidEditSessionStatus = makeFn("isValidEditSessionStatus");
  const isValidSubAgentStatus = makeFn("isValidSubAgentStatus");
  const isValidReviewStatus = makeFn("isValidReviewStatus");
  const isValidVisualType = makeFn("isValidVisualType");
  const isValidInteractionCheckpoint = makeFn("isValidInteractionCheckpoint");
  const isValidEditOperationType = makeFn("isValidEditOperationType");
  const isValidReviewIssueSeverity = makeFn("isValidReviewIssueSeverity");
  const isValidReviewIssueType = makeFn("isValidReviewIssueType");

  const DesignStage = makeClass("DesignStage");
  const DesignAgentLoop = makeClass("DesignAgentLoop");
  const ImageGenerator = makeClass("ImageGenerator");
  const SVGGenerator = makeClass("SVGGenerator");
  const SlideSubAgent = makeClass("SlideSubAgent");
  const VisualSubAgent = makeClass("VisualSubAgent");
  const AssetRegistry = makeClass("AssetRegistry");
  const EditModeAgentLoop = makeClass("EditModeAgentLoop");
  const EditHistoryManager = makeClass("EditHistoryManager");

  const DESIGN_AGENT_TOOL_DEFINITIONS = Object.freeze([{ id: "design-tool" }]);
  const TOOL_SCHEMAS = makeConst("TOOL_SCHEMAS");
  const EditModeTools = makeConst("EditModeTools");

  const DesignPhase = makeConst("DesignPhase");
  const DESIGN_PHASE_TRANSITIONS = makeConst("DESIGN_PHASE_TRANSITIONS");
  const designPhaseMachine = makeConst("designPhaseMachine");
  const DesignLoopStatus = makeConst("DesignLoopStatus");
  const DESIGN_LOOP_TRANSITIONS = makeConst("DESIGN_LOOP_TRANSITIONS");
  const designLoopMachine = makeConst("designLoopMachine");
  const SlideStatus = makeConst("SlideStatus");
  const SLIDE_STATUS_TRANSITIONS = makeConst("SLIDE_STATUS_TRANSITIONS");
  const slideStatusMachine = makeConst("slideStatusMachine");
  const VisualSlotStatus = makeConst("VisualSlotStatus");
  const VISUAL_SLOT_TRANSITIONS = makeConst("VISUAL_SLOT_TRANSITIONS");
  const visualSlotMachine = makeConst("visualSlotMachine");
  const EditSessionStatus = makeConst("EditSessionStatus");
  const EDIT_SESSION_TRANSITIONS = makeConst("EDIT_SESSION_TRANSITIONS");
  const editSessionMachine = makeConst("editSessionMachine");
  const SubAgentStatus = makeConst("SubAgentStatus");
  const SUB_AGENT_TRANSITIONS = makeConst("SUB_AGENT_TRANSITIONS");
  const subAgentMachine = makeConst("subAgentMachine");
  const ReviewStatus = makeConst("ReviewStatus");
  const REVIEW_TRANSITIONS = makeConst("REVIEW_TRANSITIONS");
  const reviewMachine = makeConst("reviewMachine");

  const VisualType = makeConst("VisualType");
  const InteractionCheckpoint = makeConst("InteractionCheckpoint");
  const EditOperationType = makeConst("EditOperationType");
  const ReviewIssueSeverity = makeConst("ReviewIssueSeverity");
  const ReviewIssueType = makeConst("ReviewIssueType");

  return {
    generateDesignTokens,
    buildSlideHtml,
    generateBatch,
    validateSlide,
    runDesignStage,
    runReactRefiner,
    createToolExecutor,
    fillImagePlaceholders,
    fillSvgPlaceholders,
    createEditToolExecutor,
    isValidBrainstormStatus,
    isValidDesignPhase,
    isValidDesignLoopStatus,
    isValidSlideStatus,
    isValidVisualSlotStatus,
    isValidEditSessionStatus,
    isValidSubAgentStatus,
    isValidReviewStatus,
    isValidVisualType,
    isValidInteractionCheckpoint,
    isValidEditOperationType,
    isValidReviewIssueSeverity,
    isValidReviewIssueType,
    DesignStage: DesignStage.MockClass,
    DesignStageInstances: DesignStage.instances,
    DesignAgentLoop: DesignAgentLoop.MockClass,
    DesignAgentLoopInstances: DesignAgentLoop.instances,
    ImageGenerator: ImageGenerator.MockClass,
    ImageGeneratorInstances: ImageGenerator.instances,
    SVGGenerator: SVGGenerator.MockClass,
    SVGGeneratorInstances: SVGGenerator.instances,
    SlideSubAgent: SlideSubAgent.MockClass,
    SlideSubAgentInstances: SlideSubAgent.instances,
    VisualSubAgent: VisualSubAgent.MockClass,
    VisualSubAgentInstances: VisualSubAgent.instances,
    AssetRegistry: AssetRegistry.MockClass,
    AssetRegistryInstances: AssetRegistry.instances,
    EditModeAgentLoop: EditModeAgentLoop.MockClass,
    EditModeAgentLoopInstances: EditModeAgentLoop.instances,
    EditHistoryManager: EditHistoryManager.MockClass,
    EditHistoryManagerInstances: EditHistoryManager.instances,
    DESIGN_AGENT_TOOL_DEFINITIONS,
    TOOL_SCHEMAS,
    EditModeTools,
    DesignPhase,
    DESIGN_PHASE_TRANSITIONS,
    designPhaseMachine,
    DesignLoopStatus,
    DESIGN_LOOP_TRANSITIONS,
    designLoopMachine,
    SlideStatus,
    SLIDE_STATUS_TRANSITIONS,
    slideStatusMachine,
    VisualSlotStatus,
    VISUAL_SLOT_TRANSITIONS,
    visualSlotMachine,
    EditSessionStatus,
    EDIT_SESSION_TRANSITIONS,
    editSessionMachine,
    SubAgentStatus,
    SUB_AGENT_TRANSITIONS,
    subAgentMachine,
    ReviewStatus,
    REVIEW_TRANSITIONS,
    reviewMachine,
    VisualType,
    InteractionCheckpoint,
    EditOperationType,
    ReviewIssueSeverity,
    ReviewIssueType,
  };
});

vi.mock("../../../../../js/agents/stages/design/generators/design-tokens.js", () => ({
  generateDesignTokens: mocked.generateDesignTokens,
}));
vi.mock("../../../../../js/agents/stages/design/dsl/dsl-builder.js", () => ({
  buildSlideHtml: mocked.buildSlideHtml,
}));
vi.mock("../../../../../js/agents/stages/design/generators/batch-generator.js", () => ({
  generateBatch: mocked.generateBatch,
}));
vi.mock("../../../../../js/agents/stages/design/refiner/qa-validator.js", () => ({
  validateSlide: mocked.validateSlide,
}));
vi.mock("../../../../../js/agents/stages/design/design-agent.js", () => ({
  DesignStage: mocked.DesignStage,
  runDesignStage: mocked.runDesignStage,
}));
vi.mock("../../../../../js/agents/stages/design/agent-loop.js", () => ({
  DesignAgentLoop: mocked.DesignAgentLoop,
  DESIGN_AGENT_TOOL_DEFINITIONS: mocked.DESIGN_AGENT_TOOL_DEFINITIONS,
}));
vi.mock("../../../../../js/agents/stages/design/refiner/react-refiner.js", () => ({
  runReactRefiner: mocked.runReactRefiner,
}));
vi.mock("../../../../../js/agents/stages/design/refiner/react-refiner-tools.js", () => ({
  createToolExecutor: mocked.createToolExecutor,
  TOOL_SCHEMAS: mocked.TOOL_SCHEMAS,
}));
vi.mock("../../../../../js/agents/stages/design/generators/image-generator.js", () => ({
  ImageGenerator: mocked.ImageGenerator,
  fillImagePlaceholders: mocked.fillImagePlaceholders,
}));
vi.mock("../../../../../js/agents/stages/design/generators/svg-generator.js", () => ({
  SVGGenerator: mocked.SVGGenerator,
  fillSvgPlaceholders: mocked.fillSvgPlaceholders,
}));
vi.mock("../../../../../js/agents/stages/design/subagents/index.js", () => ({
  SlideSubAgent: mocked.SlideSubAgent,
  VisualSubAgent: mocked.VisualSubAgent,
  AssetRegistry: mocked.AssetRegistry,
}));
vi.mock("../../../../../js/agents/stages/design/edit-mode/index.js", () => ({
  EditModeAgentLoop: mocked.EditModeAgentLoop,
  EditModeTools: mocked.EditModeTools,
  createEditToolExecutor: mocked.createEditToolExecutor,
  EditHistoryManager: mocked.EditHistoryManager,
}));
vi.mock("../../../../../js/agents/stages/design/states.js", () => ({
  DesignPhase: mocked.DesignPhase,
  DESIGN_PHASE_TRANSITIONS: mocked.DESIGN_PHASE_TRANSITIONS,
  designPhaseMachine: mocked.designPhaseMachine,
  DesignLoopStatus: mocked.DesignLoopStatus,
  DESIGN_LOOP_TRANSITIONS: mocked.DESIGN_LOOP_TRANSITIONS,
  designLoopMachine: mocked.designLoopMachine,
  SlideStatus: mocked.SlideStatus,
  SLIDE_STATUS_TRANSITIONS: mocked.SLIDE_STATUS_TRANSITIONS,
  slideStatusMachine: mocked.slideStatusMachine,
  VisualSlotStatus: mocked.VisualSlotStatus,
  VISUAL_SLOT_TRANSITIONS: mocked.VISUAL_SLOT_TRANSITIONS,
  visualSlotMachine: mocked.visualSlotMachine,
  EditSessionStatus: mocked.EditSessionStatus,
  EDIT_SESSION_TRANSITIONS: mocked.EDIT_SESSION_TRANSITIONS,
  editSessionMachine: mocked.editSessionMachine,
  SubAgentStatus: mocked.SubAgentStatus,
  SUB_AGENT_TRANSITIONS: mocked.SUB_AGENT_TRANSITIONS,
  subAgentMachine: mocked.subAgentMachine,
  ReviewStatus: mocked.ReviewStatus,
  REVIEW_TRANSITIONS: mocked.REVIEW_TRANSITIONS,
  reviewMachine: mocked.reviewMachine,
}));
vi.mock("../../../../../js/agents/stages/design/constants.js", () => ({
  VisualType: mocked.VisualType,
  InteractionCheckpoint: mocked.InteractionCheckpoint,
  EditOperationType: mocked.EditOperationType,
  ReviewIssueSeverity: mocked.ReviewIssueSeverity,
  ReviewIssueType: mocked.ReviewIssueType,
  isValidBrainstormStatus: mocked.isValidBrainstormStatus,
  isValidDesignPhase: mocked.isValidDesignPhase,
  isValidDesignLoopStatus: mocked.isValidDesignLoopStatus,
  isValidSlideStatus: mocked.isValidSlideStatus,
  isValidVisualSlotStatus: mocked.isValidVisualSlotStatus,
  isValidEditSessionStatus: mocked.isValidEditSessionStatus,
  isValidSubAgentStatus: mocked.isValidSubAgentStatus,
  isValidReviewStatus: mocked.isValidReviewStatus,
  isValidVisualType: mocked.isValidVisualType,
  isValidInteractionCheckpoint: mocked.isValidInteractionCheckpoint,
  isValidEditOperationType: mocked.isValidEditOperationType,
  isValidReviewIssueSeverity: mocked.isValidReviewIssueSeverity,
  isValidReviewIssueType: mocked.isValidReviewIssueType,
}));

import {
  generateDesignTokens,
  buildSlideHtml,
  generateBatch,
  validateSlide,
  DesignStage,
  runDesignStage,
  DesignAgentLoop,
  DESIGN_AGENT_TOOL_DEFINITIONS,
  runReactRefiner,
  createToolExecutor,
  TOOL_SCHEMAS,
  ImageGenerator,
  fillImagePlaceholders,
  SVGGenerator,
  fillSvgPlaceholders,
  SlideSubAgent,
  VisualSubAgent,
  AssetRegistry,
  EditModeAgentLoop,
  EditModeTools,
  createEditToolExecutor,
  EditHistoryManager,
  DesignPhase,
  DESIGN_PHASE_TRANSITIONS,
  designPhaseMachine,
  DesignLoopStatus,
  DESIGN_LOOP_TRANSITIONS,
  designLoopMachine,
  SlideStatus,
  SLIDE_STATUS_TRANSITIONS,
  slideStatusMachine,
  VisualSlotStatus,
  VISUAL_SLOT_TRANSITIONS,
  visualSlotMachine,
  EditSessionStatus,
  EDIT_SESSION_TRANSITIONS,
  editSessionMachine,
  SubAgentStatus,
  SUB_AGENT_TRANSITIONS,
  subAgentMachine,
  ReviewStatus,
  REVIEW_TRANSITIONS,
  reviewMachine,
  VisualType,
  InteractionCheckpoint,
  EditOperationType,
  ReviewIssueSeverity,
  ReviewIssueType,
  isValidBrainstormStatus,
  isValidDesignPhase,
  isValidDesignLoopStatus,
  isValidSlideStatus,
  isValidVisualSlotStatus,
  isValidEditSessionStatus,
  isValidSubAgentStatus,
  isValidReviewStatus,
  isValidVisualType,
  isValidInteractionCheckpoint,
  isValidEditOperationType,
  isValidReviewIssueSeverity,
  isValidReviewIssueType,
} from "../../../../../js/agents/stages/design/index.js";

const buildDeepObject = (depth) => {
  const root = { level: 0 };
  let current = root;
  for (let i = 1; i <= depth; i += 1) {
    current.next = { level: i };
    current = current.next;
  }
  return root;
};

const HUGE_STRING = "x".repeat(1024 * 1024);
const HUGE_ARRAY = Array.from({ length: 10000 }, (_, index) => index);
const DEEP_OBJECT = buildDeepObject(40);

const boundaryValues = [
  null,
  undefined,
  "",
  "   ",
  [],
  {},
  0,
  -1,
  Number.MAX_SAFE_INTEGER,
  "123",
  { 0: "a", length: 1 },
  HUGE_STRING,
  HUGE_ARRAY,
  DEEP_OBJECT,
];

const instanceCollections = [
  mocked.DesignStageInstances,
  mocked.DesignAgentLoopInstances,
  mocked.ImageGeneratorInstances,
  mocked.SVGGeneratorInstances,
  mocked.SlideSubAgentInstances,
  mocked.VisualSubAgentInstances,
  mocked.AssetRegistryInstances,
  mocked.EditModeAgentLoopInstances,
  mocked.EditHistoryManagerInstances,
];

beforeEach(() => {
  vi.clearAllMocks();
  for (const instances of instanceCollections) {
    instances.length = 0;
  }
});

const runFunctionExportTests = ({ name, fn, mock }) => {
  describe(name, () => {
    it("re-exports the function and returns its result for normal input", () => {
      const input = { tag: "normal" };
      expect(fn).toBe(mock);
      const result = fn(input, "extra");
      expect(mock).toHaveBeenCalledTimes(1);
      expect(mock).toHaveBeenCalledWith(input, "extra");
      expect(result).toEqual({ name, args: [input, "extra"] });
    });

    it("forwards boundary inputs and supports concurrent/rapid calls", async () => {
      const inputs = boundaryValues.map((value, index) => [value, { index }]);
      const results = await Promise.all(
        inputs.map((args) => Promise.resolve(fn(...args)))
      );

      expect(mock).toHaveBeenCalledTimes(inputs.length);
      inputs.forEach((args, idx) => {
        expect(mock).toHaveBeenNthCalledWith(idx + 1, ...args);
        expect(results[idx]).toEqual({ name, args });
      });

      fn("rapid-1");
      fn("rapid-2");
      expect(mock).toHaveBeenCalledTimes(inputs.length + 2);
      expect(mock).toHaveBeenLastCalledWith("rapid-2");
    });

    it("propagates errors from dependencies", () => {
      const error = new Error(`${name} exploded`);
      mock.mockImplementationOnce(() => {
        throw error;
      });
      expect(() => fn("__throw__")).toThrow(error);
    });
  });
};

const runClassExportTests = ({ name, ClassCtor, mock, instances }) => {
  describe(name, () => {
    it("re-exports the class and constructs normally", () => {
      const options = { tag: "normal" };
      expect(ClassCtor).toBe(mock);
      const instance = new ClassCtor(options);
      expect(instance).toBeInstanceOf(ClassCtor);
      expect(instances).toHaveLength(1);
      expect(instances[0]).toBe(instance);
      expect(instances[0].args).toEqual([options]);
    });

    it("accepts boundary inputs and supports rapid instantiation", async () => {
      const inputs = boundaryValues.map((value, index) => [value, { index }]);
      const created = await Promise.all(
        inputs.map((args) => Promise.resolve(new ClassCtor(...args)))
      );

      expect(instances).toHaveLength(inputs.length);
      created.forEach((instance, idx) => {
        expect(instance.args).toEqual(inputs[idx]);
      });

      const extra = new ClassCtor("rapid-1");
      const extraTwo = new ClassCtor("rapid-2");
      expect(instances).toHaveLength(inputs.length + 2);
      expect(instances[instances.length - 2]).toBe(extra);
      expect(instances[instances.length - 1]).toBe(extraTwo);
    });

    it("propagates constructor errors", () => {
      expect(() => new ClassCtor("__throw__")).toThrow(`${name} ctor error`);
    });
  });
};

const runConstantExportTests = ({ name, value, mock }) => {
  describe(name, () => {
    it("re-exports the constant reference", () => {
      expect(value).toBe(mock);
    });
  });
};

[
  { name: "generateDesignTokens", fn: generateDesignTokens, mock: mocked.generateDesignTokens },
  { name: "buildSlideHtml", fn: buildSlideHtml, mock: mocked.buildSlideHtml },
  { name: "generateBatch", fn: generateBatch, mock: mocked.generateBatch },
  { name: "validateSlide", fn: validateSlide, mock: mocked.validateSlide },
  { name: "runDesignStage", fn: runDesignStage, mock: mocked.runDesignStage },
  { name: "runReactRefiner", fn: runReactRefiner, mock: mocked.runReactRefiner },
  { name: "createToolExecutor", fn: createToolExecutor, mock: mocked.createToolExecutor },
  { name: "fillImagePlaceholders", fn: fillImagePlaceholders, mock: mocked.fillImagePlaceholders },
  { name: "fillSvgPlaceholders", fn: fillSvgPlaceholders, mock: mocked.fillSvgPlaceholders },
  { name: "createEditToolExecutor", fn: createEditToolExecutor, mock: mocked.createEditToolExecutor },
  { name: "isValidBrainstormStatus", fn: isValidBrainstormStatus, mock: mocked.isValidBrainstormStatus },
  { name: "isValidDesignPhase", fn: isValidDesignPhase, mock: mocked.isValidDesignPhase },
  { name: "isValidDesignLoopStatus", fn: isValidDesignLoopStatus, mock: mocked.isValidDesignLoopStatus },
  { name: "isValidSlideStatus", fn: isValidSlideStatus, mock: mocked.isValidSlideStatus },
  { name: "isValidVisualSlotStatus", fn: isValidVisualSlotStatus, mock: mocked.isValidVisualSlotStatus },
  { name: "isValidEditSessionStatus", fn: isValidEditSessionStatus, mock: mocked.isValidEditSessionStatus },
  { name: "isValidSubAgentStatus", fn: isValidSubAgentStatus, mock: mocked.isValidSubAgentStatus },
  { name: "isValidReviewStatus", fn: isValidReviewStatus, mock: mocked.isValidReviewStatus },
  { name: "isValidVisualType", fn: isValidVisualType, mock: mocked.isValidVisualType },
  { name: "isValidInteractionCheckpoint", fn: isValidInteractionCheckpoint, mock: mocked.isValidInteractionCheckpoint },
  { name: "isValidEditOperationType", fn: isValidEditOperationType, mock: mocked.isValidEditOperationType },
  { name: "isValidReviewIssueSeverity", fn: isValidReviewIssueSeverity, mock: mocked.isValidReviewIssueSeverity },
  { name: "isValidReviewIssueType", fn: isValidReviewIssueType, mock: mocked.isValidReviewIssueType },
].forEach(runFunctionExportTests);

[
  {
    name: "DesignStage",
    ClassCtor: DesignStage,
    mock: mocked.DesignStage,
    instances: mocked.DesignStageInstances,
  },
  {
    name: "DesignAgentLoop",
    ClassCtor: DesignAgentLoop,
    mock: mocked.DesignAgentLoop,
    instances: mocked.DesignAgentLoopInstances,
  },
  {
    name: "ImageGenerator",
    ClassCtor: ImageGenerator,
    mock: mocked.ImageGenerator,
    instances: mocked.ImageGeneratorInstances,
  },
  {
    name: "SVGGenerator",
    ClassCtor: SVGGenerator,
    mock: mocked.SVGGenerator,
    instances: mocked.SVGGeneratorInstances,
  },
  {
    name: "SlideSubAgent",
    ClassCtor: SlideSubAgent,
    mock: mocked.SlideSubAgent,
    instances: mocked.SlideSubAgentInstances,
  },
  {
    name: "VisualSubAgent",
    ClassCtor: VisualSubAgent,
    mock: mocked.VisualSubAgent,
    instances: mocked.VisualSubAgentInstances,
  },
  {
    name: "AssetRegistry",
    ClassCtor: AssetRegistry,
    mock: mocked.AssetRegistry,
    instances: mocked.AssetRegistryInstances,
  },
  {
    name: "EditModeAgentLoop",
    ClassCtor: EditModeAgentLoop,
    mock: mocked.EditModeAgentLoop,
    instances: mocked.EditModeAgentLoopInstances,
  },
  {
    name: "EditHistoryManager",
    ClassCtor: EditHistoryManager,
    mock: mocked.EditHistoryManager,
    instances: mocked.EditHistoryManagerInstances,
  },
].forEach(runClassExportTests);

[
  {
    name: "DESIGN_AGENT_TOOL_DEFINITIONS",
    value: DESIGN_AGENT_TOOL_DEFINITIONS,
    mock: mocked.DESIGN_AGENT_TOOL_DEFINITIONS,
  },
  { name: "TOOL_SCHEMAS", value: TOOL_SCHEMAS, mock: mocked.TOOL_SCHEMAS },
  { name: "EditModeTools", value: EditModeTools, mock: mocked.EditModeTools },
  { name: "DesignPhase", value: DesignPhase, mock: mocked.DesignPhase },
  {
    name: "DESIGN_PHASE_TRANSITIONS",
    value: DESIGN_PHASE_TRANSITIONS,
    mock: mocked.DESIGN_PHASE_TRANSITIONS,
  },
  { name: "designPhaseMachine", value: designPhaseMachine, mock: mocked.designPhaseMachine },
  { name: "DesignLoopStatus", value: DesignLoopStatus, mock: mocked.DesignLoopStatus },
  {
    name: "DESIGN_LOOP_TRANSITIONS",
    value: DESIGN_LOOP_TRANSITIONS,
    mock: mocked.DESIGN_LOOP_TRANSITIONS,
  },
  { name: "designLoopMachine", value: designLoopMachine, mock: mocked.designLoopMachine },
  { name: "SlideStatus", value: SlideStatus, mock: mocked.SlideStatus },
  {
    name: "SLIDE_STATUS_TRANSITIONS",
    value: SLIDE_STATUS_TRANSITIONS,
    mock: mocked.SLIDE_STATUS_TRANSITIONS,
  },
  { name: "slideStatusMachine", value: slideStatusMachine, mock: mocked.slideStatusMachine },
  { name: "VisualSlotStatus", value: VisualSlotStatus, mock: mocked.VisualSlotStatus },
  {
    name: "VISUAL_SLOT_TRANSITIONS",
    value: VISUAL_SLOT_TRANSITIONS,
    mock: mocked.VISUAL_SLOT_TRANSITIONS,
  },
  { name: "visualSlotMachine", value: visualSlotMachine, mock: mocked.visualSlotMachine },
  { name: "EditSessionStatus", value: EditSessionStatus, mock: mocked.EditSessionStatus },
  {
    name: "EDIT_SESSION_TRANSITIONS",
    value: EDIT_SESSION_TRANSITIONS,
    mock: mocked.EDIT_SESSION_TRANSITIONS,
  },
  { name: "editSessionMachine", value: editSessionMachine, mock: mocked.editSessionMachine },
  { name: "SubAgentStatus", value: SubAgentStatus, mock: mocked.SubAgentStatus },
  {
    name: "SUB_AGENT_TRANSITIONS",
    value: SUB_AGENT_TRANSITIONS,
    mock: mocked.SUB_AGENT_TRANSITIONS,
  },
  { name: "subAgentMachine", value: subAgentMachine, mock: mocked.subAgentMachine },
  { name: "ReviewStatus", value: ReviewStatus, mock: mocked.ReviewStatus },
  { name: "REVIEW_TRANSITIONS", value: REVIEW_TRANSITIONS, mock: mocked.REVIEW_TRANSITIONS },
  { name: "reviewMachine", value: reviewMachine, mock: mocked.reviewMachine },
  { name: "VisualType", value: VisualType, mock: mocked.VisualType },
  {
    name: "InteractionCheckpoint",
    value: InteractionCheckpoint,
    mock: mocked.InteractionCheckpoint,
  },
  { name: "EditOperationType", value: EditOperationType, mock: mocked.EditOperationType },
  {
    name: "ReviewIssueSeverity",
    value: ReviewIssueSeverity,
    mock: mocked.ReviewIssueSeverity,
  },
  { name: "ReviewIssueType", value: ReviewIssueType, mock: mocked.ReviewIssueType },
].forEach(runConstantExportTests);

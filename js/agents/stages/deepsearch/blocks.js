import { runDeepSearchScanStage } from "./scan.js";
import { runDeepSearchTodosStage } from "./todos.js";
import { runDeepSearchRetrieveStage } from "./retrieve.js";
import { runDeepSearchUnderstandStage } from "./understand.js";
import { runDeepSearchWriteStage } from "./write.js";
import { runDeepSearchCondenseStage } from "./condense.js";
import {
  ScanBlockManifest,
  TodosBlockManifest,
  RetrieveBlockManifest,
  UnderstandBlockManifest,
  WriteBlockManifest,
  CondenseBlockManifest,
} from "../../shared/block-manifest.js";

export function registerDeepSearchBlocks(registry) {
  registry.registerWithExecutor(ScanBlockManifest, runDeepSearchScanStage);
  registry.registerWithExecutor(TodosBlockManifest, runDeepSearchTodosStage);
  registry.registerWithExecutor(RetrieveBlockManifest, runDeepSearchRetrieveStage);
  registry.registerWithExecutor(UnderstandBlockManifest, runDeepSearchUnderstandStage);
  registry.registerWithExecutor(WriteBlockManifest, runDeepSearchWriteStage);
  registry.registerWithExecutor(CondenseBlockManifest, runDeepSearchCondenseStage);
}

export const DEEPSEARCH_DAG = {
  nodes: [
    { id: "scan", block: "scan", dependsOn: [] },
    { id: "todos", block: "todos", dependsOn: ["scan"] },
    { id: "retrieve", block: "retrieve", dependsOn: ["todos"] },
    { id: "understand", block: "understand", dependsOn: ["retrieve"] },
    { id: "write", block: "write", dependsOn: ["understand"] },
    { id: "condense", block: "condense", dependsOn: ["understand"] },
  ],
};

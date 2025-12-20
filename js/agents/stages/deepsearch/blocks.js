import { runDeepSearchScanStage } from "./scan.js";
import { runDeepSearchGapsStage } from "./gaps.js";
import { runDeepSearchRetrieveStage } from "./retrieve.js";
import { runDeepSearchUnderstandStage } from "./understand.js";
import { runDeepSearchWriteStage } from "./write.js";
import { runDeepSearchCondenseStage } from "./condense.js";
import {
  ScanBlockManifest,
  GapsBlockManifest,
  RetrieveBlockManifest,
  UnderstandBlockManifest,
  WriteBlockManifest,
  CondenseBlockManifest,
} from "../../shared/block-manifest.js";

export function registerDeepSearchBlocks(registry) {
  registry.registerWithExecutor(ScanBlockManifest, runDeepSearchScanStage);
  registry.registerWithExecutor(GapsBlockManifest, runDeepSearchGapsStage);
  registry.registerWithExecutor(RetrieveBlockManifest, runDeepSearchRetrieveStage);
  registry.registerWithExecutor(UnderstandBlockManifest, runDeepSearchUnderstandStage);
  registry.registerWithExecutor(WriteBlockManifest, runDeepSearchWriteStage);
  registry.registerWithExecutor(CondenseBlockManifest, runDeepSearchCondenseStage);
}

export const DEEPSEARCH_DAG = {
  nodes: [
    { id: "scan", block: "scan", dependsOn: [] },
    { id: "gaps", block: "gaps", dependsOn: ["scan"] },
    { id: "retrieve", block: "retrieve", dependsOn: ["gaps"] },
    { id: "understand", block: "understand", dependsOn: ["retrieve"] },
    { id: "write", block: "write", dependsOn: ["understand"] },
    { id: "condense", block: "condense", dependsOn: ["understand"] },
  ],
};

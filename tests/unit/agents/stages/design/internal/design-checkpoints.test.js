import { describe, it, expect } from "vitest";

import { DesignCheckpoints } from "../../../../../../js/agents/stages/design/internal/design-checkpoints.js";

describe("DesignCheckpoints", () => {
  it("caps versions by maxVersions and keeps latest entries", () => {
    const checkpoints = new DesignCheckpoints({ maxVersions: 3 });

    checkpoints.saveVersion(null, "v1", { idx: 1 });
    checkpoints.saveVersion(null, "v2", { idx: 2 });
    checkpoints.saveVersion(null, "v3", { idx: 3 });
    checkpoints.saveVersion(null, "v4", { idx: 4 });

    expect(checkpoints.versions.map((v) => v.label)).toEqual(["v2", "v3", "v4"]);
    expect(checkpoints.versions).toHaveLength(3);
  });

  it("applies cap when versions are assigned or restored from json", () => {
    const checkpoints = new DesignCheckpoints({ maxVersions: 2 });
    checkpoints.versions = [
      { label: "a", snapshot: { n: 1 }, timestamp: 1 },
      { label: "b", snapshot: { n: 2 }, timestamp: 2 },
      { label: "c", snapshot: { n: 3 }, timestamp: 3 },
    ];
    expect(checkpoints.versions.map((v) => v.label)).toEqual(["b", "c"]);

    checkpoints.fromJSON({
      versions: [
        { label: "x", snapshot: { n: 1 }, timestamp: 1 },
        { label: "y", snapshot: { n: 2 }, timestamp: 2 },
        { label: "z", snapshot: { n: 3 }, timestamp: 3 },
      ],
    });
    expect(checkpoints.versions.map((v) => v.label)).toEqual(["y", "z"]);
  });
});

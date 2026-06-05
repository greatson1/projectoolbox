import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "./app";

describe("useAppStore — dismissedArtefacts", () => {
  beforeEach(() => {
    useAppStore.setState({ dismissedArtefacts: {} });
  });

  it("starts empty", () => {
    expect(useAppStore.getState().dismissedArtefacts).toEqual({});
  });

  it("dismissArtefact adds a name under the right key", () => {
    useAppStore.getState().dismissArtefact("proj-1", "Initiation", "Communication Plan");
    expect(useAppStore.getState().dismissedArtefacts).toEqual({
      "proj-1::Initiation": ["Communication Plan"],
    });
  });

  it("dismissArtefact is idempotent for the same name", () => {
    const s = useAppStore.getState();
    s.dismissArtefact("p", "Phase", "Doc");
    s.dismissArtefact("p", "Phase", "Doc");
    expect(useAppStore.getState().dismissedArtefacts["p::Phase"]).toEqual(["Doc"]);
  });

  it("dismissArtefact namespaces by project AND phase", () => {
    const s = useAppStore.getState();
    s.dismissArtefact("p1", "Initiation", "A");
    s.dismissArtefact("p1", "Execution", "A");
    s.dismissArtefact("p2", "Initiation", "A");
    const got = useAppStore.getState().dismissedArtefacts;
    expect(Object.keys(got).sort()).toEqual(["p1::Execution", "p1::Initiation", "p2::Initiation"]);
  });

  it("ignores empty inputs", () => {
    const s = useAppStore.getState();
    s.dismissArtefact("", "Phase", "Doc");
    s.dismissArtefact("p", "", "Doc");
    s.dismissArtefact("p", "Phase", "");
    expect(useAppStore.getState().dismissedArtefacts).toEqual({});
  });

  it("restoreAllArtefacts clears just the targeted key", () => {
    const s = useAppStore.getState();
    s.dismissArtefact("p1", "Initiation", "A");
    s.dismissArtefact("p1", "Execution", "B");
    s.restoreAllArtefacts("p1", "Initiation");
    const got = useAppStore.getState().dismissedArtefacts;
    expect(got["p1::Initiation"]).toBeUndefined();
    expect(got["p1::Execution"]).toEqual(["B"]);
  });

  it("restoreAllArtefacts is a no-op for unknown keys", () => {
    useAppStore.getState().restoreAllArtefacts("nope", "nada");
    expect(useAppStore.getState().dismissedArtefacts).toEqual({});
  });
});

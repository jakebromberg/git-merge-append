import { describe, it, expect } from "vitest";
import { parseArgs } from "../src/cli.js";
import { runResolve, type ResolveDeps } from "../src/resolve.js";

type Stages = Record<string, { 1: string; 2: string; 3: string }>;

function makeDeps(stages: Stages): {
  deps: ResolveDeps;
  writes: Record<string, string>;
  added: string[];
} {
  const writes: Record<string, string> = {};
  const added: string[] = [];
  const deps: ResolveDeps = {
    lsUnmergedFiles: () => Object.keys(stages),
    showStage: (stage, path) => {
      const file = stages[path];
      if (!file) throw new Error(`no stages for ${path}`);
      return file[stage];
    },
    writeFile: (p, c) => {
      writes[p] = c;
    },
    addFile: (p) => {
      added.push(p);
    },
  };
  return { deps, writes, added };
}

function wrap(entries: unknown[]): string {
  return JSON.stringify({ version: "5", entries }, null, 2) + "\n";
}

const resolveArgs = [
  "resolve",
  "--array-path", "entries",
  "--key", "idx",
  "--sort-by", "idx",
];

describe("parseArgs — resolve subcommand", () => {
  it("parses spec flags with no paths (resolve all unmerged)", () => {
    const parsed = parseArgs(resolveArgs);
    expect(parsed).toEqual({
      kind: "resolve",
      spec: { arrayPath: "entries", key: "idx", sortBy: "idx" },
      paths: [],
    });
  });

  it("parses spec flags with explicit paths after --", () => {
    const parsed = parseArgs([...resolveArgs, "--", "a.json", "b.json"]);
    expect(parsed.kind).toBe("resolve");
    if (parsed.kind !== "resolve") return;
    expect(parsed.paths).toEqual(["a.json", "b.json"]);
  });

  it("errors when --key is missing", () => {
    const parsed = parseArgs(["resolve", "--array-path", "entries"]);
    expect(parsed.kind).toBe("error");
  });
});

describe("runResolve", () => {
  it("resolves all unmerged paths cleanly when entries are disjoint", () => {
    const stages: Stages = {
      "x.json": {
        1: wrap([{ idx: 0 }]),
        2: wrap([{ idx: 0 }, { idx: 1 }]),
        3: wrap([{ idx: 0 }, { idx: 2 }]),
      },
    };
    const { deps, writes, added } = makeDeps(stages);
    const code = runResolve(parseArgs(resolveArgs) as never, deps, () => {}, () => {});
    expect(code).toBe(0);
    expect(writes["x.json"]).toBeDefined();
    expect(added).toEqual(["x.json"]);
    expect(JSON.parse(writes["x.json"]!).entries).toEqual([
      { idx: 0 }, { idx: 1 }, { idx: 2 },
    ]);
  });

  it("returns 0 when there are no unmerged paths", () => {
    const { deps, added } = makeDeps({});
    const code = runResolve(parseArgs(resolveArgs) as never, deps, () => {}, () => {});
    expect(code).toBe(0);
    expect(added).toEqual([]);
  });

  it("resolves multiple unmerged paths in one invocation", () => {
    const stages: Stages = {
      "a.json": {
        1: wrap([{ idx: 0 }]),
        2: wrap([{ idx: 0 }, { idx: 1 }]),
        3: wrap([{ idx: 0 }, { idx: 2 }]),
      },
      "b.json": {
        1: wrap([{ idx: 10 }]),
        2: wrap([{ idx: 10 }, { idx: 11 }]),
        3: wrap([{ idx: 10 }, { idx: 12 }]),
      },
    };
    const { deps, added } = makeDeps(stages);
    const code = runResolve(parseArgs(resolveArgs) as never, deps, () => {}, () => {});
    expect(code).toBe(0);
    expect(added.sort()).toEqual(["a.json", "b.json"]);
  });

  it("leaves a file unmerged on algorithmic conflict and exits non-zero", () => {
    const stages: Stages = {
      "x.json": {
        1: wrap([{ idx: 0 }]),
        2: wrap([{ idx: 0 }, { idx: 1, tag: "ours" }]),
        3: wrap([{ idx: 0 }, { idx: 1, tag: "theirs" }]),
      },
    };
    const { deps, writes, added } = makeDeps(stages);
    const errs: string[] = [];
    const code = runResolve(parseArgs(resolveArgs) as never, deps, () => {}, (m) => errs.push(m));
    expect(code).not.toBe(0);
    expect(writes["x.json"]).toBeUndefined();
    expect(added).not.toContain("x.json");
    expect(errs.join("\n")).toMatch(/idx=1/);
  });

  it("only resolves files in --paths when explicit paths are given", () => {
    const stages: Stages = {
      "a.json": {
        1: wrap([]),
        2: wrap([{ idx: 1 }]),
        3: wrap([{ idx: 2 }]),
      },
      "b.json": {
        1: wrap([]),
        2: wrap([{ idx: 11 }]),
        3: wrap([{ idx: 12 }]),
      },
    };
    const { deps, added } = makeDeps(stages);
    const code = runResolve(
      parseArgs([...resolveArgs, "--", "a.json"]) as never,
      deps,
      () => {},
      () => {},
    );
    expect(code).toBe(0);
    expect(added).toEqual(["a.json"]);
  });
});

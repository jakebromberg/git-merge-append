import { describe, it, expect } from "vitest";
import { parseArgs, runCli, type CliDeps } from "../src/cli.js";

function makeDeps(files: Record<string, string>): {
  deps: CliDeps;
  writes: Record<string, string>;
  errs: string[];
  logs: string[];
} {
  const writes: Record<string, string> = {};
  const errs: string[] = [];
  const logs: string[] = [];
  const deps: CliDeps = {
    readFile: (p) => {
      const content = files[p];
      if (content === undefined) throw new Error(`ENOENT: ${p}`);
      return content;
    },
    writeFile: (p, c) => {
      writes[p] = c;
    },
    log: (m) => logs.push(m),
    err: (m) => errs.push(m),
  };
  return { deps, writes, errs, logs };
}

const driverArgs = [
  "driver",
  "--array-path", "entries",
  "--key", "idx",
  "--sort-by", "idx",
  "--", "/b", "/o", "/t",
];

function wrap(entries: unknown[]): string {
  return JSON.stringify({ version: "5", entries }, null, 2) + "\n";
}

describe("runCli — driver", () => {
  it("clean merge writes result to <ours> and exits 0", () => {
    const { deps, writes } = makeDeps({
      "/b": wrap([{ idx: 0 }]),
      "/o": wrap([{ idx: 0 }, { idx: 1 }]),
      "/t": wrap([{ idx: 0 }, { idx: 2 }]),
    });
    const code = runCli(parseArgs(driverArgs), deps);
    expect(code).toBe(0);
    expect(writes["/o"]).toBeDefined();
    const merged = JSON.parse(writes["/o"]!);
    expect(merged.entries).toEqual([{ idx: 0 }, { idx: 1 }, { idx: 2 }]);
  });

  it("conflict exits 1 and does not write the result file", () => {
    const { deps, writes, errs } = makeDeps({
      "/b": wrap([{ idx: 0 }]),
      "/o": wrap([{ idx: 0 }, { idx: 1, tag: "ours" }]),
      "/t": wrap([{ idx: 0 }, { idx: 1, tag: "theirs" }]),
    });
    const code = runCli(parseArgs(driverArgs), deps);
    expect(code).toBe(1);
    expect(writes["/o"]).toBeUndefined();
    expect(errs.some((e) => /idx=1/.test(e))).toBe(true);
  });

  it("malformed JSON exits 2", () => {
    const { deps, errs } = makeDeps({
      "/b": "not json",
      "/o": wrap([]),
      "/t": wrap([]),
    });
    const code = runCli(parseArgs(driverArgs), deps);
    expect(code).toBe(2);
    expect(errs.some((e) => /invalid input/i.test(e))).toBe(true);
  });

  it("missing input file exits 2", () => {
    const { deps, errs } = makeDeps({
      "/b": wrap([]),
      "/o": wrap([]),
      // /t not present
    });
    const code = runCli(parseArgs(driverArgs), deps);
    expect(code).toBe(2);
    expect(errs.some((e) => /failed to read/i.test(e))).toBe(true);
  });
});

describe("runCli — reserved and help", () => {
  it("install with no args returns a usage error (exits 2)", () => {
    const { deps, errs } = makeDeps({});
    const code = runCli(parseArgs(["install"]), deps);
    expect(code).toBe(2);
    expect(errs.some((e) => /--name/.test(e))).toBe(true);
  });

  it("--help exits 0 and prints help", () => {
    const { deps, logs } = makeDeps({});
    const code = runCli(parseArgs(["--help"]), deps);
    expect(code).toBe(0);
    expect(logs.join("\n")).toMatch(/Usage:/);
  });

  it("usage error exits 2", () => {
    const { deps, errs } = makeDeps({});
    const code = runCli(parseArgs(["bogus"]), deps);
    expect(code).toBe(2);
    expect(errs.join("\n")).toMatch(/bogus/);
  });
});

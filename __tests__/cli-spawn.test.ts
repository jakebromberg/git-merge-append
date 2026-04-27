import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI_PATH = join(__dirname, "..", "dist", "src", "cli.js");

function wrap(entries: unknown[]): string {
  return JSON.stringify({ version: "5", entries }, null, 2) + "\n";
}

describe("CLI binary (built dist/src/cli.js)", () => {
  beforeAll(() => {
    if (!existsSync(CLI_PATH)) {
      throw new Error(
        `Built CLI not found at ${CLI_PATH}. Run "npm run build" before running this test.`,
      );
    }
  });

  it("has a Node shebang on line 1", () => {
    const firstLine = readFileSync(CLI_PATH, "utf8").split("\n")[0];
    expect(firstLine).toBe("#!/usr/bin/env node");
  });

  it("merges concurrent appends and exits 0", () => {
    const dir = mkdtempSync(join(tmpdir(), "git-merge-append-spawn-"));
    const base = join(dir, "base.json");
    const ours = join(dir, "ours.json");
    const theirs = join(dir, "theirs.json");
    writeFileSync(base, wrap([{ idx: 0, tag: "init" }]));
    writeFileSync(ours, wrap([{ idx: 0, tag: "init" }, { idx: 1, tag: "ours" }]));
    writeFileSync(theirs, wrap([{ idx: 0, tag: "init" }, { idx: 2, tag: "theirs" }]));

    const r = spawnSync(
      process.execPath,
      [
        CLI_PATH,
        "driver",
        "--array-path", "entries",
        "--key", "idx",
        "--sort-by", "idx",
        "--", base, ours, theirs,
      ],
      { encoding: "utf8" },
    );
    expect(r.status).toBe(0);
    const merged = JSON.parse(readFileSync(ours, "utf8"));
    expect(merged.entries.map((e: { idx: number }) => e.idx)).toEqual([0, 1, 2]);
  });

  it("exits 1 on a same-key divergent conflict and leaves <ours> unchanged", () => {
    const dir = mkdtempSync(join(tmpdir(), "git-merge-append-spawn-"));
    const base = join(dir, "base.json");
    const ours = join(dir, "ours.json");
    const theirs = join(dir, "theirs.json");
    const oursBefore = wrap([{ idx: 0 }, { idx: 1, tag: "o" }]);
    writeFileSync(base, wrap([{ idx: 0 }]));
    writeFileSync(ours, oursBefore);
    writeFileSync(theirs, wrap([{ idx: 0 }, { idx: 1, tag: "t" }]));

    const r = spawnSync(
      process.execPath,
      [
        CLI_PATH,
        "driver",
        "--array-path", "entries",
        "--key", "idx",
        "--", base, ours, theirs,
      ],
      { encoding: "utf8" },
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/idx=1/);
    expect(readFileSync(ours, "utf8")).toBe(oursBefore);
  });

  it("exits 2 on usage error", () => {
    const r = spawnSync(process.execPath, [CLI_PATH, "bogus"], { encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/bogus/);
  });

  it("exits 2 for reserved subcommands", () => {
    for (const sub of ["install", "resolve"]) {
      const r = spawnSync(process.execPath, [CLI_PATH, sub], { encoding: "utf8" });
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/not yet implemented/);
    }
  });

  it("--help prints usage and exits 0", () => {
    const r = spawnSync(process.execPath, [CLI_PATH, "--help"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Usage:/);
  });
});

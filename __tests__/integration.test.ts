// Real-git integration test exercising the install + driver round-trip.
//
// On Windows, git invokes merge drivers through its bundled MSYS sh, so the
// no-extension POSIX wrapper script we drop on PATH is what git actually runs
// — the .cmd shim is only there for direct invocations from cmd/PowerShell
// (which our tests don't do; they spawn node directly with the CLI path).

import { describe, it, expect } from "vitest";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, platform } from "node:os";
import { delimiter, join } from "node:path";

const CLI_PATH = join(__dirname, "..", "dist", "src", "cli.js");
const isWindows = platform() === "win32";

// Provides a 'git-merge-append' binary on PATH that proxies to the built CLI.
// This lets the install command register a driver that git can find when it
// invokes the merge driver during git merge / git rebase.
function setUp(opts: { dirSuffix?: string } = {}): {
  dir: string;
  env: NodeJS.ProcessEnv;
} {
  const dir = mkdtempSync(join(tmpdir(), opts.dirSuffix ?? "git-merge-append-it-"));
  const binDir = join(dir, "bin");
  mkdirSync(binDir, { recursive: true });

  // POSIX shell wrapper — used by git's MSYS sh on Windows and by /bin/sh on
  // Unix. The CLI path is single-quoted so spaces in node_modules paths don't
  // break it.
  const shWrapper = join(binDir, "git-merge-append");
  writeFileSync(shWrapper, `#!/bin/sh\nexec node '${CLI_PATH}' "$@"\n`);
  chmodSync(shWrapper, 0o755);

  if (isWindows) {
    // .cmd shim for cmd.exe lookups (PATHEXT). Not strictly needed for these
    // tests, but matches what `npm install -g git-merge-append` actually drops
    // on PATH, so the test environment more closely mirrors a real install.
    const cmdWrapper = join(binDir, "git-merge-append.cmd");
    writeFileSync(cmdWrapper, `@echo off\r\nnode "${CLI_PATH}" %*\r\n`);
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  };

  run(["init", "-q", "-b", "main", dir], { env });
  run(["-C", dir, "config", "commit.gpgsign", "false"], { env });
  return { dir, env };
}

function run(
  args: readonly string[],
  opts: { env: NodeJS.ProcessEnv; allowFail?: boolean } & {
    cwd?: string;
  } = { env: process.env },
): SpawnSyncReturns<string> {
  const r = spawnSync("git", args, { encoding: "utf8", env: opts.env, cwd: opts.cwd });
  if (!opts.allowFail && r.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed:\n${r.stderr}\n${r.stdout}`);
  }
  return r;
}

function wrap(entries: unknown[]): string {
  return JSON.stringify({ version: "5", entries }, null, 2) + "\n";
}

describe("real-git integration", () => {
  it("sanity: built CLI exists", () => {
    expect(existsSync(CLI_PATH)).toBe(true);
  });

  it("install registers a driver that resolves concurrent appends in git merge", () => {
    const { dir, env } = setUp();
    const journal = "_journal.json";
    const journalPath = join(dir, journal);
    writeFileSync(journalPath, wrap([{ idx: 0, tag: "init" }]));
    run(["-C", dir, "add", journal], { env });
    run(["-C", dir, "commit", "-q", "-m", "init"], { env });

    // Install the driver with a path-pattern matching the journal file.
    const installArgs = [
      CLI_PATH, "install",
      "--name", "journal",
      "--array-path", "entries",
      "--key", "idx",
      "--sort-by", "idx",
      "--", journal,
    ];
    const installR = spawnSync(process.execPath, installArgs, {
      cwd: dir, env, encoding: "utf8",
    });
    expect(installR.status, installR.stderr).toBe(0);
    expect(readFileSync(join(dir, ".gitattributes"), "utf8")).toContain(
      `${journal} merge=journal`,
    );

    run(["-C", dir, "add", ".gitattributes"], { env });
    run(["-C", dir, "commit", "-q", "-m", "add gitattributes"], { env });

    // Branch A: append idx=1
    run(["-C", dir, "checkout", "-q", "-b", "branch-a"], { env });
    writeFileSync(journalPath, wrap([{ idx: 0, tag: "init" }, { idx: 1, tag: "a" }]));
    run(["-C", dir, "commit", "-q", "-am", "append idx=1"], { env });

    // Branch B from main: append idx=2
    run(["-C", dir, "checkout", "-q", "main"], { env });
    run(["-C", dir, "checkout", "-q", "-b", "branch-b"], { env });
    writeFileSync(journalPath, wrap([{ idx: 0, tag: "init" }, { idx: 2, tag: "b" }]));
    run(["-C", dir, "commit", "-q", "-am", "append idx=2"], { env });

    // Merge branch-a into branch-b — should resolve cleanly via the driver.
    const mergeR = run(["-C", dir, "merge", "-q", "--no-edit", "branch-a"], { env, allowFail: true });
    expect(mergeR.status, `merge failed:\n${mergeR.stderr}\n${mergeR.stdout}`).toBe(0);

    const merged = JSON.parse(readFileSync(journalPath, "utf8"));
    expect(merged.entries).toEqual([
      { idx: 0, tag: "init" },
      { idx: 1, tag: "a" },
      { idx: 2, tag: "b" },
    ]);
  });

  // The Windows footgun is paths with spaces interacting with the shell git
  // uses to invoke merge drivers. Dropping the repo into a tmp dir whose name
  // contains a space exercises two failure modes specifically: (a) PATH
  // lookup of the `git-merge-append` shim from MSYS sh when binDir's parent
  // contains a space, and (b) git substituting %O/%A/%B with paths under the
  // spaced working tree, which sh re-interprets through the double-quoted
  // placeholders in the persisted driver string. The driver string itself is
  // path-independent (no cwd-derived bytes), so storage round-tripping isn't
  // what's under test here — that would require a flag value containing a
  // space, which is a worthwhile follow-up but outside this fixture's scope.
  it("handles a working tree path that contains a space", () => {
    const { dir, env } = setUp({ dirSuffix: "git-merge-append it " });
    const journal = "_journal.json";
    const journalPath = join(dir, journal);
    writeFileSync(journalPath, wrap([{ idx: 0, tag: "init" }]));
    run(["-C", dir, "add", journal], { env });
    run(["-C", dir, "commit", "-q", "-m", "init"], { env });

    const installR = spawnSync(
      process.execPath,
      [
        CLI_PATH, "install",
        "--name", "journal",
        "--array-path", "entries",
        "--key", "idx",
        "--sort-by", "idx",
        "--", journal,
      ],
      { cwd: dir, env, encoding: "utf8" },
    );
    expect(installR.status, installR.stderr).toBe(0);

    run(["-C", dir, "add", ".gitattributes"], { env });
    run(["-C", dir, "commit", "-q", "-m", "add gitattributes"], { env });

    run(["-C", dir, "checkout", "-q", "-b", "branch-a"], { env });
    writeFileSync(journalPath, wrap([{ idx: 0, tag: "init" }, { idx: 1, tag: "a" }]));
    run(["-C", dir, "commit", "-q", "-am", "append idx=1"], { env });

    run(["-C", dir, "checkout", "-q", "main"], { env });
    run(["-C", dir, "checkout", "-q", "-b", "branch-b"], { env });
    writeFileSync(journalPath, wrap([{ idx: 0, tag: "init" }, { idx: 2, tag: "b" }]));
    run(["-C", dir, "commit", "-q", "-am", "append idx=2"], { env });

    const mergeR = run(["-C", dir, "merge", "-q", "--no-edit", "branch-a"], { env, allowFail: true });
    expect(mergeR.status, `merge failed:\n${mergeR.stderr}\n${mergeR.stdout}`).toBe(0);

    const merged = JSON.parse(readFileSync(journalPath, "utf8"));
    expect(merged.entries).toEqual([
      { idx: 0, tag: "init" },
      { idx: 1, tag: "a" },
      { idx: 2, tag: "b" },
    ]);
  });

  it("git merge surfaces a normal conflict when entries diverge on the same key", () => {
    const { dir, env } = setUp();
    const journal = "_journal.json";
    const journalPath = join(dir, journal);
    writeFileSync(journalPath, wrap([{ idx: 0 }]));
    writeFileSync(join(dir, ".gitattributes"), `${journal} merge=journal\n`);
    run(["-C", dir, "add", journal, ".gitattributes"], { env });
    run(["-C", dir, "commit", "-q", "-m", "init"], { env });

    const installR = spawnSync(
      process.execPath,
      [
        CLI_PATH, "install",
        "--name", "journal",
        "--array-path", "entries",
        "--key", "idx",
        "--sort-by", "idx",
        "--", journal,
      ],
      { cwd: dir, env, encoding: "utf8" },
    );
    expect(installR.status, installR.stderr).toBe(0);

    run(["-C", dir, "checkout", "-q", "-b", "branch-a"], { env });
    writeFileSync(journalPath, wrap([{ idx: 0 }, { idx: 1, tag: "a" }]));
    run(["-C", dir, "commit", "-q", "-am", "a"], { env });

    run(["-C", dir, "checkout", "-q", "main"], { env });
    run(["-C", dir, "checkout", "-q", "-b", "branch-b"], { env });
    writeFileSync(journalPath, wrap([{ idx: 0 }, { idx: 1, tag: "b" }]));
    run(["-C", dir, "commit", "-q", "-am", "b"], { env });

    const mergeR = run(["-C", dir, "merge", "-q", "--no-edit", "branch-a"], { env, allowFail: true });
    expect(mergeR.status).not.toBe(0);
  });

  it("resolve recovers cleanly after a mid-merge conflict the driver was not registered for", () => {
    const { dir, env } = setUp();
    const journal = "_journal.json";
    const journalPath = join(dir, journal);
    writeFileSync(journalPath, wrap([{ idx: 0 }]));
    run(["-C", dir, "add", journal], { env });
    run(["-C", dir, "commit", "-q", "-m", "init"], { env });

    // No driver installed.
    run(["-C", dir, "checkout", "-q", "-b", "branch-a"], { env });
    writeFileSync(journalPath, wrap([{ idx: 0 }, { idx: 1 }]));
    run(["-C", dir, "commit", "-q", "-am", "a"], { env });
    run(["-C", dir, "checkout", "-q", "main"], { env });
    run(["-C", dir, "checkout", "-q", "-b", "branch-b"], { env });
    writeFileSync(journalPath, wrap([{ idx: 0 }, { idx: 2 }]));
    run(["-C", dir, "commit", "-q", "-am", "b"], { env });

    const mergeR = run(["-C", dir, "merge", "-q", "--no-edit", "branch-a"], { env, allowFail: true });
    expect(mergeR.status).not.toBe(0);
    expect(readFileSync(journalPath, "utf8")).toMatch(/<<<<<<</);

    const resolveR = spawnSync(
      process.execPath,
      [
        CLI_PATH, "resolve",
        "--array-path", "entries",
        "--key", "idx",
        "--sort-by", "idx",
        "--", journal,
      ],
      { cwd: dir, env, encoding: "utf8" },
    );
    expect(resolveR.status, resolveR.stderr).toBe(0);
    const merged = JSON.parse(readFileSync(journalPath, "utf8"));
    expect(merged.entries.map((e: { idx: number }) => e.idx)).toEqual([0, 1, 2]);
  });
});

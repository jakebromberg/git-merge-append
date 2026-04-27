import { describe, it, expect } from "vitest";
import { parseArgs } from "../src/cli.js";
import { runInstall, type InstallDeps } from "../src/install.js";

type GitCall = { args: readonly string[]; status: number; stdout: string };

function makeDeps(opts: {
  attributes?: string | null;
  configValues?: Record<string, string>;
  gitFails?: Record<string, number>;
} = {}): {
  deps: InstallDeps;
  calls: GitCall[];
  attributesAfter: () => string | null;
} {
  let attrs: string | null = opts.attributes ?? null;
  const configValues: Record<string, string> = { ...(opts.configValues ?? {}) };
  const calls: GitCall[] = [];
  const deps: InstallDeps = {
    readGitattributes: () => attrs,
    writeGitattributes: (c) => {
      attrs = c;
    },
    runGit: (args) => {
      calls.push({ args, status: 0, stdout: "" });
      const joined = args.join(" ");
      const failStatus = opts.gitFails?.[joined];
      if (failStatus !== undefined) return { stdout: "", status: failStatus };
      // Simulate git config get
      if (args[0] === "config" && args[1] !== "--global" && args.includes("--get")) {
        const key = args[args.length - 1]!;
        const v = configValues[key];
        return { stdout: v ?? "", status: v ? 0 : 1 };
      }
      if (args[0] === "config" && args[1] === "--global" && args.includes("--get")) {
        const key = args[args.length - 1]!;
        const v = configValues[`global:${key}`];
        return { stdout: v ?? "", status: v ? 0 : 1 };
      }
      // Simulate git config set
      if (args[0] === "config" && args.length >= 3) {
        const isGlobal = args[1] === "--global";
        const offset = isGlobal ? 2 : 1;
        const key = args[offset]!;
        const value = args[offset + 1]!;
        const storeKey = isGlobal ? `global:${key}` : key;
        configValues[storeKey] = value;
      }
      return { stdout: "", status: 0 };
    },
  };
  return { deps, calls, attributesAfter: () => attrs };
}

const installArgs = [
  "install",
  "--name", "journal",
  "--array-path", "entries",
  "--key", "idx",
  "--sort-by", "idx",
  "--", "shared/database/src/migrations/meta/_journal.json",
];

describe("parseArgs — install subcommand", () => {
  it("parses required and optional flags plus path patterns", () => {
    const parsed = parseArgs(installArgs);
    expect(parsed).toEqual({
      kind: "install",
      name: "journal",
      spec: { arrayPath: "entries", key: "idx", sortBy: "idx" },
      global: false,
      upgrade: false,
      patterns: ["shared/database/src/migrations/meta/_journal.json"],
    });
  });

  it("supports --global", () => {
    const parsed = parseArgs([
      "install",
      "--name", "journal",
      "--key", "idx",
      "--global",
      "--", "**/*.json",
    ]);
    expect(parsed.kind).toBe("install");
    if (parsed.kind !== "install") return;
    expect(parsed.global).toBe(true);
  });

  it("parses --upgrade as a boolean flag", () => {
    const parsed = parseArgs([
      "install",
      "--name", "journal",
      "--key", "idx",
      "--upgrade",
      "--", "**/*.json",
    ]);
    expect(parsed.kind).toBe("install");
    if (parsed.kind !== "install") return;
    expect(parsed.upgrade).toBe(true);
  });

  it("defaults upgrade to false when --upgrade is absent", () => {
    const parsed = parseArgs(installArgs);
    expect(parsed.kind).toBe("install");
    if (parsed.kind !== "install") return;
    expect(parsed.upgrade).toBe(false);
  });

  it("composes --upgrade with --global", () => {
    const parsed = parseArgs([
      "install",
      "--name", "journal",
      "--key", "idx",
      "--global",
      "--upgrade",
      "--", "**/*.json",
    ]);
    expect(parsed.kind).toBe("install");
    if (parsed.kind !== "install") return;
    expect(parsed.global).toBe(true);
    expect(parsed.upgrade).toBe(true);
  });

  it("errors when --name is missing", () => {
    const parsed = parseArgs([
      "install",
      "--key", "idx",
      "--", "x.json",
    ]);
    expect(parsed.kind).toBe("error");
  });

  it("errors when no path pattern is supplied after --", () => {
    const parsed = parseArgs([
      "install",
      "--name", "j",
      "--key", "idx",
      "--",
    ]);
    expect(parsed.kind).toBe("error");
  });
});

describe("runInstall", () => {
  it("appends a new line to .gitattributes when none exists", () => {
    const { deps, attributesAfter } = makeDeps({ attributes: null });
    const code = runInstall(parseArgs(installArgs) as never, deps, () => {});
    expect(code).toBe(0);
    const after = attributesAfter()!;
    expect(after).toContain(
      "shared/database/src/migrations/meta/_journal.json merge=journal",
    );
    expect(after.endsWith("\n")).toBe(true);
  });

  it("preserves existing unrelated lines in .gitattributes", () => {
    const existing = "*.png binary\n*.lock -diff\n";
    const { deps, attributesAfter } = makeDeps({ attributes: existing });
    runInstall(parseArgs(installArgs) as never, deps, () => {});
    const after = attributesAfter()!;
    expect(after).toContain("*.png binary");
    expect(after).toContain("*.lock -diff");
    expect(after).toContain(
      "shared/database/src/migrations/meta/_journal.json merge=journal",
    );
  });

  it("is idempotent: re-running does not duplicate the line", () => {
    const { deps, attributesAfter } = makeDeps({ attributes: null });
    runInstall(parseArgs(installArgs) as never, deps, () => {});
    const first = attributesAfter()!;
    runInstall(parseArgs(installArgs) as never, deps, () => {});
    expect(attributesAfter()).toBe(first);
  });

  it("registers git config merge.<name>.driver and merge.<name>.name", () => {
    const { deps, calls } = makeDeps();
    runInstall(parseArgs(installArgs) as never, deps, () => {});
    const isSet = (key: string) => (c: GitCall) =>
      c.args[0] === "config" && !c.args.includes("--get") && c.args.includes(key);
    const driverCall = calls.find(isSet("merge.journal.driver"));
    expect(driverCall).toBeDefined();
    const driverValue = driverCall!.args[driverCall!.args.length - 1]!;
    expect(driverValue).toContain("git-merge-append driver");
    expect(driverValue).toContain("--key idx");
    expect(driverValue).toContain("--array-path entries");
    expect(driverValue).toContain("--sort-by idx");
    expect(calls.find(isSet("merge.journal.name"))).toBeDefined();
  });

  it("uses --global when the flag is set", () => {
    const { deps, calls } = makeDeps();
    runInstall(
      parseArgs([
        "install",
        "--name", "j",
        "--key", "idx",
        "--global",
        "--", "x.json",
      ]) as never,
      deps,
      () => {},
    );
    expect(calls.every((c) => c.args[0] !== "config" || c.args[1] === "--global")).toBe(true);
  });

  it("errors when an existing different driver string is registered (upgrade path is opt-in)", () => {
    const { deps } = makeDeps({
      configValues: {
        "merge.journal.driver": "some-other-tool --weird-flags",
      },
    });
    const errs: string[] = [];
    const code = runInstall(parseArgs(installArgs) as never, deps, (m) => errs.push(m));
    expect(code).toBe(2);
    const joined = errs.join("\n");
    expect(joined).toMatch(/already registered/i);
    expect(joined).toMatch(/--upgrade/);
  });

  it("with --upgrade, unsets and re-sets a divergent driver in order", () => {
    const upgradeArgs = [...installArgs.slice(0, -2), "--upgrade", ...installArgs.slice(-2)];
    const { deps, calls } = makeDeps({
      configValues: {
        "merge.journal.driver": "some-other-tool --weird-flags",
      },
    });
    const code = runInstall(parseArgs(upgradeArgs) as never, deps, () => {});
    expect(code).toBe(0);
    const driverOps = calls.filter(
      (c) => c.args[0] === "config" && c.args.includes("merge.journal.driver"),
    );
    // get, unset, set — in that order.
    expect(driverOps.map((c) => c.args.slice(0, 3))).toEqual([
      ["config", "--get", "merge.journal.driver"],
      ["config", "--unset", "merge.journal.driver"],
      ["config", "merge.journal.driver", expect.stringContaining("git-merge-append driver")],
    ]);
  });

  it("with --upgrade, prints a -/+ diff of the change to stderr", () => {
    const upgradeArgs = [...installArgs.slice(0, -2), "--upgrade", ...installArgs.slice(-2)];
    const { deps } = makeDeps({
      configValues: {
        "merge.journal.driver": "some-other-tool --weird-flags",
      },
    });
    const errs: string[] = [];
    const code = runInstall(parseArgs(upgradeArgs) as never, deps, (m) => errs.push(m));
    expect(code).toBe(0);
    const joined = errs.join("\n");
    expect(joined).toMatch(/^- some-other-tool --weird-flags$/m);
    expect(joined).toMatch(/^\+ git-merge-append driver .* -- "%O" "%A" "%B"$/m);
  });

  it("with --upgrade, is a no-op on the driver key when the existing value already matches", () => {
    const expectedDriver =
      "git-merge-append driver --array-path entries --key idx --sort-by idx -- " +
      '"%O" "%A" "%B"';
    const upgradeArgs = [...installArgs.slice(0, -2), "--upgrade", ...installArgs.slice(-2)];
    const { deps, calls } = makeDeps({
      configValues: {
        "merge.journal.driver": expectedDriver,
      },
    });
    const code = runInstall(parseArgs(upgradeArgs) as never, deps, () => {});
    expect(code).toBe(0);
    const driverWrites = calls.filter(
      (c) =>
        c.args[0] === "config" &&
        c.args.includes("merge.journal.driver") &&
        (c.args.includes("--unset") || c.args.length > 3),
    );
    expect(driverWrites).toEqual([]);
  });

  it("with --upgrade, behaves like a normal install when no driver is registered yet", () => {
    const upgradeArgs = [...installArgs.slice(0, -2), "--upgrade", ...installArgs.slice(-2)];
    const { deps, calls } = makeDeps();
    const code = runInstall(parseArgs(upgradeArgs) as never, deps, () => {});
    expect(code).toBe(0);
    const unsetCalls = calls.filter(
      (c) => c.args[0] === "config" && c.args.includes("--unset"),
    );
    expect(unsetCalls).toEqual([]);
    const driverSet = calls.find(
      (c) =>
        c.args[0] === "config" &&
        c.args.includes("merge.journal.driver") &&
        !c.args.includes("--get") &&
        !c.args.includes("--unset"),
    );
    expect(driverSet).toBeDefined();
  });

  it("with --upgrade --global, the unset carries --global", () => {
    const { deps, calls } = makeDeps({
      configValues: {
        "global:merge.j.driver": "some-other-tool --weird-flags",
      },
    });
    const code = runInstall(
      parseArgs([
        "install",
        "--name", "j",
        "--key", "idx",
        "--global",
        "--upgrade",
        "--", "x.json",
      ]) as never,
      deps,
      () => {},
    );
    expect(code).toBe(0);
    const unsetCall = calls.find(
      (c) => c.args[0] === "config" && c.args.includes("--unset"),
    );
    expect(unsetCall).toBeDefined();
    expect(unsetCall!.args[1]).toBe("--global");
  });

  it("is idempotent on git config when the existing driver string already matches", () => {
    const expectedDriver =
      "git-merge-append driver --array-path entries --key idx --sort-by idx -- " +
      '"%O" "%A" "%B"';
    const { deps, calls } = makeDeps({
      configValues: {
        "merge.journal.driver": expectedDriver,
      },
    });
    const code = runInstall(parseArgs(installArgs) as never, deps, () => {});
    expect(code).toBe(0);
    // Should NOT re-set merge.journal.driver
    const driverSets = calls.filter(
      (c) => c.args[0] === "config" && c.args[1] === "merge.journal.driver" && c.args.length > 3,
    );
    expect(driverSets.length).toBe(0);
  });
});

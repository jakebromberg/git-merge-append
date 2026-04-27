import type { MergeSpec } from "./json-array.js";

export type InstallDeps = {
  readGitattributes: () => string | null;
  writeGitattributes: (content: string) => void;
  runGit: (args: readonly string[]) => { stdout: string; status: number };
};

type InstallArgs = {
  name: string;
  spec: MergeSpec;
  global: boolean;
  upgrade: boolean;
  patterns: string[];
};

export function runInstall(
  args: InstallArgs,
  deps: InstallDeps,
  err: (message: string) => void,
): number {
  const driver = buildDriverString(args.spec);
  const description = `${args.name} — JSON keyed-array append merger`;

  const existing = deps.readGitattributes();
  const updated = upsertAttributesLines(existing, args.patterns, args.name);
  if (updated !== existing) deps.writeGitattributes(updated);

  const driverKey = `merge.${args.name}.driver`;
  const nameKey = `merge.${args.name}.name`;

  const rawExisting = configGet(deps.runGit, driverKey, args.global);
  const existingDriver = rawExisting === null ? null : rawExisting.trim();
  const divergent = existingDriver !== null && existingDriver !== driver;

  if (divergent && !args.upgrade) {
    err(
      `${driverKey} is already registered with a different value. ` +
        `Re-run with --upgrade to replace it, or run ` +
        `'git config ${args.global ? "--global " : ""}--unset ${driverKey}' to clear it manually.`,
    );
    err(`  existing: ${existingDriver}`);
    err(`  requested: ${driver}`);
    return 2;
  }

  if (divergent) {
    err(`- ${existingDriver}`);
    err(`+ ${driver}`);
    configUnset(deps.runGit, driverKey, args.global);
    configSet(deps.runGit, driverKey, driver, args.global);
  } else if (existingDriver === null) {
    configSet(deps.runGit, driverKey, driver, args.global);
  }
  configSet(deps.runGit, nameKey, description, args.global);

  return 0;
}

function buildDriverString(spec: MergeSpec): string {
  const parts: string[] = ["git-merge-append", "driver"];
  if (spec.arrayPath !== undefined) parts.push("--array-path", spec.arrayPath);
  parts.push("--key", spec.key);
  if (spec.sortBy !== undefined) parts.push("--sort-by", spec.sortBy);
  parts.push("--", '"%O"', '"%A"', '"%B"');
  return parts.join(" ");
}

function upsertAttributesLines(
  existing: string | null,
  patterns: readonly string[],
  name: string,
): string {
  const lines = existing === null ? [] : existing.split("\n");
  const trailingEmpty = lines.length > 0 && lines[lines.length - 1] === "";
  const body = trailingEmpty ? lines.slice(0, -1) : lines;
  const rendered = patterns.map((p) => `${p} merge=${name}`);
  let changed = false;
  for (const r of rendered) {
    if (!body.includes(r)) {
      body.push(r);
      changed = true;
    }
  }
  if (!changed && existing !== null) return existing;
  return body.join("\n") + "\n";
}

function buildConfigArgs(global: boolean, ...rest: string[]): string[] {
  return global ? ["config", "--global", ...rest] : ["config", ...rest];
}

function configGet(
  runGit: InstallDeps["runGit"],
  key: string,
  global: boolean,
): string | null {
  const r = runGit(buildConfigArgs(global, "--get", key));
  if (r.status !== 0) return null;
  return r.stdout;
}

function configSet(
  runGit: InstallDeps["runGit"],
  key: string,
  value: string,
  global: boolean,
): void {
  runGit(buildConfigArgs(global, key, value));
}

function configUnset(
  runGit: InstallDeps["runGit"],
  key: string,
  global: boolean,
): void {
  runGit(buildConfigArgs(global, "--unset", key));
}

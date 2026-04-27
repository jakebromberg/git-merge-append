#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { runInstall } from "./install.js";
import { runResolve } from "./resolve.js";
import { mergeJsonArray } from "./json-array.js";
const KNOWN_DRIVER_FLAGS = new Set(["--array-path", "--key", "--sort-by"]);
const KNOWN_INSTALL_FLAGS = new Set(["--name", "--array-path", "--key", "--sort-by", "--global"]);
const KNOWN_RESOLVE_FLAGS = new Set(["--array-path", "--key", "--sort-by"]);
export function parseArgs(argv) {
    if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
        return { kind: "help" };
    }
    const sub = argv[0];
    const rest = argv.slice(1);
    if (sub === "driver")
        return parseDriver(rest);
    if (sub === "install")
        return parseInstall(rest);
    if (sub === "resolve")
        return parseResolve(rest);
    return { kind: "error", message: `unknown subcommand: ${sub}` };
}
function parseResolve(argv) {
    let i = 0;
    let arrayPath;
    let key;
    let sortBy;
    while (i < argv.length && argv[i] !== "--") {
        const flag = argv[i];
        if (!KNOWN_RESOLVE_FLAGS.has(flag)) {
            return { kind: "error", message: `unknown flag: ${flag}` };
        }
        const v = argv[i + 1];
        if (v === undefined)
            return { kind: "error", message: `flag ${flag} requires a value` };
        if (flag === "--array-path")
            arrayPath = v;
        else if (flag === "--key")
            key = v;
        else if (flag === "--sort-by")
            sortBy = v;
        i += 2;
    }
    if (key === undefined)
        return { kind: "error", message: "missing required flag: --key" };
    const paths = argv[i] === "--" ? argv.slice(i + 1) : [];
    return { kind: "resolve", spec: { arrayPath, key, sortBy }, paths: [...paths] };
}
function parseInstall(argv) {
    let i = 0;
    let name;
    let arrayPath;
    let key;
    let sortBy;
    let global = false;
    while (i < argv.length && argv[i] !== "--") {
        const flag = argv[i];
        if (!KNOWN_INSTALL_FLAGS.has(flag)) {
            return { kind: "error", message: `unknown flag: ${flag}` };
        }
        if (flag === "--global") {
            global = true;
            i += 1;
            continue;
        }
        const v = argv[i + 1];
        if (v === undefined) {
            return { kind: "error", message: `flag ${flag} requires a value` };
        }
        if (flag === "--name")
            name = v;
        else if (flag === "--array-path")
            arrayPath = v;
        else if (flag === "--key")
            key = v;
        else if (flag === "--sort-by")
            sortBy = v;
        i += 2;
    }
    if (name === undefined)
        return { kind: "error", message: "missing required flag: --name" };
    if (key === undefined)
        return { kind: "error", message: "missing required flag: --key" };
    if (argv[i] !== "--") {
        return { kind: "error", message: "expected -- separator before <path-pattern>..." };
    }
    const patterns = argv.slice(i + 1);
    if (patterns.length === 0) {
        return { kind: "error", message: "expected at least one path pattern after --" };
    }
    return { kind: "install", name, spec: { arrayPath, key, sortBy }, global, patterns: [...patterns] };
}
function parseDriver(argv) {
    let i = 0;
    let arrayPath;
    let key;
    let sortBy;
    while (i < argv.length && argv[i] !== "--") {
        const flag = argv[i];
        if (!KNOWN_DRIVER_FLAGS.has(flag)) {
            return { kind: "error", message: `unknown flag: ${flag}` };
        }
        const v = argv[i + 1];
        if (v === undefined) {
            return { kind: "error", message: `flag ${flag} requires a value` };
        }
        if (flag === "--array-path")
            arrayPath = v;
        else if (flag === "--key")
            key = v;
        else if (flag === "--sort-by")
            sortBy = v;
        i += 2;
    }
    if (key === undefined) {
        return { kind: "error", message: "missing required flag: --key" };
    }
    if (argv[i] !== "--") {
        return { kind: "error", message: "expected -- separator before <base> <ours> <theirs>" };
    }
    const positional = argv.slice(i + 1);
    if (positional.length < 3) {
        return { kind: "error", message: "expected three paths after --: <base> <ours> <theirs>" };
    }
    const [base, ours, theirs] = positional;
    return {
        kind: "driver",
        spec: { arrayPath, key, sortBy },
        base: base,
        ours: ours,
        theirs: theirs,
    };
}
export function runCli(parsed, deps) {
    if (parsed.kind === "help") {
        deps.log(HELP_TEXT);
        return 0;
    }
    if (parsed.kind === "error") {
        deps.err(`error: ${parsed.message}`);
        deps.err("");
        deps.err(HELP_TEXT);
        return 2;
    }
    if (parsed.kind === "install") {
        return runInstall(parsed, makeInstallDeps(deps), deps.err);
    }
    if (parsed.kind === "resolve") {
        return runResolve(parsed, makeResolveDeps(deps), deps.log, deps.err);
    }
    let baseText;
    let oursText;
    let theirsText;
    try {
        baseText = deps.readFile(parsed.base);
        oursText = deps.readFile(parsed.ours);
        theirsText = deps.readFile(parsed.theirs);
    }
    catch (e) {
        deps.err(`error: failed to read input file: ${e.message}`);
        return 2;
    }
    let result;
    try {
        result = mergeJsonArray(baseText, oursText, theirsText, parsed.spec);
    }
    catch (e) {
        deps.err(`error: invalid input: ${e.message}`);
        return 2;
    }
    if (!result.ok) {
        deps.err(result.reason);
        return 1;
    }
    try {
        deps.writeFile(parsed.ours, result.result);
    }
    catch (e) {
        deps.err(`error: failed to write result: ${e.message}`);
        return 2;
    }
    return 0;
}
const HELP_TEXT = `git-merge-append — 3-way git merge driver for keyed JSON arrays

Usage:
  git-merge-append driver --array-path <path> --key <field> [--sort-by <field>] -- <base> <ours> <theirs>
  git-merge-append install --name <name> --array-path <path> --key <field> [--sort-by <field>] [--global] -- <pattern>...
  git-merge-append --help

Flags (driver):
  --array-path <path>   field name of the array inside the document; omit for top-level array
  --key <field>         field that uniquely identifies an entry (required)
  --sort-by <field>     field to sort the merged array by (defaults to --key)

Flags (install):
  --name <name>         driver name to register (used in .gitattributes and git config)
  --global              register the driver in your global git config
  Plus the driver flags above; they describe the spec the registered driver will use.

Positional (driver, after --):
  <base>      git's %O (merge ancestor)
  <ours>      git's %A (current branch); the merged result is written here
  <theirs>    git's %B (incoming branch)

Exit codes:
  0  clean merge / install succeeded
  1  algorithmic conflict
  2  usage error or invalid input
`;
function makeInstallDeps(deps) {
    return {
        readGitattributes: () => (existsSync(".gitattributes") ? deps.readFile(".gitattributes") : null),
        writeGitattributes: (c) => deps.writeFile(".gitattributes", c),
        runGit: (args) => {
            try {
                const stdout = execFileSync("git", [...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
                return { stdout, status: 0 };
            }
            catch (e) {
                return { stdout: "", status: e.status ?? 1 };
            }
        },
    };
}
function makeResolveDeps(deps) {
    return {
        lsUnmergedFiles: () => {
            try {
                const stdout = execFileSync("git", ["ls-files", "-u", "-z"], {
                    encoding: "utf8",
                    stdio: ["ignore", "pipe", "ignore"],
                });
                const seen = new Set();
                for (const rec of stdout.split("\0")) {
                    if (!rec)
                        continue;
                    const tab = rec.indexOf("\t");
                    if (tab === -1)
                        continue;
                    seen.add(rec.slice(tab + 1));
                }
                return [...seen];
            }
            catch {
                return [];
            }
        },
        showStage: (stage, path) => execFileSync("git", ["show", `:${stage}:${path}`], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        }),
        writeFile: (p, c) => deps.writeFile(p, c),
        addFile: (p) => {
            execFileSync("git", ["add", p], { stdio: "ignore" });
        },
    };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const code = runCli(parseArgs(process.argv.slice(2)), {
        readFile: (p) => readFileSync(p, "utf8"),
        writeFile: (p, c) => writeFileSync(p, c, "utf8"),
        log: (m) => process.stdout.write(m + "\n"),
        err: (m) => process.stderr.write(m + "\n"),
    });
    process.exit(code);
}
//# sourceMappingURL=cli.js.map
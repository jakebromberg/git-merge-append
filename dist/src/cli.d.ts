#!/usr/bin/env node
import { type MergeSpec } from "./json-array.js";
export type ParsedArgs = {
    kind: "driver";
    spec: MergeSpec;
    base: string;
    ours: string;
    theirs: string;
} | {
    kind: "reserved";
    name: "install" | "resolve";
} | {
    kind: "help";
} | {
    kind: "error";
    message: string;
};
export declare function parseArgs(argv: readonly string[]): ParsedArgs;
export type CliDeps = {
    readFile: (path: string) => string;
    writeFile: (path: string, content: string) => void;
    log: (message: string) => void;
    err: (message: string) => void;
};
export declare function runCli(parsed: ParsedArgs, deps: CliDeps): number;
//# sourceMappingURL=cli.d.ts.map
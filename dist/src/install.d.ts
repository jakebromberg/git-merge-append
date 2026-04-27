import type { MergeSpec } from "./json-array.js";
export type InstallDeps = {
    readGitattributes: () => string | null;
    writeGitattributes: (content: string) => void;
    runGit: (args: readonly string[]) => {
        stdout: string;
        status: number;
    };
};
type InstallArgs = {
    name: string;
    spec: MergeSpec;
    global: boolean;
    upgrade: boolean;
    patterns: string[];
};
export declare function runInstall(args: InstallArgs, deps: InstallDeps, err: (message: string) => void): number;
export {};
//# sourceMappingURL=install.d.ts.map
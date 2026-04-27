import { type MergeSpec } from "./json-array.js";
export type ResolveDeps = {
    lsUnmergedFiles: () => string[];
    showStage: (stage: 1 | 2 | 3, path: string) => string;
    writeFile: (path: string, content: string) => void;
    addFile: (path: string) => void;
};
type ResolveArgs = {
    spec: MergeSpec;
    paths: string[];
};
export declare function runResolve(args: ResolveArgs, deps: ResolveDeps, log: (message: string) => void, err: (message: string) => void): number;
export {};
//# sourceMappingURL=resolve.d.ts.map
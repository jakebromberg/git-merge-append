export type MergeSpec = {
    arrayPath?: string;
    key: string;
    sortBy?: string;
};
export type MergeResult = {
    ok: true;
    result: string;
} | {
    ok: false;
    reason: string;
};
export declare function mergeJsonArray(baseText: string, oursText: string, theirsText: string, spec: MergeSpec): MergeResult;
//# sourceMappingURL=json-array.d.ts.map
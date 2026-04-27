import { mergeJsonArray } from "./json-array.js";
export function runResolve(args, deps, log, err) {
    const targets = args.paths.length > 0 ? args.paths : deps.lsUnmergedFiles();
    if (targets.length === 0) {
        log("nothing to resolve: no unmerged paths");
        return 0;
    }
    let conflicts = 0;
    for (const path of targets) {
        let base, ours, theirs;
        try {
            base = deps.showStage(1, path);
            ours = deps.showStage(2, path);
            theirs = deps.showStage(3, path);
        }
        catch (e) {
            err(`error: failed to read merge stages for ${path}: ${e.message}`);
            conflicts += 1;
            continue;
        }
        let result;
        try {
            result = mergeJsonArray(base, ours, theirs, args.spec);
        }
        catch (e) {
            err(`error: invalid input for ${path}: ${e.message}`);
            conflicts += 1;
            continue;
        }
        if (!result.ok) {
            err(`${path}: ${result.reason}`);
            conflicts += 1;
            continue;
        }
        deps.writeFile(path, result.result);
        deps.addFile(path);
        log(`${path}: resolved`);
    }
    return conflicts > 0 ? 1 : 0;
}
//# sourceMappingURL=resolve.js.map
export function runInstall(args, deps, err) {
    const driver = buildDriverString(args.spec);
    const description = `${args.name} — JSON keyed-array append merger`;
    const existing = deps.readGitattributes();
    const updated = upsertAttributesLines(existing, args.patterns, args.name);
    if (updated !== existing)
        deps.writeGitattributes(updated);
    const driverKey = `merge.${args.name}.driver`;
    const nameKey = `merge.${args.name}.name`;
    const existingDriver = configGet(deps.runGit, driverKey, args.global);
    if (existingDriver !== null && existingDriver.trim() !== driver) {
        err(`${driverKey} is already registered with a different value. ` +
            `Run 'git config ${args.global ? "--global " : ""}--unset ${driverKey}' first, ` +
            `or wait for the upgrade flag (tracked as issue #9).`);
        err(`  existing: ${existingDriver.trim()}`);
        err(`  requested: ${driver}`);
        return 2;
    }
    if (existingDriver === null)
        configSet(deps.runGit, driverKey, driver, args.global);
    configSet(deps.runGit, nameKey, description, args.global);
    return 0;
}
function buildDriverString(spec) {
    const parts = ["git-merge-append", "driver"];
    if (spec.arrayPath !== undefined)
        parts.push("--array-path", spec.arrayPath);
    parts.push("--key", spec.key);
    if (spec.sortBy !== undefined)
        parts.push("--sort-by", spec.sortBy);
    parts.push("--", '"%O"', '"%A"', '"%B"');
    return parts.join(" ");
}
function upsertAttributesLines(existing, patterns, name) {
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
    if (!changed && existing !== null)
        return existing;
    return body.join("\n") + "\n";
}
function configGet(runGit, key, global) {
    const args = global ? ["config", "--global", "--get", key] : ["config", "--get", key];
    const r = runGit(args);
    if (r.status !== 0)
        return null;
    return r.stdout;
}
function configSet(runGit, key, value, global) {
    const args = global ? ["config", "--global", key, value] : ["config", key, value];
    runGit(args);
}
//# sourceMappingURL=install.js.map
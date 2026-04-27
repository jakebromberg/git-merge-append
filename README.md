# git-merge-append

A 3-way git merge driver for JSON files that are logically *arrays of keyed entries* — files where each branch tends to *append* a new entry, and concurrent branches conflict on the array even when their new entries don't overlap.

The motivating case is Drizzle's `meta/_journal.json`, but the same shape appears in i18n message catalogs, feature-flag manifests, changelog manifests, event registries, and any append-dominant collection serialized as a JSON array.

## What it does

Given three versions of a JSON file (the merge base, ours, and theirs), it merges the keyed-array under a configured path by **key-union**: each side's additions are pulled in, modifications on one side carry through, and only divergent edits to the same key produce a conflict.

The result is sorted by a configurable sort key. Indentation, BOM, and line-endings are preserved from the base file.

## Status

Three subcommands are wired up: `driver` (the merge driver itself), `install` (automated `.gitattributes` + `git config` setup), and `resolve` (post-hoc rescue when you forgot to install the driver before a merge).

## Install

```sh
npm install -g git-merge-append
# or for a local repo:
npm install --save-dev git-merge-append
```

You can also install directly from GitHub:

```sh
npm install -g github:jakebromberg/git-merge-append
```

## Quick start

For Drizzle's `_journal.json` (the motivating example):

```sh
npx git-merge-append install \
  --name journal \
  --array-path entries --key idx --sort-by idx \
  -- shared/database/src/migrations/meta/_journal.json
```

This appends a line to `.gitattributes` and registers the driver in your repo's `.git/config`. After this, `git merge` and `git rebase` will resolve concurrent appends to `_journal.json` automatically.

**Per-clone caveat.** Driver definitions live in `.git/config`, which is **not** committed. Each collaborator must run `git-merge-append install` once after cloning. Add it to your project's setup script alongside `npm install`. (Tracked as issue #9 to add an `--upgrade` mode for changing existing definitions.)

## Mid-rebase rescue

If you didn't install the driver and you're already mid-merge with `<<<<<<<` markers in your journal, run:

```sh
npx git-merge-append resolve \
  --array-path entries --key idx --sort-by idx \
  -- shared/database/src/migrations/meta/_journal.json
```

`resolve` reads base/ours/theirs from git's index, runs the same merger as the driver, writes the result, and `git add`s the file. Pass no positional paths to resolve every unmerged path that matches the spec.

## Manual driver registration

If you'd rather not use `install`, you can wire it up by hand:

**`.gitattributes`** (committed):

```
shared/database/src/migrations/meta/_journal.json merge=journal
```

**`.git/config`** (per-clone):

```sh
git config merge.journal.driver \
  'git-merge-append driver --array-path entries --key idx --sort-by idx -- "%O" "%A" "%B"'
git config merge.journal.name 'JSON keyed-array append merger'
```

## CLI

```
git-merge-append driver  --array-path <path> --key <field> [--sort-by <field>] -- <base> <ours> <theirs>
git-merge-append install --name <name> --array-path <path> --key <field> [--sort-by <field>] [--global] -- <pattern>...
git-merge-append resolve --array-path <path> --key <field> [--sort-by <field>] [-- <path>...]
```

**Flags shared by all subcommands:**

- `--array-path <field>` — name of the field on the document that holds the array (e.g., `entries` for Drizzle journals). Single field name only in v1; nested paths are tracked as #7. Omit when the file *is* the array at the top level.
- `--key <field>` — name of the field on each entry that uniquely identifies it (e.g., `idx` for Drizzle, `id` for translations). Required.
- `--sort-by <field>` — field to sort the merged array by. Defaults to `--key`.

**`driver`-specific (positional after `--`):**

- `<base>` — git's `%O`, the merge ancestor.
- `<ours>` — git's `%A`, the current branch's version. **Result is written here**, per git's contract.
- `<theirs>` — git's `%B`, the incoming branch's version.

**`install`-specific:**

- `--name <name>` — name to register the driver under (used in `.gitattributes` and `git config`).
- `--global` — register in `~/.gitconfig` instead of the current repo's `.git/config`.
- Positional after `--`: one or more file path patterns (`.gitattributes`-style globs).

**`resolve`-specific:**

- Positional after `--`: zero or more files to resolve. With none, every unmerged path in the index is resolved.

**Exit codes:**

- `0` — clean merge / install succeeded / resolve cleared all conflicts.
- `1` — algorithmic conflict.
- `2` — usage error or invalid input.

## Algorithm

A real 3-way merge — no conflict-marker parsing. Given `base`, `ours`, `theirs`:

1. Resolve the array at `arrayPath` in each.
2. Compute additions on each side (entries with a `key` not present in base).
3. Compute modifications on each side (entries whose `key` is in base but content differs).
4. Compute deletions on each side (`key` in base but missing from that side).
5. Result = base entries (with single-side modifications applied), plus union of additions from both sides.
6. Conflicts (exit 1):
   - Same `key` added on both sides with structurally non-equal content.
   - Same `key` modified differently on both sides.
   - Same `key` deleted on one side and modified on the other.
   - Top-level non-array fields modified divergently.
7. Sort the result by `sortBy`.
8. Re-emit at base's indent and line endings.

Structural equality is canonical (key-order-insensitive) — `{a: 1, b: 2}` and `{b: 2, a: 1}` are equal.

## Troubleshooting

**`install` fails with "merge.<name>.driver is already registered with a different value".** You changed the spec since the last `install` run. Today the safe move is `git config --unset merge.<name>.driver` and re-run `install`. An `--upgrade` flag is tracked as issue #9.

**Concurrent merges still conflict on `_journal.json`.** Confirm `.git/config` actually has `merge.<name>.driver` set (`git config --get merge.journal.driver`). Driver definitions live there and aren't committed — each collaborator must run `install` once after cloning.

**Driver invocation fails on Windows.** v1 only validates macOS and Ubuntu. The known footgun is `git config` argument quoting in `install.ts`. Tracked as issue #10.

## Non-goals

- **Lockfiles** (`package-lock.json`, `yarn.lock`, `Cargo.lock`). Those need a real dependency-graph solver, not a key-union merge. Use [`npm-merge-driver`](https://github.com/npm/npm-merge-driver) or the equivalent for your tool.
- **Generic JSON merging** of objects-as-records. This tool is specifically about *arrays of keyed entries*. For broader JSON merging consider [`jonatanpedersen/git-json-merge`](https://github.com/jonatanpedersen/git-json-merge).
- **YAML, TOML, or non-JSON formats** — currently JSON-only. Tracked as follow-up issues.
- **Composite keys** — a single scalar `key` only. Tracked as a follow-up.

## Why

See [claude-orchestrator#37](https://github.com/jakebromberg/claude-orchestrator/issues/37) for the original motivation: parallel-PR workflows that produce N concurrent migrations also produce N−1 boilerplate conflicts on the journal index. The `claimSequentialNumber` primitive solved file-name collisions; this solves the journal-index conflict that follows.

## License

MIT

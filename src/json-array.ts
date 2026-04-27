export type MergeSpec = {
  arrayPath?: string;
  key: string;
  sortBy?: string;
};

export type MergeResult =
  | { ok: true; result: string }
  | { ok: false; reason: string };

export function mergeJsonArray(
  baseText: string,
  oursText: string,
  theirsText: string,
  spec: MergeSpec,
): MergeResult {
  if (spec.arrayPath && spec.arrayPath.includes(".")) {
    return { ok: false, reason: "nested arrayPath is not supported in v1; use a single field name" };
  }
  const baseClean = stripBom(baseText);
  const oursClean = stripBom(oursText);
  const theirsClean = stripBom(theirsText);
  const fmt = detectFormat(baseClean);
  const base = JSON.parse(baseClean) as unknown;
  const ours = JSON.parse(oursClean) as unknown;
  const theirs = JSON.parse(theirsClean) as unknown;

  const baseArr = getArrayLenient(base, spec.arrayPath);
  const oursArr = getArrayLenient(ours, spec.arrayPath);
  const theirsArr = getArrayLenient(theirs, spec.arrayPath);

  const baseByKey = byKey(baseArr, spec.key);
  const oursByKey = byKey(oursArr, spec.key);
  const theirsByKey = byKey(theirsArr, spec.key);

  const merged: Entry[] = [];

  for (const [k, baseEntry] of baseByKey) {
    const ourEntry = oursByKey.get(k);
    const theirEntry = theirsByKey.get(k);
    const ourDeleted = ourEntry === undefined;
    const theirDeleted = theirEntry === undefined;
    const ourChanged = !ourDeleted && !structurallyEqual(ourEntry, baseEntry);
    const theirChanged = !theirDeleted && !structurallyEqual(theirEntry, baseEntry);

    if (ourDeleted && theirDeleted) continue;
    if (ourDeleted && !theirChanged) continue;
    if (theirDeleted && !ourChanged) continue;
    if (ourDeleted && theirChanged) {
      return { ok: false, reason: conflictMsg("ours deleted, theirs modified", spec, k) };
    }
    if (theirDeleted && ourChanged) {
      return { ok: false, reason: conflictMsg("theirs deleted, ours modified", spec, k) };
    }
    if (ourChanged && theirChanged) {
      if (structurallyEqual(ourEntry, theirEntry)) {
        merged.push(ourEntry as Entry);
        continue;
      }
      return { ok: false, reason: conflictMsg("modified differently on each side", spec, k) };
    }
    if (ourChanged) {
      merged.push(ourEntry as Entry);
      continue;
    }
    if (theirChanged) {
      merged.push(theirEntry as Entry);
      continue;
    }
    merged.push(baseEntry);
  }

  const oursAdded = new Map<unknown, Entry>();
  for (const [k, e] of oursByKey) if (!baseByKey.has(k)) oursAdded.set(k, e);
  const theirsAdded = new Map<unknown, Entry>();
  for (const [k, e] of theirsByKey) if (!baseByKey.has(k)) theirsAdded.set(k, e);

  const additions = new Map<unknown, Entry>(oursAdded);
  for (const [k, theirEntry] of theirsAdded) {
    const ourEntry = additions.get(k);
    if (ourEntry === undefined) {
      additions.set(k, theirEntry);
      continue;
    }
    if (!structurallyEqual(ourEntry, theirEntry)) {
      return { ok: false, reason: conflictMsg("both sides added with different content", spec, k) };
    }
  }
  for (const e of additions.values()) merged.push(e);

  const sortKey = spec.sortBy ?? spec.key;
  merged.sort((a, b) => compareScalar(a[sortKey], b[sortKey]));

  const docMerge = mergeTopLevel(base, ours, theirs, spec.arrayPath);
  if (!docMerge.ok) return docMerge;

  const result = setArray(docMerge.value, spec.arrayPath, merged);
  return { ok: true, result: emit(result, fmt) };
}

type Format = {
  indent: string;
  trailingNewline: boolean;
  eol: "\n" | "\r\n";
};

function detectFormat(text: string): Format {
  const eol: "\n" | "\r\n" = /\r\n/.test(text) ? "\r\n" : "\n";
  const trailingNewline = /\n$/.test(text);
  const lines = text.split(/\r?\n/);
  let indent = "  ";
  for (const line of lines) {
    const m = line.match(/^([\t ]+)\S/);
    if (m) {
      indent = m[1]!;
      break;
    }
  }
  return { indent, trailingNewline, eol };
}

function emit(value: unknown, fmt: Format): string {
  let body = JSON.stringify(value, null, fmt.indent);
  if (fmt.eol === "\r\n") body = body.replace(/\n/g, "\r\n");
  if (fmt.trailingNewline) body += fmt.eol;
  return body;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function getArrayLenient(doc: unknown, arrayPath: string | undefined): Entry[] {
  if (!arrayPath) {
    if (doc === undefined || doc === null) return [];
    if (!Array.isArray(doc)) throw new Error("expected top-level array");
    return doc as Entry[];
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error(`arrayPath "${arrayPath}": expected an object document`);
  }
  const cur = (doc as Record<string, unknown>)[arrayPath];
  if (cur === undefined) return [];
  if (!Array.isArray(cur)) throw new Error(`arrayPath "${arrayPath}": not an array`);
  return cur as Entry[];
}

function mergeTopLevel(
  base: unknown,
  ours: unknown,
  theirs: unknown,
  arrayPath: string | undefined,
): { ok: true; value: unknown } | { ok: false; reason: string } {
  if (!arrayPath) {
    return { ok: true, value: null };
  }
  if (
    base === null || typeof base !== "object" || Array.isArray(base) ||
    ours === null || typeof ours !== "object" || Array.isArray(ours) ||
    theirs === null || typeof theirs !== "object" || Array.isArray(theirs)
  ) {
    return { ok: false, reason: "expected object document at all three sides" };
  }
  const skip = arrayPath;
  const baseO = base as Record<string, unknown>;
  const oursO = ours as Record<string, unknown>;
  const theirsO = theirs as Record<string, unknown>;

  const result: Record<string, unknown> = {};
  const keys = new Set<string>([...Object.keys(baseO), ...Object.keys(oursO), ...Object.keys(theirsO)]);
  for (const k of keys) {
    if (k === skip) continue;
    const bv = baseO[k];
    const ov = oursO[k];
    const tv = theirsO[k];
    const bHas = k in baseO;
    const oHas = k in oursO;
    const tHas = k in theirsO;
    const oChanged = !oHas !== !bHas || (bHas && oHas && !structurallyEqual(bv, ov));
    const tChanged = !tHas !== !bHas || (bHas && tHas && !structurallyEqual(bv, tv));
    if (oChanged && tChanged) {
      if (oHas && tHas && structurallyEqual(ov, tv)) {
        result[k] = ov;
      } else if (!oHas && !tHas) {
        // both deleted
      } else {
        return { ok: false, reason: `conflict on top-level field "${k}"` };
      }
      continue;
    }
    if (oChanged) {
      if (oHas) result[k] = ov;
      continue;
    }
    if (tChanged) {
      if (tHas) result[k] = tv;
      continue;
    }
    if (bHas) result[k] = bv;
  }
  return { ok: true, value: result };
}

function byKey(arr: Entry[], key: string): Map<unknown, Entry> {
  const m = new Map<unknown, Entry>();
  for (const e of arr) m.set(e[key], e);
  return m;
}

function conflictMsg(detail: string, spec: MergeSpec, key: unknown): string {
  return `conflict on ${spec.key}=${String(key)}: ${detail}`;
}

function structurallyEqual(a: unknown, b: unknown): boolean {
  return canonicalize(a) === canonicalize(b);
}

function canonicalize(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalize).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + canonicalize((v as Record<string, unknown>)[k]))
      .join(",") +
    "}"
  );
}

type Entry = Record<string, unknown>;

function setArray(merged: unknown, arrayPath: string | undefined, value: Entry[]): unknown {
  if (!arrayPath) return value;
  const obj = (merged ?? {}) as Record<string, unknown>;
  return { ...obj, [arrayPath]: value };
}

function compareScalar(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

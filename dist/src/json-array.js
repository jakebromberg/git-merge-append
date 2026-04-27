export function mergeJsonArray(baseText, oursText, theirsText, spec) {
    if (spec.arrayPath && spec.arrayPath.includes(".")) {
        return { ok: false, reason: "nested arrayPath is not supported in v1; use a single field name" };
    }
    const baseClean = stripBom(baseText);
    const oursClean = stripBom(oursText);
    const theirsClean = stripBom(theirsText);
    const fmt = detectFormat(baseClean);
    const base = JSON.parse(baseClean);
    const ours = JSON.parse(oursClean);
    const theirs = JSON.parse(theirsClean);
    const baseArr = getArrayLenient(base, spec.arrayPath);
    const oursArr = getArrayLenient(ours, spec.arrayPath);
    const theirsArr = getArrayLenient(theirs, spec.arrayPath);
    const baseByKey = byKey(baseArr, spec.key);
    const oursByKey = byKey(oursArr, spec.key);
    const theirsByKey = byKey(theirsArr, spec.key);
    const merged = [];
    for (const [k, baseEntry] of baseByKey) {
        const ourEntry = oursByKey.get(k);
        const theirEntry = theirsByKey.get(k);
        const ourDeleted = ourEntry === undefined;
        const theirDeleted = theirEntry === undefined;
        const ourChanged = !ourDeleted && !structurallyEqual(ourEntry, baseEntry);
        const theirChanged = !theirDeleted && !structurallyEqual(theirEntry, baseEntry);
        if (ourDeleted && theirDeleted)
            continue;
        if (ourDeleted && !theirChanged)
            continue;
        if (theirDeleted && !ourChanged)
            continue;
        if (ourDeleted && theirChanged) {
            return { ok: false, reason: conflictMsg("ours deleted, theirs modified", spec, k) };
        }
        if (theirDeleted && ourChanged) {
            return { ok: false, reason: conflictMsg("theirs deleted, ours modified", spec, k) };
        }
        if (ourChanged && theirChanged) {
            if (structurallyEqual(ourEntry, theirEntry)) {
                merged.push(ourEntry);
                continue;
            }
            return { ok: false, reason: conflictMsg("modified differently on each side", spec, k) };
        }
        if (ourChanged) {
            merged.push(ourEntry);
            continue;
        }
        if (theirChanged) {
            merged.push(theirEntry);
            continue;
        }
        merged.push(baseEntry);
    }
    const oursAdded = new Map();
    for (const [k, e] of oursByKey)
        if (!baseByKey.has(k))
            oursAdded.set(k, e);
    const theirsAdded = new Map();
    for (const [k, e] of theirsByKey)
        if (!baseByKey.has(k))
            theirsAdded.set(k, e);
    const additions = new Map(oursAdded);
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
    for (const e of additions.values())
        merged.push(e);
    const sortKey = spec.sortBy ?? spec.key;
    merged.sort((a, b) => compareScalar(a[sortKey], b[sortKey]));
    const docMerge = mergeTopLevel(base, ours, theirs, spec.arrayPath);
    if (!docMerge.ok)
        return docMerge;
    const result = setArray(docMerge.value, spec.arrayPath, merged);
    return { ok: true, result: emit(result, fmt) };
}
function detectFormat(text) {
    const eol = /\r\n/.test(text) ? "\r\n" : "\n";
    const trailingNewline = /\n$/.test(text);
    const lines = text.split(/\r?\n/);
    let indent = "  ";
    for (const line of lines) {
        const m = line.match(/^([\t ]+)\S/);
        if (m) {
            indent = m[1];
            break;
        }
    }
    return { indent, trailingNewline, eol };
}
function emit(value, fmt) {
    let body = JSON.stringify(value, null, fmt.indent);
    if (fmt.eol === "\r\n")
        body = body.replace(/\n/g, "\r\n");
    if (fmt.trailingNewline)
        body += fmt.eol;
    return body;
}
function stripBom(text) {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
function getArrayLenient(doc, arrayPath) {
    if (!arrayPath) {
        if (doc === undefined || doc === null)
            return [];
        if (!Array.isArray(doc))
            throw new Error("expected top-level array");
        return doc;
    }
    if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
        throw new Error(`arrayPath "${arrayPath}": expected an object document`);
    }
    const cur = doc[arrayPath];
    if (cur === undefined)
        return [];
    if (!Array.isArray(cur))
        throw new Error(`arrayPath "${arrayPath}": not an array`);
    return cur;
}
function mergeTopLevel(base, ours, theirs, arrayPath) {
    if (!arrayPath) {
        return { ok: true, value: null };
    }
    if (base === null || typeof base !== "object" || Array.isArray(base) ||
        ours === null || typeof ours !== "object" || Array.isArray(ours) ||
        theirs === null || typeof theirs !== "object" || Array.isArray(theirs)) {
        return { ok: false, reason: "expected object document at all three sides" };
    }
    const skip = arrayPath;
    const baseO = base;
    const oursO = ours;
    const theirsO = theirs;
    const result = {};
    const keys = new Set([...Object.keys(baseO), ...Object.keys(oursO), ...Object.keys(theirsO)]);
    for (const k of keys) {
        if (k === skip)
            continue;
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
            }
            else if (!oHas && !tHas) {
                // both deleted
            }
            else {
                return { ok: false, reason: `conflict on top-level field "${k}"` };
            }
            continue;
        }
        if (oChanged) {
            if (oHas)
                result[k] = ov;
            continue;
        }
        if (tChanged) {
            if (tHas)
                result[k] = tv;
            continue;
        }
        if (bHas)
            result[k] = bv;
    }
    return { ok: true, value: result };
}
function byKey(arr, key) {
    const m = new Map();
    for (const e of arr)
        m.set(e[key], e);
    return m;
}
function conflictMsg(detail, spec, key) {
    return `conflict on ${spec.key}=${String(key)}: ${detail}`;
}
function structurallyEqual(a, b) {
    return canonicalize(a) === canonicalize(b);
}
function canonicalize(v) {
    if (v === null || typeof v !== "object")
        return JSON.stringify(v);
    if (Array.isArray(v))
        return "[" + v.map(canonicalize).join(",") + "]";
    const keys = Object.keys(v).sort();
    return ("{" +
        keys
            .map((k) => JSON.stringify(k) + ":" + canonicalize(v[k]))
            .join(",") +
        "}");
}
function setArray(merged, arrayPath, value) {
    if (!arrayPath)
        return value;
    const obj = (merged ?? {});
    return { ...obj, [arrayPath]: value };
}
function compareScalar(a, b) {
    if (typeof a === "number" && typeof b === "number")
        return a - b;
    return String(a).localeCompare(String(b));
}
//# sourceMappingURL=json-array.js.map
import { describe, it, expect } from "vitest";
import { mergeJsonArray, type MergeSpec } from "../src/json-array.js";

const journalSpec: MergeSpec = { arrayPath: "entries", key: "idx", sortBy: "idx" };

function wrap(entries: unknown[]): string {
  return JSON.stringify({ version: "5", entries }, null, 2) + "\n";
}

describe("mergeJsonArray — disjoint additions", () => {
  it("merges entries appended on each side, sorted by sortBy", () => {
    const base = `{
  "version": "5",
  "entries": [
    { "idx": 0, "tag": "init" }
  ]
}
`;
    const ours = `{
  "version": "5",
  "entries": [
    { "idx": 0, "tag": "init" },
    { "idx": 1, "tag": "ours" }
  ]
}
`;
    const theirs = `{
  "version": "5",
  "entries": [
    { "idx": 0, "tag": "init" },
    { "idx": 2, "tag": "theirs" }
  ]
}
`;
    const result = mergeJsonArray(base, ours, theirs, {
      arrayPath: "entries",
      key: "idx",
      sortBy: "idx",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.result)).toEqual({
      version: "5",
      entries: [
        { idx: 0, tag: "init" },
        { idx: 1, tag: "ours" },
        { idx: 2, tag: "theirs" },
      ],
    });
  });
});

describe("mergeJsonArray — same-key on both sides", () => {
  it("clean when both sides add the same key with structurally-equal content", () => {
    const entry = { idx: 1, tag: "shared", when: 1700000000 };
    const result = mergeJsonArray(
      wrap([{ idx: 0, tag: "init" }]),
      wrap([{ idx: 0, tag: "init" }, entry]),
      wrap([{ idx: 0, tag: "init" }, { ...entry }]),
      journalSpec,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.result).entries).toEqual([
      { idx: 0, tag: "init" },
      entry,
    ]);
  });

  it("clean when both sides add the same key with key-order-permuted but equal content", () => {
    const result = mergeJsonArray(
      wrap([]),
      wrap([{ idx: 1, tag: "x", when: 100 }]),
      wrap([{ when: 100, idx: 1, tag: "x" }]),
      journalSpec,
    );
    expect(result.ok).toBe(true);
  });

  it("conflict when both sides add the same key with non-equal content", () => {
    const result = mergeJsonArray(
      wrap([{ idx: 0, tag: "init" }]),
      wrap([{ idx: 0, tag: "init" }, { idx: 1, tag: "ours-tag" }]),
      wrap([{ idx: 0, tag: "init" }, { idx: 1, tag: "theirs-tag" }]),
      journalSpec,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/idx.*1/);
  });
});

describe("mergeJsonArray — modifications to existing entries", () => {
  it("takes the modified version when only one side changes an existing entry", () => {
    const result = mergeJsonArray(
      wrap([{ idx: 0, tag: "init", note: "old" }]),
      wrap([{ idx: 0, tag: "init", note: "new-from-ours" }]),
      wrap([{ idx: 0, tag: "init", note: "old" }]),
      journalSpec,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.result).entries[0].note).toBe("new-from-ours");
  });

  it("clean when both sides modify an existing entry identically", () => {
    const result = mergeJsonArray(
      wrap([{ idx: 0, tag: "init", note: "old" }]),
      wrap([{ idx: 0, tag: "init", note: "new" }]),
      wrap([{ idx: 0, tag: "init", note: "new" }]),
      journalSpec,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.result).entries[0].note).toBe("new");
  });

  it("conflict when both sides modify an existing entry differently", () => {
    const result = mergeJsonArray(
      wrap([{ idx: 0, tag: "init", note: "old" }]),
      wrap([{ idx: 0, tag: "init", note: "ours-new" }]),
      wrap([{ idx: 0, tag: "init", note: "theirs-new" }]),
      journalSpec,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/idx.*0/);
  });
});

describe("mergeJsonArray — deletions", () => {
  it("drops the entry when both sides delete it", () => {
    const result = mergeJsonArray(
      wrap([{ idx: 0, tag: "init" }, { idx: 1, tag: "doomed" }]),
      wrap([{ idx: 0, tag: "init" }]),
      wrap([{ idx: 0, tag: "init" }]),
      journalSpec,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.result).entries).toEqual([{ idx: 0, tag: "init" }]);
  });

  it("drops the entry when one side deletes and the other keeps unchanged", () => {
    const result = mergeJsonArray(
      wrap([{ idx: 0, tag: "init" }, { idx: 1, tag: "doomed" }]),
      wrap([{ idx: 0, tag: "init" }]),
      wrap([{ idx: 0, tag: "init" }, { idx: 1, tag: "doomed" }]),
      journalSpec,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.result).entries).toEqual([{ idx: 0, tag: "init" }]);
  });

  it("conflict when one side deletes and the other modifies", () => {
    const result = mergeJsonArray(
      wrap([{ idx: 0, tag: "init" }, { idx: 1, tag: "old" }]),
      wrap([{ idx: 0, tag: "init" }]),
      wrap([{ idx: 0, tag: "init" }, { idx: 1, tag: "modified" }]),
      journalSpec,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/idx.*1/);
  });
});

describe("mergeJsonArray — top-level fields", () => {
  it("takes the modified top-level field when only one side changes it", () => {
    const result = mergeJsonArray(
      JSON.stringify({ version: "5", entries: [] }, null, 2) + "\n",
      JSON.stringify({ version: "6", entries: [] }, null, 2) + "\n",
      JSON.stringify({ version: "5", entries: [] }, null, 2) + "\n",
      journalSpec,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.result).version).toBe("6");
  });

  it("conflict when both sides modify a top-level field divergently", () => {
    const result = mergeJsonArray(
      JSON.stringify({ version: "5", entries: [] }, null, 2) + "\n",
      JSON.stringify({ version: "6", entries: [] }, null, 2) + "\n",
      JSON.stringify({ version: "7", entries: [] }, null, 2) + "\n",
      journalSpec,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/version/i);
  });
});

describe("mergeJsonArray — degenerate inputs", () => {
  it("handles an empty base array", () => {
    const result = mergeJsonArray(
      wrap([]),
      wrap([{ idx: 1, tag: "a" }]),
      wrap([{ idx: 2, tag: "b" }]),
      journalSpec,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.result).entries).toEqual([
      { idx: 1, tag: "a" },
      { idx: 2, tag: "b" },
    ]);
  });

  it("supports top-level-array shape when arrayPath is omitted", () => {
    const base = JSON.stringify([{ idx: 0 }], null, 2) + "\n";
    const ours = JSON.stringify([{ idx: 0 }, { idx: 1 }], null, 2) + "\n";
    const theirs = JSON.stringify([{ idx: 0 }, { idx: 2 }], null, 2) + "\n";
    const result = mergeJsonArray(base, ours, theirs, { key: "idx", sortBy: "idx" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.result)).toEqual([{ idx: 0 }, { idx: 1 }, { idx: 2 }]);
  });
});

describe("mergeJsonArray — idempotency", () => {
  it("merge(M, M, M) = M", () => {
    const m = wrap([{ idx: 0 }, { idx: 1 }]);
    const result = mergeJsonArray(m, m, m, journalSpec);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.result)).toEqual(JSON.parse(m));
  });

  it("merge(base, base, theirs) = theirs (modulo formatting)", () => {
    const base = wrap([{ idx: 0 }]);
    const theirs = wrap([{ idx: 0 }, { idx: 1, tag: "x" }]);
    const result = mergeJsonArray(base, base, theirs, journalSpec);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.result)).toEqual(JSON.parse(theirs));
  });

  it("merge(base, ours, ours) = ours (modulo formatting)", () => {
    const base = wrap([{ idx: 0 }]);
    const ours = wrap([{ idx: 0 }, { idx: 1, tag: "x" }]);
    const result = mergeJsonArray(base, ours, ours, journalSpec);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.result)).toEqual(JSON.parse(ours));
  });
});

describe("mergeJsonArray — formatting preservation", () => {
  it("preserves 4-space indent from base", () => {
    const base = JSON.stringify({ entries: [{ idx: 0 }] }, null, 4) + "\n";
    const ours = JSON.stringify({ entries: [{ idx: 0 }, { idx: 1 }] }, null, 4) + "\n";
    const theirs = JSON.stringify({ entries: [{ idx: 0 }, { idx: 2 }] }, null, 4) + "\n";
    const result = mergeJsonArray(base, ours, theirs, journalSpec);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result).toContain("    "); // 4-space indent at depth 1
    const lines = result.result.split("\n");
    expect(lines.some((l) => l.startsWith("        "))).toBe(true); // 8 spaces at depth 2
  });

  it("preserves tab indent from base", () => {
    const base = JSON.stringify({ entries: [{ idx: 0 }] }, null, "\t") + "\n";
    const ours = JSON.stringify({ entries: [{ idx: 0 }, { idx: 1 }] }, null, "\t") + "\n";
    const theirs = JSON.stringify({ entries: [{ idx: 0 }, { idx: 2 }] }, null, "\t") + "\n";
    const result = mergeJsonArray(base, ours, theirs, journalSpec);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result).toMatch(/\n\t"entries"/);
  });

  it("preserves CRLF line endings when base uses CRLF", () => {
    const base = (JSON.stringify({ entries: [{ idx: 0 }] }, null, 2) + "\n").replace(/\n/g, "\r\n");
    const ours = (JSON.stringify({ entries: [{ idx: 0 }, { idx: 1 }] }, null, 2) + "\n").replace(/\n/g, "\r\n");
    const theirs = (JSON.stringify({ entries: [{ idx: 0 }, { idx: 2 }] }, null, 2) + "\n").replace(/\n/g, "\r\n");
    const result = mergeJsonArray(base, ours, theirs, journalSpec);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result).toContain("\r\n");
    expect(result.result).not.toMatch(/[^\r]\n/);
  });

  it("omits trailing newline when base has none", () => {
    const base = JSON.stringify({ entries: [{ idx: 0 }] }, null, 2);
    const ours = JSON.stringify({ entries: [{ idx: 0 }, { idx: 1 }] }, null, 2);
    const theirs = JSON.stringify({ entries: [{ idx: 0 }, { idx: 2 }] }, null, 2);
    const result = mergeJsonArray(base, ours, theirs, journalSpec);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.endsWith("\n")).toBe(false);
  });

  it("tolerates a leading BOM in any input", () => {
    const bom = "\uFEFF";
    const base = bom + JSON.stringify({ entries: [{ idx: 0 }] }, null, 2) + "\n";
    const ours = JSON.stringify({ entries: [{ idx: 0 }, { idx: 1 }] }, null, 2) + "\n";
    const theirs = bom + JSON.stringify({ entries: [{ idx: 0 }, { idx: 2 }] }, null, 2) + "\n";
    const result = mergeJsonArray(base, ours, theirs, journalSpec);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.result.replace(/^\uFEFF/, "")).entries).toHaveLength(3);
  });

  it("defaults to 2-space indent when base has no entries to detect from", () => {
    const base = "{}\n";
    const ours = JSON.stringify({ entries: [{ idx: 1 }] }, null, 2) + "\n";
    const theirs = JSON.stringify({ entries: [{ idx: 2 }] }, null, 2) + "\n";
    const result = mergeJsonArray(base, ours, theirs, journalSpec);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result).toMatch(/\n  "entries"/);
  });
});

describe("mergeJsonArray — input validation", () => {
  it("rejects nested arrayPath in v1", () => {
    const result = mergeJsonArray(
      JSON.stringify({ meta: { entries: [] } }, null, 2) + "\n",
      JSON.stringify({ meta: { entries: [{ idx: 1 }] } }, null, 2) + "\n",
      JSON.stringify({ meta: { entries: [{ idx: 2 }] } }, null, 2) + "\n",
      { arrayPath: "meta.entries", key: "idx" },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/nested/i);
  });

  it("defaults sortBy to key when omitted", () => {
    const result = mergeJsonArray(
      wrap([]),
      wrap([{ idx: 5 }, { idx: 2 }]),
      wrap([{ idx: 1 }, { idx: 3 }]),
      { arrayPath: "entries", key: "idx" }, // no sortBy
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.result).entries.map((e: { idx: number }) => e.idx)).toEqual([
      1, 2, 3, 5,
    ]);
  });

  it("sorts string keys by code-point order, not by host locale", () => {
    // 'Z' (0x5A) sorts before 'a' (0x61) in code-point order. Locale-aware
    // collation (e.g., en-US) usually puts 'a' before 'Z' instead. Pin the
    // byte-wise ordering so concurrent collaborators on different locales
    // produce identical merged output.
    const result = mergeJsonArray(
      JSON.stringify({ entries: [] }, null, 2) + "\n",
      JSON.stringify({ entries: [{ id: "Zulu" }, { id: "alpha" }] }, null, 2) + "\n",
      JSON.stringify({ entries: [{ id: "Bravo" }, { id: "charlie" }] }, null, 2) + "\n",
      { arrayPath: "entries", key: "id" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.result).entries.map((e: { id: string }) => e.id)).toEqual([
      "Bravo", "Zulu", "alpha", "charlie",
    ]);
  });
});

import { describe, it, expect } from "vitest";
import { parseArgs } from "../src/cli.js";

describe("parseArgs — driver subcommand", () => {
  it("parses required flags and three positional paths", () => {
    const parsed = parseArgs([
      "driver",
      "--array-path", "entries",
      "--key", "idx",
      "--", "/tmp/base.json", "/tmp/ours.json", "/tmp/theirs.json",
    ]);
    expect(parsed).toEqual({
      kind: "driver",
      spec: { arrayPath: "entries", key: "idx", sortBy: undefined },
      base: "/tmp/base.json",
      ours: "/tmp/ours.json",
      theirs: "/tmp/theirs.json",
    });
  });

  it("accepts optional --sort-by", () => {
    const parsed = parseArgs([
      "driver",
      "--array-path", "entries",
      "--key", "idx",
      "--sort-by", "when",
      "--", "a", "b", "c",
    ]);
    expect(parsed.kind).toBe("driver");
    if (parsed.kind !== "driver") return;
    expect(parsed.spec.sortBy).toBe("when");
  });

  it("treats arguments after -- as positional even if they look like flags", () => {
    const parsed = parseArgs([
      "driver",
      "--array-path", "entries",
      "--key", "idx",
      "--", "--weird-name.json", "ours.json", "theirs.json",
    ]);
    expect(parsed.kind).toBe("driver");
    if (parsed.kind !== "driver") return;
    expect(parsed.base).toBe("--weird-name.json");
  });

  it("errors when --key is missing", () => {
    const parsed = parseArgs([
      "driver",
      "--array-path", "entries",
      "--", "a", "b", "c",
    ]);
    expect(parsed.kind).toBe("error");
    if (parsed.kind !== "error") return;
    expect(parsed.message).toMatch(/--key/);
  });

  it("errors when fewer than three positional paths are supplied", () => {
    const parsed = parseArgs([
      "driver",
      "--key", "idx",
      "--", "a", "b",
    ]);
    expect(parsed.kind).toBe("error");
  });

  it("errors when an unknown flag is passed before --", () => {
    const parsed = parseArgs([
      "driver",
      "--key", "idx",
      "--bogus", "x",
      "--", "a", "b", "c",
    ]);
    expect(parsed.kind).toBe("error");
    if (parsed.kind !== "error") return;
    expect(parsed.message).toMatch(/--bogus/);
  });

  it("errors when a flag is missing its value", () => {
    const parsed = parseArgs([
      "driver",
      "--key",
    ]);
    expect(parsed.kind).toBe("error");
  });

  it("supports omitted --array-path (top-level array shape)", () => {
    const parsed = parseArgs([
      "driver",
      "--key", "idx",
      "--", "a", "b", "c",
    ]);
    expect(parsed.kind).toBe("driver");
    if (parsed.kind !== "driver") return;
    expect(parsed.spec.arrayPath).toBeUndefined();
  });
});


describe("parseArgs — help and errors", () => {
  it("--help returns help kind", () => {
    expect(parseArgs(["--help"]).kind).toBe("help");
    expect(parseArgs(["-h"]).kind).toBe("help");
  });

  it("no args returns help", () => {
    expect(parseArgs([]).kind).toBe("help");
  });

  it("unknown subcommand returns error", () => {
    const parsed = parseArgs(["bogus"]);
    expect(parsed.kind).toBe("error");
    if (parsed.kind !== "error") return;
    expect(parsed.message).toMatch(/bogus/);
  });
});

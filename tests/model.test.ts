import { describe, expect, it } from "vitest";

import {
  applyFilters,
  buildEntries,
  buildTreeRows,
  canPreview,
  collectDevices,
  collectFolders,
  type Filters,
  formatSize,
  highlightParts,
  type Matcher,
  sortEntries,
  splitPath,
} from "../src/model";
import type { DeletedRecord } from "../src/sync-api";

const DAY = 24 * 3600 * 1000;
const NOW = Date.UTC(2026, 10, 14, 12);

function record(path: string, daysAgo: number, extra: Partial<DeletedRecord> = {}): DeletedRecord {
  return { uid: path + daysAgo, path, ts: NOW - daysAgo * DAY, size: 100, device: "Mac", folder: false, ...extra };
}

const RECORDS: DeletedRecord[] = [
  record("Projects/Alpha/plan.md", 1),
  record("Projects/Alpha/plan.md", 10), // older deletion of the same path
  record("Projects/Beta/logo.png", 3, { device: "iPhone", size: 2048 }),
  record("inbox.md", 40),
  record("Projects", 2, { folder: true }),
  record(".obsidian/plugins/x/data.json", 5),
];

const BASE: Filters = {
  query: "",
  scope: "all",
  folder: null,
  kind: "all",
  date: "any",
  from: null,
  to: null,
  device: null,
  hideExisting: false,
};

const substring: (query: string) => Matcher = (query) => (text) => {
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  return index === -1 ? null : { score: -index, matches: [[index, index + query.length]] };
};

function filter(filters: Partial<Filters>, exists: (path: string) => boolean = () => false) {
  const entries = buildEntries(RECORDS, { configDir: ".obsidian" });
  const merged = { ...BASE, ...filters };
  return applyFilters(entries, merged, {
    now: NOW,
    exists,
    matcher: merged.query ? substring(merged.query) : null,
  }).map((item) => item.entry.path);
}

describe("splitPath", () => {
  it("splits folder, name and extension", () => {
    expect(splitPath("a/b/c.MD")).toEqual({ folder: "a/b", name: "c.MD", extension: "md" });
    expect(splitPath("root.txt")).toEqual({ folder: "", name: "root.txt", extension: "txt" });
    expect(splitPath("a/.hidden")).toEqual({ folder: "a", name: ".hidden", extension: "" });
  });
});

describe("buildEntries", () => {
  it("keeps one entry per path with the newest deletion, and drops folders and config files", () => {
    const entries = buildEntries(RECORDS, { configDir: ".obsidian" });
    expect(entries.map((entry) => entry.path).toSorted()).toEqual([
      "Projects/Alpha/plan.md",
      "Projects/Beta/logo.png",
      "inbox.md",
    ]);
    const plan = entries.find((entry) => entry.path === "Projects/Alpha/plan.md");
    expect(plan?.ts).toBe(NOW - DAY);
    expect(plan?.kind).toBe("note");
  });

  it("shows config folder files when asked", () => {
    const entries = buildEntries(RECORDS, { configDir: ".obsidian", showConfig: true });
    expect(entries.some((entry) => entry.path.startsWith(".obsidian/"))).toBe(true);
  });
});

describe("applyFilters", () => {
  it("filters by folder including subfolders", () => {
    expect(filter({ folder: "Projects" }).toSorted()).toEqual(["Projects/Alpha/plan.md", "Projects/Beta/logo.png"]);
  });

  it("treats the empty folder as the vault root only", () => {
    expect(filter({ folder: "" })).toEqual(["inbox.md"]);
  });

  it("does not match a folder that only shares a prefix", () => {
    expect(filter({ folder: "Proj" })).toEqual([]);
  });

  it("filters by kind, device and date preset", () => {
    expect(filter({ kind: "image" })).toEqual(["Projects/Beta/logo.png"]);
    expect(filter({ device: "iPhone" })).toEqual(["Projects/Beta/logo.png"]);
    expect(filter({ date: "7d" }).toSorted()).toEqual(["Projects/Alpha/plan.md", "Projects/Beta/logo.png"]);
  });

  it("filters by a custom date range", () => {
    expect(filter({ date: "custom", from: NOW - 5 * DAY, to: NOW - 2 * DAY })).toEqual(["Projects/Beta/logo.png"]);
  });

  it("hides paths that exist in the vault again", () => {
    expect(filter({ hideExisting: true }, (path) => path === "inbox.md")).not.toContain("inbox.md");
  });

  it("searches the full path and keeps match ranges", () => {
    const entries = buildEntries(RECORDS, { configDir: ".obsidian" });
    const result = applyFilters(
      entries,
      { ...BASE, query: "beta" },
      { now: NOW, exists: () => false, matcher: substring("beta") },
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.matches).toEqual([[9, 13]]);
  });
});

describe("search scope", () => {
  it("searches only names, only folders, or both", () => {
    expect(filter({ query: "alpha" })).toEqual(["Projects/Alpha/plan.md"]);
    expect(filter({ query: "alpha", scope: "name" })).toEqual([]);
    expect(filter({ query: "alpha", scope: "folder" })).toEqual(["Projects/Alpha/plan.md"]);
    expect(filter({ query: "plan", scope: "folder" })).toEqual([]);
    expect(filter({ query: "plan", scope: "name" })).toEqual(["Projects/Alpha/plan.md"]);
  });

  it("never matches the folder of a root file", () => {
    expect(filter({ query: "inbox", scope: "folder" })).toEqual([]);
    expect(filter({ query: "inbox", scope: "name" })).toEqual(["inbox.md"]);
  });

  it("keeps name match ranges relative to the full path", () => {
    const entries = buildEntries(RECORDS, { configDir: ".obsidian" });
    const result = applyFilters(
      entries,
      { ...BASE, query: "logo", scope: "name" },
      { now: NOW, exists: () => false, matcher: substring("logo") },
    );
    // "Projects/Beta/logo.png": the name starts at 14.
    expect(result[0]?.matches).toEqual([[14, 18]]);
  });
});

describe("canPreview", () => {
  it("knows which file types the preview can show", () => {
    expect(canPreview({ kind: "note", extension: "md" })).toBe(true);
    expect(canPreview({ kind: "image", extension: "png" })).toBe(true);
    expect(canPreview({ kind: "pdf", extension: "pdf" })).toBe(true);
    expect(canPreview({ kind: "other", extension: "json" })).toBe(true);
    expect(canPreview({ kind: "other", extension: "xlsx" })).toBe(false);
    expect(canPreview({ kind: "other", extension: "zip" })).toBe(false);
  });
});

describe("sortEntries", () => {
  const entries = buildEntries(RECORDS, { configDir: ".obsidian" });
  const items = applyFilters(entries, BASE, { now: NOW, exists: () => false, matcher: null });

  it("sorts by date, newest first", () => {
    expect(sortEntries(items, "ts", "desc").map((item) => item.entry.name)).toEqual([
      "plan.md",
      "logo.png",
      "inbox.md",
    ]);
  });

  it("sorts by size and name", () => {
    expect(sortEntries(items, "size", "desc")[0]?.entry.name).toBe("logo.png");
    expect(sortEntries(items, "name", "asc").map((item) => item.entry.name)).toEqual([
      "inbox.md",
      "logo.png",
      "plan.md",
    ]);
  });

  it("does not change the input array", () => {
    const before = items.map((item) => item.entry.path);
    sortEntries(items, "name", "asc");
    expect(items.map((item) => item.entry.path)).toEqual(before);
  });
});

describe("buildTreeRows", () => {
  const entries = buildEntries(RECORDS, { configDir: ".obsidian" });
  const items = sortEntries(
    applyFilters(entries, BASE, { now: NOW, exists: () => false, matcher: null }),
    "name",
    "asc",
  );

  it("shows only top-level folders and root files when nothing is expanded", () => {
    const rows = buildTreeRows(items, new Set(), false);
    expect(rows.map((row) => (row.type === "folder" ? `${row.path}/ (${row.count})` : row.item.entry.path))).toEqual([
      "Projects/ (2)",
      "inbox.md",
    ]);
  });

  it("opens expanded folders and indents their content", () => {
    const rows = buildTreeRows(items, new Set(["Projects", "Projects/Alpha"]), false);
    expect(rows.map((row) => [row.type === "folder" ? row.path : row.item.entry.path, row.depth])).toEqual([
      ["Projects", 0],
      ["Projects/Alpha", 1],
      ["Projects/Alpha/plan.md", 2],
      ["Projects/Beta", 1],
      ["inbox.md", 0],
    ]);
  });

  it("opens every folder with expandAll", () => {
    const rows = buildTreeRows(items, new Set(), true);
    expect(rows.filter((row) => row.type === "file")).toHaveLength(3);
  });
});

describe("helpers", () => {
  it("collects folders with their parents, and devices", () => {
    const entries = buildEntries(RECORDS, { configDir: ".obsidian" });
    expect(collectFolders(entries)).toEqual(["Projects", "Projects/Alpha", "Projects/Beta"]);
    expect(collectDevices(entries)).toEqual(["iPhone", "Mac"].toSorted((a, b) => a.localeCompare(b)));
  });

  it("formats sizes", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(1536)).toBe("1.5 KB");
    expect(formatSize(50 * 1024 * 1024)).toBe("50 MB");
  });

  it("splits text into highlighted parts with an offset", () => {
    // Path "Projects/Beta/logo.png", match "logo" at 14..18, name starts at 14.
    expect(highlightParts("logo.png", [[14, 18]], 14)).toEqual([
      { text: "logo", hit: true },
      { text: ".png", hit: false },
    ]);
    // A match in the folder part does not show in the name.
    expect(highlightParts("logo.png", [[0, 4]], 14)).toEqual([{ text: "logo.png", hit: false }]);
  });
});

/** Pure data functions: no Obsidian imports, so tests run them directly. */
import type { DeletedRecord, SyncUid } from "./sync-api";

export type FileKind = "note" | "canvas" | "base" | "image" | "pdf" | "audio" | "video" | "other";

export interface TrashEntry {
  uid: SyncUid;
  path: string;
  name: string;
  /** Parent folder path, "" for the vault root. */
  folder: string;
  extension: string;
  kind: FileKind;
  ts: number;
  size: number;
  device: string;
}

export type DatePreset = "any" | "1d" | "7d" | "30d" | "90d" | "365d" | "custom";
export type SortKey = "name" | "folder" | "ts" | "size" | "device";
export type SortDirection = "asc" | "desc";
export type ViewMode = "list" | "tree";
export type SearchScope = "all" | "name" | "folder";

export interface Filters {
  query: string;
  /** Which part of the path the search looks at. */
  scope: SearchScope;
  /** Folder path; includes subfolders. "" means files in the vault root only. null means all folders. */
  folder: string | null;
  kind: FileKind | "all";
  date: DatePreset;
  /** Start of the custom range (ms), inclusive. */
  from: number | null;
  /** End of the custom range (ms), inclusive. */
  to: number | null;
  device: string | null;
  hideExisting: boolean;
}

/** Match positions as [start, end) pairs inside the full path. */
export type MatchRanges = [number, number][];
export type Matcher = (text: string) => { score: number; matches: MatchRanges } | null;

export interface FilteredEntry {
  entry: TrashEntry;
  score: number;
  matches: MatchRanges;
}

const DAY = 24 * 60 * 60 * 1000;

const KIND_BY_EXTENSION: Record<string, FileKind> = {
  md: "note",
  canvas: "canvas",
  base: "base",
  pdf: "pdf",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  bmp: "image",
  avif: "image",
  mp3: "audio",
  wav: "audio",
  m4a: "audio",
  ogg: "audio",
  flac: "audio",
  webm: "video",
  mp4: "video",
  mov: "video",
  mkv: "video",
};

export const TEXT_EXTENSIONS = new Set([
  "md",
  "txt",
  "canvas",
  "base",
  "json",
  "csv",
  "tsv",
  "css",
  "js",
  "ts",
  "html",
  "xml",
  "yml",
  "yaml",
  "svg",
]);

const PREVIEW_KINDS = new Set<FileKind>(["note", "canvas", "base", "image", "pdf", "audio", "video"]);

/** True when the preview pane can show this file type. */
export function canPreview(entry: Pick<TrashEntry, "kind" | "extension">): boolean {
  return PREVIEW_KINDS.has(entry.kind) || TEXT_EXTENSIONS.has(entry.extension) || entry.extension === "";
}

export function splitPath(path: string): { folder: string; name: string; extension: string } {
  const slash = path.lastIndexOf("/");
  const folder = slash === -1 ? "" : path.slice(0, slash);
  const name = slash === -1 ? path : path.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  return { folder, name, extension };
}

export function kindOf(extension: string): FileKind {
  return KIND_BY_EXTENSION[extension] ?? "other";
}

/**
 * One entry per deleted file path. Folder records are dropped (the core
 * dialog drops them too). When a path was deleted more than once, the newest
 * deletion wins.
 */
export function buildEntries(records: DeletedRecord[], options: { configDir?: string; showConfig?: boolean } = {}) {
  const byPath = new Map<string, DeletedRecord>();
  const configPrefix = options.configDir ? options.configDir + "/" : null;
  for (const record of records) {
    if (record.folder) continue;
    if (!options.showConfig && configPrefix && record.path.startsWith(configPrefix)) continue;
    const current = byPath.get(record.path);
    if (!current || record.ts > current.ts) byPath.set(record.path, record);
  }
  const entries: TrashEntry[] = [];
  for (const record of byPath.values()) {
    const { folder, name, extension } = splitPath(record.path);
    entries.push({
      uid: record.uid,
      path: record.path,
      name,
      folder,
      extension,
      kind: kindOf(extension),
      ts: record.ts,
      size: record.size,
      device: record.device,
    });
  }
  return entries;
}

export function dateRange(filters: Pick<Filters, "date" | "from" | "to">, now: number): [number, number] {
  switch (filters.date) {
    case "any":
      return [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY];
    case "custom":
      return [filters.from ?? Number.NEGATIVE_INFINITY, filters.to ?? Number.POSITIVE_INFINITY];
    default:
      return [now - Number.parseInt(filters.date, 10) * DAY, Number.POSITIVE_INFINITY];
  }
}

function inFolder(entry: TrashEntry, folder: string): boolean {
  return folder === "" ? entry.folder === "" : entry.path.startsWith(folder + "/");
}

export function applyFilters(
  entries: TrashEntry[],
  filters: Filters,
  context: { now: number; exists: (path: string) => boolean; matcher: Matcher | null },
): FilteredEntry[] {
  const [start, end] = dateRange(filters, context.now);
  const result: FilteredEntry[] = [];
  for (const entry of entries) {
    if (filters.folder !== null && !inFolder(entry, filters.folder)) continue;
    if (filters.kind !== "all" && entry.kind !== filters.kind) continue;
    if (filters.device !== null && entry.device !== filters.device) continue;
    if (entry.ts < start || entry.ts > end) continue;
    if (filters.hideExisting && context.exists(entry.path)) continue;
    if (context.matcher) {
      const scope = filters.scope ?? "all";
      const target = scope === "name" ? entry.name : scope === "folder" ? entry.folder : entry.path;
      if (target === "") continue;
      const match = context.matcher(target);
      if (!match) continue;
      // Match ranges are always kept relative to the full path.
      const base = scope === "name" && entry.folder !== "" ? entry.folder.length + 1 : 0;
      const matches: MatchRanges = match.matches.map(([from, to]) => [from + base, to + base]);
      result.push({ entry, score: match.score, matches });
    } else {
      result.push({ entry, score: 0, matches: [] });
    }
  }
  return result;
}

function compareEntries(a: TrashEntry, b: TrashEntry, key: SortKey): number {
  switch (key) {
    case "name":
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    case "folder":
      return a.folder.localeCompare(b.folder, undefined, { numeric: true, sensitivity: "base" });
    case "size":
      return a.size - b.size;
    case "device":
      return a.device.localeCompare(b.device);
    case "ts":
      return a.ts - b.ts;
  }
}

/**
 * Sorts by the chosen column. With a search query and no explicit sort the
 * caller can pass "relevance" to keep the best matches first.
 */
export function sortEntries(items: FilteredEntry[], key: SortKey | "relevance", direction: SortDirection) {
  const sign = direction === "asc" ? 1 : -1;
  return items.toSorted((a, b) => {
    if (key === "relevance") return b.score - a.score || b.entry.ts - a.entry.ts;
    return sign * compareEntries(a.entry, b.entry, key) || b.entry.ts - a.entry.ts;
  });
}

export type Row =
  | { type: "folder"; path: string; name: string; depth: number; count: number; expanded: boolean }
  | { type: "file"; item: FilteredEntry; depth: number };

interface FolderNode {
  path: string;
  name: string;
  folders: Map<string, FolderNode>;
  files: FilteredEntry[];
  count: number;
}

function newNode(path: string, name: string): FolderNode {
  return { path, name, folders: new Map(), files: [], count: 0 };
}

/**
 * Groups sorted items under their original folders and flattens the tree into
 * rows for the list. Folders are alphabetical; files keep the given order.
 * A folder is open when `expanded` has its path, or when `expandAll` is true.
 */
export function buildTreeRows(items: FilteredEntry[], expanded: ReadonlySet<string>, expandAll: boolean): Row[] {
  const root = newNode("", "");
  for (const item of items) {
    let node = root;
    node.count++;
    if (item.entry.folder !== "") {
      let path = "";
      for (const part of item.entry.folder.split("/")) {
        path = path ? `${path}/${part}` : part;
        let child = node.folders.get(part);
        if (!child) {
          child = newNode(path, part);
          node.folders.set(part, child);
        }
        child.count++;
        node = child;
      }
    }
    node.files.push(item);
  }

  const rows: Row[] = [];
  const walk = (node: FolderNode, depth: number) => {
    const folders = [...node.folders.values()].toSorted((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
    );
    for (const folder of folders) {
      const open = expandAll || expanded.has(folder.path);
      rows.push({ type: "folder", path: folder.path, name: folder.name, depth, count: folder.count, expanded: open });
      if (open) walk(folder, depth + 1);
    }
    for (const item of node.files) rows.push({ type: "file", item, depth });
  };
  walk(root, 0);
  return rows;
}

export function listRows(items: FilteredEntry[]): Row[] {
  return items.map((item) => ({ type: "file", item, depth: 0 }));
}

/** Every folder that holds a deleted file, including its parent folders, sorted. */
export function collectFolders(entries: TrashEntry[]): string[] {
  const folders = new Set<string>();
  for (const entry of entries) {
    let folder = entry.folder;
    while (folder !== "") {
      if (folders.has(folder)) break;
      folders.add(folder);
      const slash = folder.lastIndexOf("/");
      folder = slash === -1 ? "" : folder.slice(0, slash);
    }
  }
  return [...folders].toSorted((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

export function collectDevices(entries: TrashEntry[]): string[] {
  const devices = new Set<string>();
  for (const entry of entries) if (entry.device) devices.add(entry.device);
  return [...devices].toSorted((a, b) => a.localeCompare(b));
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** Splits text into plain and highlighted parts. `offset` is where text starts inside the matched string. */
export function highlightParts(text: string, matches: MatchRanges, offset: number): { text: string; hit: boolean }[] {
  const parts: { text: string; hit: boolean }[] = [];
  let cursor = 0;
  for (const [rawStart, rawEnd] of matches) {
    const start = Math.max(rawStart - offset, cursor);
    const end = Math.min(rawEnd - offset, text.length);
    if (end <= start) continue;
    if (start > cursor) parts.push({ text: text.slice(cursor, start), hit: false });
    parts.push({ text: text.slice(start, end), hit: true });
    cursor = end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), hit: false });
  return parts;
}

/** Restore logic with injected file operations, so tests can run it without Obsidian. */
import { splitPath } from "./model";
import type { HistoryItem, SyncAccess, SyncUid } from "./sync-api";

export interface RestoreFiles {
  exists(path: string): Promise<boolean>;
  createFolder(path: string): Promise<void>;
  createBinary(path: string, data: ArrayBuffer): Promise<void>;
}

export const NO_CONTENT_REASON =
  "Sync has no saved content for this file. It was not synced before it was deleted, or its versions have expired.";

export type ConflictChoice = "rename" | "skip";

export interface RestoreRequest {
  /** Path of the deleted file. */
  path: string;
  /** Version to restore. When null, the newest version with content is used. */
  uid: SyncUid | null;
  /** Folder to restore into. null restores to the original folder. "" is the vault root. */
  targetFolder: string | null;
  onConflict: ConflictChoice;
}

export type RestoreResult =
  | { status: "restored"; path: string; method: "server" | "local" }
  | { status: "skipped"; path: string; reason: string }
  | { status: "failed"; path: string; code: "no-content" | "error"; reason: string };

function joinPath(folder: string, name: string): string {
  return folder === "" ? name : `${folder}/${name}`;
}

/** "a/b.md" → "a/b (restored).md", then "a/b (restored 2).md", and so on. */
export async function freeRestoredPath(path: string, exists: (path: string) => Promise<boolean>): Promise<string> {
  const { folder, name, extension } = splitPath(path);
  const stem = extension ? name.slice(0, name.length - extension.length - 1) : name;
  const suffix = extension ? `.${name.slice(name.length - extension.length)}` : "";
  for (let attempt = 1; attempt < 1000; attempt++) {
    const label = attempt === 1 ? "restored" : `restored ${attempt}`;
    const candidate = joinPath(folder, `${stem} (${label})${suffix}`);
    // oxlint-disable-next-line no-await-in-loop -- each name depends on the previous check
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error(`No free file name for ${path}`);
}

export interface VersionList {
  /** Versions with content, newest first. */
  versions: HistoryItem[];
  /** True when Sync has older history that was not loaded. */
  more: boolean;
}

/**
 * Loads the versions with content of a file, newest first. It pages through
 * history like the core "Version history" dialog: when a page ends in a rename
 * record, the next page is the history of the old path, so files that were
 * moved and then deleted still show their content.
 */
export async function loadVersions(
  sync: Pick<SyncAccess, "getHistory">,
  path: string,
  options: { maxPages?: number; stopAtFirst?: boolean } = {},
): Promise<VersionList> {
  const maxPages = options.maxPages ?? 5;
  const versions: HistoryItem[] = [];
  let currentPath = path;
  let before: SyncUid | null = null;
  for (let page = 0; page < maxPages; page++) {
    // oxlint-disable-next-line no-await-in-loop -- each page needs the path and uid from the previous page
    const history = await sync.getHistory(currentPath, before);
    let items = history.items;
    let more = history.more;
    const renameIndex = items.findIndex((item) => item.relatedpath !== "" && !item.deleted);
    if (renameIndex !== -1) {
      items = items.slice(0, renameIndex + 1);
      more = true;
    }
    versions.push(...items.filter((item) => !item.deleted && !item.folder));
    if (options.stopAtFirst && versions.length > 0) return { versions, more };
    const last = items.at(-1);
    if (!more || !last) return { versions, more: false };
    currentPath = last.relatedpath || last.path || currentPath;
    before = last.uid;
  }
  return { versions, more: true };
}

/** The newest version of a deleted file that has content (the first history item is the deletion). */
export async function findLatestVersion(
  sync: Pick<SyncAccess, "getHistory">,
  path: string,
): Promise<HistoryItem | null> {
  const { versions } = await loadVersions(sync, path, { stopAtFirst: true });
  return versions[0] ?? null;
}

async function ensureFolder(files: RestoreFiles, folder: string): Promise<void> {
  if (folder === "") return;
  let path = "";
  for (const part of folder.split("/")) {
    path = path ? `${path}/${part}` : part;
    // oxlint-disable-next-line no-await-in-loop -- parent folders must exist before their children
    if (!(await files.exists(path))) await files.createFolder(path);
  }
}

/**
 * Restores one deleted file and never overwrites an existing file.
 *
 * - Original path, path is free, newest version: ask the Sync server to
 *   restore it, exactly like the core "Deleted files" dialog.
 * - Any other case (other folder, older version, or a name conflict that the
 *   user wants renamed): download the version and create the file locally.
 *   Sync then uploads it as a new file.
 */
export async function restoreFile(
  sync: Pick<SyncAccess, "getHistory" | "getContent" | "restoreOnServer">,
  files: RestoreFiles,
  request: RestoreRequest,
): Promise<RestoreResult> {
  try {
    let uid = request.uid;
    let isLatest = false;
    if (uid === null) {
      const version = await findLatestVersion(sync, request.path);
      if (!version) return { status: "failed", path: request.path, code: "no-content", reason: NO_CONTENT_REASON };
      uid = version.uid;
      isLatest = true;
    }

    const { folder, name } = splitPath(request.path);
    const targetFolder = request.targetFolder ?? folder;
    let target = joinPath(targetFolder, name);

    if (await files.exists(target)) {
      if (request.onConflict === "skip") {
        return { status: "skipped", path: target, reason: "A file with this name exists." };
      }
      target = await freeRestoredPath(target, (path) => files.exists(path));
    } else if (isLatest && target === request.path) {
      await sync.restoreOnServer(uid);
      return { status: "restored", path: target, method: "server" };
    }

    const data = await sync.getContent(uid);
    await ensureFolder(files, splitPath(target).folder);
    await files.createBinary(target, data);
    return { status: "restored", path: target, method: "local" };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { status: "failed", path: request.path, code: "error", reason };
  }
}

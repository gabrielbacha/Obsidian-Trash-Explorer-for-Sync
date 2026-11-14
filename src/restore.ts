/** Restore logic with injected file operations, so tests can run it without Obsidian. */
import { splitPath } from "./model";
import type { HistoryItem, SyncAccess, SyncUid } from "./sync-api";

export interface RestoreFiles {
  exists(path: string): Promise<boolean>;
  createFolder(path: string): Promise<void>;
  createBinary(path: string, data: ArrayBuffer): Promise<void>;
}

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
  | { status: "failed"; path: string; reason: string };

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

/** The newest version of a deleted file that has content (the first history item is the deletion). */
export async function findLatestVersion(
  sync: Pick<SyncAccess, "getHistory">,
  path: string,
): Promise<HistoryItem | null> {
  let before: SyncUid | null = null;
  // The core dialog pages through history in the same way. Three pages is plenty
  // to step over the deletion and rename records.
  for (let page = 0; page < 3; page++) {
    // oxlint-disable-next-line no-await-in-loop -- each page needs the uid from the previous page
    const history = await sync.getHistory(path, before);
    const version = history.items.find((item) => !item.deleted && !item.folder);
    if (version) return version;
    const last = history.items.at(-1);
    if (!history.more || !last) return null;
    before = last.uid;
  }
  return null;
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
      if (!version) return { status: "failed", path: request.path, reason: "Sync has no version with content." };
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
    return { status: "failed", path: request.path, reason };
  }
}

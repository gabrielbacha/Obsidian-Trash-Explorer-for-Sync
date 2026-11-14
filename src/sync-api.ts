/**
 * The only file that touches the internal core Sync plugin.
 *
 * Obsidian has no public Sync API. These are the calls that the core
 * "Deleted files" and "Version history" dialogs use (checked in Obsidian
 * 1.15.1). Each call is checked at runtime, so a changed Obsidian version
 * gives one clear error instead of a crash somewhere in the view.
 */

export type SyncUid = number | string;

export interface DeletedRecord {
  uid: SyncUid;
  path: string;
  ts: number;
  size: number;
  device: string;
  folder: boolean;
}

export interface HistoryItem {
  uid: SyncUid;
  path: string;
  ts: number;
  size: number;
  device: string;
  deleted: boolean;
  folder: boolean;
  relatedpath: string;
}

export interface HistoryPage {
  items: HistoryItem[];
  more: boolean;
}

export interface SyncAccess {
  listDeleted(): Promise<DeletedRecord[]>;
  getHistory(path: string, before: SyncUid | null): Promise<HistoryPage>;
  getContent(uid: SyncUid): Promise<ArrayBuffer>;
  /** Restores a version at its own path on the Sync server, like the core dialog. */
  restoreOnServer(uid: SyncUid): Promise<void>;
  showVersionHistory(path: string): void;
}

export type SyncUnavailableReason = "disabled" | "not-connected" | "incompatible";

export class SyncUnavailableError extends Error {
  readonly reason: SyncUnavailableReason;

  constructor(reason: SyncUnavailableReason, message: string) {
    super(message);
    this.name = "SyncUnavailableError";
    this.reason = reason;
  }
}

interface InternalSyncServer {
  listDeleted(): Promise<unknown>;
}

interface InternalSyncPlugin {
  getServer(): Promise<InternalSyncServer | null | undefined>;
  getHistory(path: string, last: SyncUid | null): Promise<unknown>;
  getContentForVersion(uid: SyncUid): Promise<unknown>;
  restoreVersion(uid: SyncUid): Promise<unknown>;
  showVersionHistory(path: string): unknown;
  getRemoteVaultId?(): unknown;
}

interface InternalPluginsHost {
  internalPlugins?: { getEnabledPluginById?(id: string): unknown };
}

const REQUIRED_METHODS = [
  "getServer",
  "getHistory",
  "getContentForVersion",
  "restoreVersion",
  "showVersionHistory",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSyncPlugin(value: unknown): value is InternalSyncPlugin {
  if (!isRecord(value)) return false;
  return REQUIRED_METHODS.every((name) => typeof value[name] === "function");
}

function isUid(value: unknown): value is SyncUid {
  return typeof value === "number" || (typeof value === "string" && value.length > 0);
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function incompatible(detail: string): SyncUnavailableError {
  return new SyncUnavailableError(
    "incompatible",
    `This Obsidian version changed the Sync internals (${detail}). Update Trash Explorer for Sync.`,
  );
}

export function parseDeletedRecords(raw: unknown): DeletedRecord[] {
  if (!Array.isArray(raw)) throw incompatible("deleted list is not an array");
  const records: DeletedRecord[] = [];
  for (const item of raw) {
    if (!isRecord(item) || !isUid(item.uid) || typeof item.path !== "string" || item.path === "") continue;
    records.push({
      uid: item.uid,
      path: item.path,
      ts: asNumber(item.ts),
      size: asNumber(item.size),
      device: asString(item.device),
      folder: item.folder === true,
    });
  }
  return records;
}

export function parseHistoryPage(raw: unknown): HistoryPage {
  if (!isRecord(raw) || !Array.isArray(raw.items)) throw incompatible("history has no items");
  const items: HistoryItem[] = [];
  for (const item of raw.items as unknown[]) {
    if (!isRecord(item) || !isUid(item.uid)) continue;
    items.push({
      uid: item.uid,
      path: asString(item.path),
      ts: asNumber(item.ts),
      size: asNumber(item.size),
      device: asString(item.device),
      deleted: item.deleted === true,
      folder: item.folder === true,
      relatedpath: asString(item.relatedpath),
    });
  }
  return { items, more: raw.more === true };
}

function toArrayBuffer(raw: unknown): ArrayBuffer {
  if (raw instanceof ArrayBuffer) return raw;
  if (ArrayBuffer.isView(raw)) {
    const copy = new Uint8Array(raw.byteLength);
    copy.set(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
    return copy.buffer;
  }
  throw incompatible("version content is not binary data");
}

/** Gets the core Sync plugin, or throws SyncUnavailableError with a reason the view can show. */
export function getSyncAccess(app: unknown): SyncAccess {
  const host = app as InternalPluginsHost;
  const registry = host.internalPlugins;
  if (typeof registry?.getEnabledPluginById !== "function") throw incompatible("no internal plugin registry");

  const plugin = registry.getEnabledPluginById("sync");
  if (plugin === null || plugin === undefined) {
    throw new SyncUnavailableError("disabled", "Sync is not turned on in this vault.");
  }
  if (!isSyncPlugin(plugin)) throw incompatible("Sync methods are missing");

  if (typeof plugin.getRemoteVaultId === "function" && !plugin.getRemoteVaultId()) {
    throw new SyncUnavailableError("not-connected", "This vault is not connected to a remote vault in Sync.");
  }

  return {
    async listDeleted() {
      const server = await plugin.getServer();
      if (!server || typeof server.listDeleted !== "function") {
        throw new SyncUnavailableError("not-connected", "Cannot connect to the Sync server. Check your connection.");
      }
      return parseDeletedRecords(await server.listDeleted());
    },
    async getHistory(path, before) {
      return parseHistoryPage(await plugin.getHistory(path, before));
    },
    async getContent(uid) {
      return toArrayBuffer(await plugin.getContentForVersion(uid));
    },
    async restoreOnServer(uid) {
      await plugin.restoreVersion(uid);
    },
    showVersionHistory(path) {
      plugin.showVersionHistory(path);
    },
  };
}

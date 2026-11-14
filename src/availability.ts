/**
 * Checks in the background whether Sync still has content for deleted files.
 *
 * The deleted-file list does not say this. Only the history of each file does,
 * and Sync answers one request at a time (about 0.3 s each), so only the rows
 * on screen are checked. Results are cached for the life of the view.
 */
import { findLatestVersion } from "./restore";
import type { SyncAccess } from "./sync-api";

export type Availability =
  | { status: "checking" }
  | { status: "content"; size: number }
  | { status: "none" }
  | { status: "error"; message: string };

export class AvailabilityChecker {
  private readonly cache = new Map<string, Availability>();
  private queue: string[] = [];
  private running = false;
  private stopped = false;
  private readonly getSync: () => SyncAccess;
  private readonly onChange: () => void;

  constructor(getSync: () => SyncAccess, onChange: () => void) {
    this.getSync = getSync;
    this.onChange = onChange;
  }

  get(path: string): Availability | undefined {
    return this.cache.get(path);
  }

  set(path: string, value: Availability): void {
    this.cache.set(path, value);
  }

  /** Replaces the waiting queue with these paths, so the rows on screen come first. */
  request(paths: string[]): void {
    this.queue = paths.filter((path) => !this.cache.has(path));
    void this.run();
  }

  clear(): void {
    this.cache.clear();
    this.queue = [];
  }

  stop(): void {
    this.stopped = true;
    this.queue = [];
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      let path = this.queue.shift();
      while (path !== undefined && !this.stopped) {
        if (!this.cache.has(path)) {
          this.cache.set(path, { status: "checking" });
          this.onChange();
          // oxlint-disable-next-line no-await-in-loop -- Sync handles one request at a time
          this.cache.set(path, await this.check(path));
          if (!this.stopped) this.onChange();
        }
        path = this.queue.shift();
      }
    } finally {
      this.running = false;
    }
  }

  private async check(path: string): Promise<Availability> {
    try {
      const version = await findLatestVersion(this.getSync(), path);
      return version ? { status: "content", size: version.size } : { status: "none" };
    } catch (error) {
      return { status: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }
}

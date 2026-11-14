import { describe, expect, it, vi } from "vitest";

import { findLatestVersion, freeRestoredPath, type RestoreFiles, restoreFile } from "../src/restore";
import type { HistoryItem, HistoryPage, SyncUid } from "../src/sync-api";

function item(uid: SyncUid, extra: Partial<HistoryItem> = {}): HistoryItem {
  return {
    uid,
    path: "a/b.md",
    ts: 1,
    size: 3,
    device: "Mac",
    deleted: false,
    folder: false,
    relatedpath: "",
    ...extra,
  };
}

function fakeSync(pages: HistoryPage[]) {
  return {
    getHistory: vi.fn(async (_path: string, before: SyncUid | null) => {
      const index = before === null ? 0 : pages.findIndex((page) => page.items.some((i) => i.uid === before)) + 1;
      return pages[index] ?? { items: [], more: false };
    }),
    getContent: vi.fn(async (uid: SyncUid) => new TextEncoder().encode(`content ${uid}`).buffer),
    restoreOnServer: vi.fn(async () => {}),
  };
}

function fakeFiles(existing: string[]) {
  const paths = new Set(existing);
  const written = new Map<string, string>();
  const files: RestoreFiles = {
    exists: vi.fn(async (path: string) => paths.has(path)),
    createFolder: vi.fn(async (path: string) => {
      paths.add(path);
    }),
    createBinary: vi.fn(async (path: string, data: ArrayBuffer) => {
      if (paths.has(path)) throw new Error("exists");
      paths.add(path);
      written.set(path, new TextDecoder().decode(data));
    }),
  };
  return { files, paths, written };
}

const DELETED_THEN_CONTENT: HistoryPage[] = [{ items: [item(3, { deleted: true }), item(2), item(1)], more: false }];

describe("freeRestoredPath", () => {
  it("adds (restored), then a number", async () => {
    const taken = new Set(["a/b (restored).md"]);
    expect(await freeRestoredPath("a/b.md", async () => false)).toBe("a/b (restored).md");
    expect(await freeRestoredPath("a/b.md", async (path) => taken.has(path))).toBe("a/b (restored 2).md");
    expect(await freeRestoredPath("README", async () => false)).toBe("README (restored)");
  });
});

describe("findLatestVersion", () => {
  it("skips the deletion record", async () => {
    expect((await findLatestVersion(fakeSync(DELETED_THEN_CONTENT), "a/b.md"))?.uid).toBe(2);
  });

  it("pages through history when the first page has only deletions", async () => {
    const sync = fakeSync([
      { items: [item(9, { deleted: true })], more: true },
      { items: [item(8)], more: false },
    ]);
    expect((await findLatestVersion(sync, "a/b.md"))?.uid).toBe(8);
    expect(sync.getHistory).toHaveBeenLastCalledWith("a/b.md", 9);
  });

  it("returns null when no version has content", async () => {
    expect(
      await findLatestVersion(fakeSync([{ items: [item(1, { deleted: true })], more: false }]), "a/b.md"),
    ).toBeNull();
  });
});

describe("restoreFile", () => {
  it("uses the server restore for the newest version at a free original path", async () => {
    const sync = fakeSync(DELETED_THEN_CONTENT);
    const { files } = fakeFiles([]);
    const result = await restoreFile(sync, files, {
      path: "a/b.md",
      uid: null,
      targetFolder: null,
      onConflict: "skip",
    });
    expect(result).toEqual({ status: "restored", path: "a/b.md", method: "server" });
    expect(sync.restoreOnServer).toHaveBeenCalledWith(2);
    expect(files.createBinary).not.toHaveBeenCalled();
  });

  it("writes locally into another folder and creates missing parent folders", async () => {
    const sync = fakeSync(DELETED_THEN_CONTENT);
    const { files, written } = fakeFiles([]);
    const result = await restoreFile(sync, files, {
      path: "a/b.md",
      uid: null,
      targetFolder: "x/y",
      onConflict: "skip",
    });
    expect(result).toEqual({ status: "restored", path: "x/y/b.md", method: "local" });
    expect(files.createFolder).toHaveBeenNthCalledWith(1, "x");
    expect(files.createFolder).toHaveBeenNthCalledWith(2, "x/y");
    expect(written.get("x/y/b.md")).toBe("content 2");
    expect(sync.restoreOnServer).not.toHaveBeenCalled();
  });

  it("restores to the vault root with an empty target folder", async () => {
    const { files, written } = fakeFiles([]);
    const result = await restoreFile(fakeSync(DELETED_THEN_CONTENT), files, {
      path: "a/b.md",
      uid: null,
      targetFolder: "",
      onConflict: "skip",
    });
    expect(result).toMatchObject({ status: "restored", path: "b.md" });
    expect(written.has("b.md")).toBe(true);
  });

  it("writes an older version locally, even at the original path", async () => {
    const sync = fakeSync(DELETED_THEN_CONTENT);
    const { files, written } = fakeFiles([]);
    const result = await restoreFile(sync, files, { path: "a/b.md", uid: 1, targetFolder: null, onConflict: "skip" });
    expect(result).toEqual({ status: "restored", path: "a/b.md", method: "local" });
    expect(written.get("a/b.md")).toBe("content 1");
    expect(sync.getHistory).not.toHaveBeenCalled();
  });

  it("never overwrites: skips on conflict", async () => {
    const { files } = fakeFiles(["a", "a/b.md"]);
    const result = await restoreFile(fakeSync(DELETED_THEN_CONTENT), files, {
      path: "a/b.md",
      uid: null,
      targetFolder: null,
      onConflict: "skip",
    });
    expect(result.status).toBe("skipped");
    expect(files.createBinary).not.toHaveBeenCalled();
  });

  it("never overwrites: renames on conflict", async () => {
    const sync = fakeSync(DELETED_THEN_CONTENT);
    const { files, written } = fakeFiles(["a", "a/b.md"]);
    const result = await restoreFile(sync, files, {
      path: "a/b.md",
      uid: null,
      targetFolder: null,
      onConflict: "rename",
    });
    expect(result).toEqual({ status: "restored", path: "a/b (restored).md", method: "local" });
    expect(written.get("a/b (restored).md")).toBe("content 2");
    expect(sync.restoreOnServer).not.toHaveBeenCalled();
  });

  it("keeps binary content byte for byte", async () => {
    const bytes = new Uint8Array([0, 255, 128, 10, 13]);
    const sync = { ...fakeSync(DELETED_THEN_CONTENT), getContent: vi.fn(async () => bytes.slice().buffer) };
    let stored: Uint8Array | null = null;
    const files: RestoreFiles = {
      exists: async () => false,
      createFolder: async () => {},
      createBinary: async (_path, data) => {
        stored = new Uint8Array(data);
      },
    };
    await restoreFile(sync, files, { path: "img.png", uid: 7, targetFolder: null, onConflict: "skip" });
    expect(stored).toEqual(bytes);
  });

  it("reports failures instead of throwing", async () => {
    const sync = {
      ...fakeSync(DELETED_THEN_CONTENT),
      restoreOnServer: vi.fn(async () => Promise.reject(new Error("offline"))),
    };
    const { files } = fakeFiles([]);
    const result = await restoreFile(sync, files, {
      path: "a/b.md",
      uid: null,
      targetFolder: null,
      onConflict: "skip",
    });
    expect(result).toEqual({ status: "failed", path: "a/b.md", reason: "offline" });
  });

  it("fails clearly when Sync has no content version", async () => {
    const { files } = fakeFiles([]);
    const result = await restoreFile(fakeSync([{ items: [item(1, { deleted: true })], more: false }]), files, {
      path: "a/b.md",
      uid: null,
      targetFolder: null,
      onConflict: "skip",
    });
    expect(result.status).toBe("failed");
  });
});

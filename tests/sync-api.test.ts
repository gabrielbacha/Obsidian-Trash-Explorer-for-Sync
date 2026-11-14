import { describe, expect, it, vi } from "vitest";

import { getSyncAccess, parseDeletedRecords, parseHistoryPage, SyncUnavailableError } from "../src/sync-api";

function appWith(plugin: unknown) {
  return { internalPlugins: { getEnabledPluginById: (id: string) => (id === "sync" ? plugin : null) } };
}

function fullPlugin(overrides: Record<string, unknown> = {}) {
  return {
    getServer: vi.fn(async () => ({
      listDeleted: async () => [{ uid: 1, path: "a.md", ts: 5, size: 2, device: "Mac", deleted: true, folder: false }],
    })),
    getHistory: vi.fn(async () => ({ items: [], more: false })),
    getContentForVersion: vi.fn(async () => new Uint8Array([1, 2, 3])),
    restoreVersion: vi.fn(async () => {}),
    showVersionHistory: vi.fn(),
    getRemoteVaultId: () => "vault-id",
    ...overrides,
  };
}

function reasonOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof SyncUnavailableError ? error.reason : "other";
  }
}

describe("getSyncAccess", () => {
  it("reports Sync as disabled when the core plugin is off", () => {
    expect(reasonOf(() => getSyncAccess(appWith(null)))).toBe("disabled");
  });

  it("reports a changed Obsidian version when methods are missing", () => {
    expect(reasonOf(() => getSyncAccess(appWith({ getServer: () => null })))).toBe("incompatible");
    expect(reasonOf(() => getSyncAccess({}))).toBe("incompatible");
  });

  it("reports a vault that is not connected", () => {
    expect(reasonOf(() => getSyncAccess(appWith(fullPlugin({ getRemoteVaultId: () => "" }))))).toBe("not-connected");
  });

  it("lists deleted files through the server", async () => {
    const access = getSyncAccess(appWith(fullPlugin()));
    expect(await access.listDeleted()).toEqual([
      { uid: 1, path: "a.md", ts: 5, size: 2, device: "Mac", folder: false },
    ]);
  });

  it("fails clearly when the server is not reachable", async () => {
    const access = getSyncAccess(appWith(fullPlugin({ getServer: async () => null })));
    await expect(access.listDeleted()).rejects.toBeInstanceOf(SyncUnavailableError);
  });

  it("returns version content as an ArrayBuffer", async () => {
    const access = getSyncAccess(appWith(fullPlugin()));
    const data = await access.getContent(1);
    expect(data).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(data)]).toEqual([1, 2, 3]);
  });

  it("calls the internal methods with the plugin as this", async () => {
    const plugin = fullPlugin();
    const access = getSyncAccess(appWith(plugin));
    await access.restoreOnServer(4);
    access.showVersionHistory("a.md");
    expect(plugin.restoreVersion).toHaveBeenCalledWith(4);
    expect(plugin.showVersionHistory).toHaveBeenCalledWith("a.md");
  });
});

describe("parsers", () => {
  it("drops malformed deleted records", () => {
    expect(parseDeletedRecords([null, { uid: 1 }, { uid: 2, path: "" }, { uid: 3, path: "ok.md" }])).toEqual([
      { uid: 3, path: "ok.md", ts: 0, size: 0, device: "", folder: false },
    ]);
  });

  it("rejects a non-array deleted list", () => {
    expect(() => parseDeletedRecords({})).toThrow(SyncUnavailableError);
  });

  it("parses history pages", () => {
    expect(parseHistoryPage({ items: [{ uid: 1, deleted: true }, { nope: 1 }], more: true })).toEqual({
      items: [{ uid: 1, path: "", ts: 0, size: 0, device: "", deleted: true, folder: false, relatedpath: "" }],
      more: true,
    });
  });
});

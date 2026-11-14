import { Plugin, type WorkspaceLeaf } from "obsidian";

import { DEFAULT_SETTINGS, parseSettings, type TrashExplorerSettings, TrashExplorerSettingTab } from "./settings";
import { TrashExplorerView, VIEW_TYPE } from "./view";

export default class TrashExplorerPlugin extends Plugin {
  override settings: TrashExplorerSettings = { ...DEFAULT_SETTINGS };

  override async onload(): Promise<void> {
    this.settings = parseSettings(await this.loadData());

    this.registerView(VIEW_TYPE, (leaf) => new TrashExplorerView(leaf, this));

    this.addRibbonIcon("archive-restore", "Open trash explorer for Sync", () => {
      void this.openView();
    });

    this.addCommand({
      id: "open",
      name: "Open deleted files explorer",
      callback: () => void this.openView(),
    });

    this.addCommand({
      id: "refresh",
      name: "Reload deleted files from Sync",
      checkCallback: (checking) => {
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
        if (leaves.length === 0) return false;
        if (!checking) this.refreshViews();
        return true;
      },
    });

    this.addSettingTab(new TrashExplorerSettingTab(this.app, this));
  }

  async openView(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | undefined = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof TrashExplorerView) void leaf.view.reload();
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

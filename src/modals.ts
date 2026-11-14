import { type App, FuzzySuggestModal, Modal, Setting } from "obsidian";

import type { ConflictChoice, RestoreResult } from "./restore";

export interface PathChoice {
  /** Folder path, "" for the vault root, null for "all folders". */
  path: string | null;
  label: string;
}

/** Fuzzy picker over a list of folder paths. */
export class FolderPickerModal extends FuzzySuggestModal<PathChoice> {
  private readonly choices: PathChoice[];
  private readonly onPick: (choice: PathChoice) => void;

  constructor(app: App, choices: PathChoice[], placeholder: string, onPick: (choice: PathChoice) => void) {
    super(app);
    this.choices = choices;
    this.onPick = onPick;
    this.setPlaceholder(placeholder);
  }

  override getItems(): PathChoice[] {
    return this.choices;
  }

  override getItemText(item: PathChoice): string {
    return item.label;
  }

  override onChooseItem(item: PathChoice): void {
    this.onPick(item);
  }
}

/** Vault folders as restore targets, with the root first. */
export function vaultFolderChoices(app: App): PathChoice[] {
  const folders = app.vault
    .getAllFolders(false)
    .map((folder) => folder.path)
    .toSorted((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  return [{ path: "", label: "/" }, ...folders.map((path) => ({ path, label: path }))];
}

/** Asks what to do when restored files would replace files that exist. Resolves null on cancel. */
export function askConflict(app: App, conflicts: string[]): Promise<ConflictChoice | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (choice: ConflictChoice | null) => {
      if (settled) return;
      settled = true;
      resolve(choice);
      modal.close();
    };

    const modal = new Modal(app);
    modal.onClose = () => finish(null);
    const single = conflicts.length === 1;
    modal.setTitle(single ? "A file with this name exists" : `${conflicts.length} files with these names exist`);

    const { contentEl } = modal;
    contentEl.createEl("p", {
      text: "Restore never replaces a file. Restore with a new name that ends in (restored), or skip these files.",
    });
    const list = contentEl.createEl("ul", { cls: "trash-explorer-conflict-list" });
    for (const path of conflicts.slice(0, 8)) list.createEl("li", { text: path });
    if (conflicts.length > 8) list.createEl("li", { text: `and ${conflicts.length - 8} more` });

    new Setting(contentEl)
      .addButton((button) =>
        button
          .setButtonText(single ? "Restore with new name" : "Restore with new names")
          .setCta()
          .onClick(() => finish("rename")),
      )
      .addButton((button) => button.setButtonText(single ? "Skip" : "Skip these files").onClick(() => finish("skip")))
      .addButton((button) => button.setButtonText("Cancel").onClick(() => finish(null)));

    modal.open();
  });
}

/** Shows what happened to each file when a restore was not fully successful. */
export function showRestoreResults(app: App, results: RestoreResult[]): void {
  const modal = new Modal(app);
  const restored = results.filter((result) => result.status === "restored").length;
  const notRestored = results.length - restored;
  modal.setTitle(
    restored === 0
      ? notRestored === 1
        ? "The file was not restored"
        : `${notRestored} files were not restored`
      : `Restored ${restored} of ${results.length} files`,
  );
  const { contentEl } = modal;
  const list = contentEl.createDiv({ cls: "trash-explorer-results" });
  for (const result of results) {
    if (result.status === "restored") continue;
    const row = list.createDiv({ cls: "trash-explorer-result" });
    row.createDiv({ cls: "trash-explorer-result-path", text: result.path });
    row.createDiv({ cls: "trash-explorer-muted", text: result.reason });
  }
  new Setting(contentEl).addButton((button) =>
    button
      .setButtonText("Close")
      .setCta()
      .onClick(() => modal.close()),
  );
  modal.open();
}

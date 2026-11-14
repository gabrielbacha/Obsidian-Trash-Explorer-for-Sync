import {
  debounce,
  ItemView,
  normalizePath,
  Notice,
  prepareFuzzySearch,
  setIcon,
  setTooltip,
  type WorkspaceLeaf,
} from "obsidian";

import type TrashExplorerPlugin from "./main";
import { askConflict, FolderPickerModal, type PathChoice, vaultFolderChoices } from "./modals";
import {
  applyFilters,
  buildEntries,
  buildTreeRows,
  collectDevices,
  collectFolders,
  type DatePreset,
  type FileKind,
  type FilteredEntry,
  type Filters,
  formatSize,
  highlightParts,
  listRows,
  type MatchRanges,
  type Matcher,
  type Row,
  type SortDirection,
  type SortKey,
  sortEntries,
  type TrashEntry,
  type ViewMode,
} from "./model";
import { errorMessage, PreviewPane } from "./preview";
import { type ConflictChoice, type RestoreFiles, restoreFile, type RestoreResult } from "./restore";
import { DATE_LABELS } from "./settings";
import { getSyncAccess, type SyncAccess, type SyncUid, SyncUnavailableError } from "./sync-api";
import { formatFull, fromNow, parseDateInput } from "./time";
import { VirtualList } from "./virtual-list";

export const VIEW_TYPE = "trash-explorer-for-sync";

const KIND_LABELS: Record<FileKind | "all", string> = {
  all: "All types",
  note: "Notes",
  canvas: "Canvases",
  base: "Bases",
  image: "Images",
  pdf: "PDFs",
  audio: "Audio",
  video: "Video",
  other: "Other files",
};

const KIND_ICONS: Record<FileKind, string> = {
  note: "file-text",
  canvas: "layout-dashboard",
  base: "table",
  image: "image",
  pdf: "file-type",
  audio: "file-audio",
  video: "file-video",
  other: "file",
};

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "folder", label: "Folder" },
  { key: "ts", label: "Deleted" },
  { key: "size", label: "Size" },
  { key: "device", label: "Device" },
];

const NARROW_WIDTH = 720;

type LoadState = { status: "loading" } | { status: "ready" } | { status: "error"; error: unknown };

export class TrashExplorerView extends ItemView {
  private readonly plugin: TrashExplorerPlugin;
  private entries: TrashEntry[] = [];
  private filtered: FilteredEntry[] = [];
  private rows: Row[] = [];
  private readonly selected = new Set<string>();
  private readonly expanded = new Set<string>();
  private activePath: string | null = null;
  private anchorIndex: number | null = null;
  private filters: Filters;
  private mode: ViewMode;
  private sortKey: SortKey = "ts";
  private sortDirection: SortDirection = "desc";
  private sortChosen = false;
  private loadState: LoadState = { status: "loading" };
  private loadToken = 0;
  private restoring = false;

  private rootEl!: HTMLElement;
  private searchEl!: HTMLInputElement;
  private folderButton!: HTMLButtonElement;
  private deviceSelect!: HTMLSelectElement;
  private customRangeEl!: HTMLElement;
  private headerEl!: HTMLElement;
  private scrollEl!: HTMLElement;
  private messageEl!: HTMLElement;
  private statusTextEl!: HTMLElement;
  private restoreSelectedButton!: HTMLButtonElement;
  private clearSelectionButton!: HTMLButtonElement;
  private layoutButton!: HTMLButtonElement;
  private restoreToButton!: HTMLButtonElement;
  private list!: VirtualList<Row>;
  private preview!: PreviewPane;
  private sync: SyncAccess | null = null;

  private readonly refilterSoon = debounce(() => this.refilter(false), 150, true);

  constructor(leaf: WorkspaceLeaf, plugin: TrashExplorerPlugin) {
    super(leaf);
    this.plugin = plugin;
    const settings = plugin.settings;
    this.mode = settings.defaultView;
    this.filters = {
      query: "",
      folder: null,
      kind: "all",
      date: settings.defaultDate,
      from: null,
      to: null,
      device: null,
      hideExisting: settings.hideExisting,
    };
  }

  override getViewType(): string {
    return VIEW_TYPE;
  }

  override getDisplayText(): string {
    return "Sync trash";
  }

  override getIcon(): string {
    return "archive-restore";
  }

  override async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.rootEl = this.contentEl.createDiv({ cls: "trash-explorer" });
    this.buildToolbar();
    this.buildFilters();

    const main = this.rootEl.createDiv({ cls: "trash-explorer-main" });
    const listPane = main.createDiv({ cls: "trash-explorer-list-pane" });
    this.headerEl = listPane.createDiv({ cls: "trash-explorer-list-header" });
    this.scrollEl = listPane.createDiv({ cls: "trash-explorer-scroll", attr: { tabindex: "0" } });
    this.messageEl = listPane.createDiv({ cls: "trash-explorer-message" });
    this.buildStatusBar(listPane);

    const previewEl = main.createDiv({ cls: "trash-explorer-preview-pane" });
    this.preview = this.addChild(
      new PreviewPane(this.app, previewEl, () => this.requireSync(), {
        restore: (entry, uid) => void this.restoreEntries([entry], null, uid),
        restoreTo: (entry, uid) => this.pickTargetAndRestore([entry], uid),
        back: () => this.closePreview(),
      }),
    );
    this.preview.clear();

    this.list = new VirtualList<Row>(this.scrollEl, (row, el, index) => this.renderRow(row, el, index));
    this.registerDomEvent(this.scrollEl, "keydown", (event) => this.onListKey(event));

    const refreshIfHiding = () => {
      if (this.filters.hideExisting) this.refilterSoon();
    };
    this.registerEvent(this.app.vault.on("create", refreshIfHiding));
    this.registerEvent(this.app.vault.on("delete", refreshIfHiding));
    this.registerEvent(this.app.vault.on("rename", refreshIfHiding));

    this.renderHeader();
    this.onResize();
    await this.reload();
  }

  override async onClose(): Promise<void> {
    this.list?.destroy();
    this.loadToken++;
  }

  override onResize(): void {
    if (!this.rootEl) return;
    this.rootEl.toggleClass("is-narrow", this.contentEl.clientWidth < NARROW_WIDTH);
    this.list?.refresh();
  }

  /** Loads the deleted-file list from Sync again. */
  async reload(): Promise<void> {
    const token = ++this.loadToken;
    this.loadState = { status: "loading" };
    this.renderMessage();
    try {
      this.sync = getSyncAccess(this.app);
      const records = await this.sync.listDeleted();
      if (token !== this.loadToken) return;
      this.entries = buildEntries(records, {
        configDir: this.app.vault.configDir,
        showConfig: this.plugin.settings.showConfigFiles,
      });
      this.loadState = { status: "ready" };
      const known = new Set(this.entries.map((entry) => entry.path));
      for (const path of this.selected) if (!known.has(path)) this.selected.delete(path);
      this.updateFilterOptions();
      this.refilter(true);
      const active = this.activePath ? this.entries.find((entry) => entry.path === this.activePath) : undefined;
      if (this.activePath && !active) this.closePreview();
    } catch (error) {
      if (token !== this.loadToken) return;
      this.entries = [];
      this.loadState = { status: "error", error };
      this.refilter(true);
    }
  }

  private requireSync(): SyncAccess {
    this.sync ??= getSyncAccess(this.app);
    return this.sync;
  }

  // ---------------------------------------------------------------- toolbar

  private buildToolbar(): void {
    const toolbar = this.rootEl.createDiv({ cls: "trash-explorer-toolbar" });
    const searchWrap = toolbar.createDiv({ cls: "trash-explorer-search search-input-container" });
    this.searchEl = searchWrap.createEl("input", {
      type: "search",
      attr: { placeholder: "Search deleted files by name or path…", spellcheck: "false", "aria-label": "Search" },
    });
    this.registerDomEvent(this.searchEl, "input", () => {
      this.filters.query = this.searchEl.value.trim();
      this.refilter(true);
    });
    this.registerDomEvent(this.searchEl, "keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        this.scrollEl.focus();
        this.moveActive(1);
      }
    });

    this.layoutButton = toolbar.createEl("button", { cls: "clickable-icon" });
    this.registerDomEvent(this.layoutButton, "click", () => {
      this.mode = this.mode === "list" ? "tree" : "list";
      this.updateLayoutButton();
      this.renderHeader();
      this.refilter(true);
    });
    this.updateLayoutButton();

    const refresh = toolbar.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Reload from Sync" } });
    setIcon(refresh, "refresh-cw");
    this.registerDomEvent(refresh, "click", () => void this.reload());
  }

  private updateLayoutButton(): void {
    const tree = this.mode === "tree";
    setIcon(this.layoutButton, tree ? "list" : "folder-tree");
    setTooltip(this.layoutButton, tree ? "Show as list" : "Group by folder");
    this.layoutButton.setAttr("aria-label", tree ? "Show as list" : "Group by folder");
  }

  private buildFilters(): void {
    const bar = this.rootEl.createDiv({ cls: "trash-explorer-filters" });

    this.folderButton = bar.createEl("button", { cls: "trash-explorer-filter-button" });
    this.registerDomEvent(this.folderButton, "click", () => this.pickFolderFilter());
    this.updateFolderButton();

    const kind = bar.createEl("select", { cls: "dropdown", attr: { "aria-label": "File type" } });
    for (const [value, label] of Object.entries(KIND_LABELS)) kind.createEl("option", { value, text: label });
    kind.value = this.filters.kind;
    this.registerDomEvent(kind, "change", () => {
      this.filters.kind = kind.value as FileKind | "all";
      this.refilter(true);
    });

    const date = bar.createEl("select", { cls: "dropdown", attr: { "aria-label": "Deleted date" } });
    for (const [value, label] of Object.entries(DATE_LABELS)) date.createEl("option", { value, text: label });
    date.value = this.filters.date;
    this.registerDomEvent(date, "change", () => {
      this.filters.date = date.value as DatePreset;
      this.customRangeEl.toggleClass("is-hidden", this.filters.date !== "custom");
      this.refilter(true);
    });

    this.customRangeEl = bar.createDiv({ cls: "trash-explorer-custom-range is-hidden" });
    const from = this.customRangeEl.createEl("input", { type: "date", attr: { "aria-label": "Deleted on or after" } });
    this.customRangeEl.createSpan({ text: "to" });
    const to = this.customRangeEl.createEl("input", { type: "date", attr: { "aria-label": "Deleted on or before" } });
    const updateRange = () => {
      this.filters.from = parseDateInput(from.value, false);
      this.filters.to = parseDateInput(to.value, true);
      this.refilter(true);
    };
    this.registerDomEvent(from, "change", updateRange);
    this.registerDomEvent(to, "change", updateRange);

    this.deviceSelect = bar.createEl("select", { cls: "dropdown", attr: { "aria-label": "Device" } });
    this.registerDomEvent(this.deviceSelect, "change", () => {
      this.filters.device = this.deviceSelect.value === "" ? null : this.deviceSelect.value;
      this.refilter(true);
    });

    const hideLabel = bar.createEl("label", { cls: "trash-explorer-check" });
    const hide = hideLabel.createEl("input", { type: "checkbox" });
    hide.checked = this.filters.hideExisting;
    hideLabel.createSpan({ text: "Hide files that exist again" });
    this.registerDomEvent(hide, "change", () => {
      this.filters.hideExisting = hide.checked;
      this.refilter(true);
    });
  }

  private updateFilterOptions(): void {
    const current = this.filters.device;
    this.deviceSelect.empty();
    this.deviceSelect.createEl("option", { value: "", text: "All devices" });
    const devices = collectDevices(this.entries);
    for (const device of devices) this.deviceSelect.createEl("option", { value: device, text: device });
    if (current !== null && !devices.includes(current)) this.filters.device = null;
    this.deviceSelect.value = this.filters.device ?? "";
  }

  private pickFolderFilter(): void {
    const choices: PathChoice[] = [
      { path: null, label: "All folders" },
      { path: "", label: "Vault root only" },
      ...collectFolders(this.entries).map((path) => ({ path, label: path })),
    ];
    new FolderPickerModal(this.app, choices, "Filter by original folder…", (choice) => {
      this.filters.folder = choice.path;
      this.updateFolderButton();
      this.refilter(true);
    }).open();
  }

  private updateFolderButton(): void {
    this.folderButton.empty();
    setIcon(this.folderButton.createSpan({ cls: "trash-explorer-button-icon" }), "folder");
    const folder = this.filters.folder;
    const label = folder === null ? "All folders" : folder === "" ? "Vault root" : folder;
    this.folderButton.createSpan({ cls: "trash-explorer-filter-label", text: label });
    this.folderButton.toggleClass("is-active", folder !== null);
    setTooltip(this.folderButton, "Filter by original folder");
  }

  // ---------------------------------------------------------- list content

  private refilter(resetScroll: boolean): void {
    if (!this.list) return;
    const query = this.filters.query;
    let matcher: Matcher | null = null;
    if (query) {
      const fuzzy = prepareFuzzySearch(query);
      matcher = (text) => {
        const result = fuzzy(text);
        return result ? { score: result.score, matches: result.matches } : null;
      };
    }
    const items = applyFilters(this.entries, this.filters, {
      now: Date.now(),
      exists: (path) => this.app.vault.getAbstractFileByPath(path) !== null,
      matcher,
    });
    const sortKey = query && !this.sortChosen ? "relevance" : this.sortKey;
    this.filtered = sortEntries(items, sortKey, this.sortDirection);
    this.rebuildRows(resetScroll);
  }

  private rebuildRows(resetScroll: boolean): void {
    const expandAll = this.filters.query !== "";
    this.rows = this.mode === "tree" ? buildTreeRows(this.filtered, this.expanded, expandAll) : listRows(this.filtered);
    this.list.setItems(this.rows, resetScroll);
    this.renderMessage();
    this.renderStatus();
  }

  private renderMessage(): void {
    if (!this.messageEl) return;
    this.messageEl.empty();
    const state = this.loadState;
    let show = true;
    if (state.status === "loading") {
      this.messageEl.createDiv({ cls: "trash-explorer-message-title", text: "Loading deleted files from Sync…" });
    } else if (state.status === "error") {
      const error = state.error;
      const title =
        error instanceof SyncUnavailableError && error.reason === "disabled"
          ? "Sync is not turned on"
          : error instanceof SyncUnavailableError && error.reason === "incompatible"
            ? "This Obsidian version is not supported yet"
            : "Cannot load deleted files";
      this.messageEl.createDiv({ cls: "trash-explorer-message-title", text: title });
      this.messageEl.createDiv({ cls: "trash-explorer-muted", text: errorMessage(error) });
      const retry = this.messageEl.createEl("button", { text: "Try again" });
      retry.addEventListener("click", () => void this.reload());
    } else if (this.entries.length === 0) {
      this.messageEl.createDiv({ cls: "trash-explorer-message-title", text: "No deleted files in Sync" });
    } else if (this.filtered.length === 0) {
      this.messageEl.createDiv({ cls: "trash-explorer-message-title", text: "No deleted files match" });
      const reset = this.messageEl.createEl("button", { text: "Clear search and filters" });
      reset.addEventListener("click", () => this.resetFilters());
    } else {
      show = false;
    }
    this.messageEl.toggleClass("is-hidden", !show);
    this.scrollEl.toggleClass("is-hidden", show);
  }

  private resetFilters(): void {
    this.filters = {
      ...this.filters,
      query: "",
      folder: null,
      kind: "all",
      date: "any",
      from: null,
      to: null,
      device: null,
    };
    this.searchEl.value = "";
    for (const select of Array.from(
      this.rootEl.querySelectorAll<HTMLSelectElement>(".trash-explorer-filters select"),
    )) {
      select.selectedIndex = 0;
    }
    this.customRangeEl.addClass("is-hidden");
    this.updateFolderButton();
    this.refilter(true);
  }

  private renderHeader(): void {
    this.headerEl.empty();
    this.rootEl.toggleClass("is-tree", this.mode === "tree");
    const checkCell = this.headerEl.createDiv({ cls: "trash-explorer-cell-check" });
    const all = checkCell.createEl("input", { type: "checkbox", attr: { "aria-label": "Select all shown files" } });
    this.registerDomEvent(all, "change", () => {
      if (all.checked) for (const item of this.filtered) this.selected.add(item.entry.path);
      else for (const item of this.filtered) this.selected.delete(item.entry.path);
      this.list.refresh();
      this.renderStatus();
    });

    for (const column of COLUMNS) {
      const button = this.headerEl.createEl("button", {
        cls: `trash-explorer-sort trash-explorer-cell-${column.key}`,
        text: column.label,
      });
      const active = this.sortKey === column.key && (this.sortChosen || !this.filters.query);
      if (active) {
        button.addClass("is-active");
        setIcon(
          button.createSpan({ cls: "trash-explorer-sort-icon" }),
          this.sortDirection === "asc" ? "arrow-up" : "arrow-down",
        );
      }
      button.addEventListener("click", () => {
        if (this.sortKey === column.key) this.sortDirection = this.sortDirection === "asc" ? "desc" : "asc";
        else {
          this.sortKey = column.key;
          this.sortDirection = column.key === "ts" || column.key === "size" ? "desc" : "asc";
        }
        this.sortChosen = true;
        this.renderHeader();
        this.refilter(false);
      });
    }
  }

  private headerCheckbox(): HTMLInputElement | null {
    return this.headerEl.querySelector<HTMLInputElement>("input[type=checkbox]");
  }

  private renderStatus(): void {
    const shown = this.filtered.length;
    const total = this.entries.length;
    const selectedCount = this.selected.size;
    const parts = [shown === total ? `${total} deleted files` : `${shown} of ${total} deleted files`];
    if (selectedCount) parts.push(`${selectedCount} selected`);
    this.statusTextEl.setText(parts.join(" · "));
    this.restoreSelectedButton.toggleClass("is-hidden", selectedCount === 0);
    this.restoreToButton.toggleClass("is-hidden", selectedCount === 0);
    this.clearSelectionButton.toggleClass("is-hidden", selectedCount === 0);
    this.restoreSelectedButton.setText(selectedCount === 1 ? "Restore 1 file" : `Restore ${selectedCount} files`);
    const header = this.headerCheckbox();
    if (header) {
      const shownSelected = this.filtered.filter((item) => this.selected.has(item.entry.path)).length;
      header.checked = shown > 0 && shownSelected === shown;
      header.indeterminate = shownSelected > 0 && shownSelected < shown;
    }
  }

  private buildStatusBar(parent: HTMLElement): void {
    const bar = parent.createDiv({ cls: "trash-explorer-status" });
    this.statusTextEl = bar.createDiv({ cls: "trash-explorer-status-text" });
    const actions = bar.createDiv({ cls: "trash-explorer-status-actions" });
    this.clearSelectionButton = actions.createEl("button", { text: "Clear selection" });
    this.registerDomEvent(this.clearSelectionButton, "click", () => {
      this.selected.clear();
      this.list.refresh();
      this.renderStatus();
    });
    this.restoreToButton = actions.createEl("button", { text: "Restore to…" });
    this.registerDomEvent(this.restoreToButton, "click", () => this.pickTargetAndRestore(this.selectedEntries(), null));
    this.restoreSelectedButton = actions.createEl("button", { cls: "mod-cta" });
    this.registerDomEvent(
      this.restoreSelectedButton,
      "click",
      () => void this.restoreEntries(this.selectedEntries(), null, null),
    );
  }

  private renderRow(row: Row, el: HTMLElement, index: number): void {
    el.setCssProps({ "--trash-explorer-depth": String(row.depth) });
    if (row.type === "folder") {
      this.renderFolderRow(row, el);
      return;
    }
    const { entry, matches } = row.item;
    el.addClass("is-file");
    el.toggleClass("is-active", entry.path === this.activePath);
    el.toggleClass("is-selected", this.selected.has(entry.path));
    el.setAttr("aria-selected", String(entry.path === this.activePath));

    const checkCell = el.createDiv({ cls: "trash-explorer-cell-check" });
    const checkbox = checkCell.createEl("input", { type: "checkbox", attr: { "aria-label": `Select ${entry.name}` } });
    checkbox.checked = this.selected.has(entry.path);
    checkbox.addEventListener("click", (event) => {
      event.stopPropagation();
      this.toggleSelection(index, event.shiftKey);
    });

    const nameCell = el.createDiv({ cls: "trash-explorer-cell-name" });
    setIcon(nameCell.createSpan({ cls: "trash-explorer-file-icon" }), KIND_ICONS[entry.kind]);
    const nameOffset = entry.folder === "" ? 0 : entry.folder.length + 1;
    renderHighlighted(nameCell.createSpan({ cls: "trash-explorer-name" }), entry.name, matches, nameOffset);

    const folderCell = el.createDiv({ cls: "trash-explorer-cell-folder" });
    renderHighlighted(folderCell, entry.folder === "" ? "/" : entry.folder, entry.folder === "" ? [] : matches, 0);

    const dateCell = el.createDiv({ cls: "trash-explorer-cell-ts", text: fromNow(entry.ts) });
    dateCell.setAttr("title", formatFull(entry.ts));
    el.createDiv({ cls: "trash-explorer-cell-size", text: formatSize(entry.size) });
    el.createDiv({ cls: "trash-explorer-cell-device", text: entry.device });

    el.addEventListener("click", (event) => {
      if (event.shiftKey || event.metaKey || event.ctrlKey) {
        this.toggleSelection(index, event.shiftKey);
        return;
      }
      this.anchorIndex = index;
      this.openEntry(entry);
    });
  }

  private renderFolderRow(row: Extract<Row, { type: "folder" }>, el: HTMLElement): void {
    el.addClass("is-folder");
    const files = this.filesUnder(row.path);
    const selectedCount = files.filter((entry) => this.selected.has(entry.path)).length;

    const checkCell = el.createDiv({ cls: "trash-explorer-cell-check" });
    const checkbox = checkCell.createEl("input", {
      type: "checkbox",
      attr: { "aria-label": `Select all files in ${row.path}` },
    });
    checkbox.checked = selectedCount > 0 && selectedCount === files.length;
    checkbox.indeterminate = selectedCount > 0 && selectedCount < files.length;
    checkbox.addEventListener("click", (event) => {
      event.stopPropagation();
      const select = selectedCount < files.length;
      for (const entry of files) {
        if (select) this.selected.add(entry.path);
        else this.selected.delete(entry.path);
      }
      this.list.refresh();
      this.renderStatus();
    });

    const nameCell = el.createDiv({ cls: "trash-explorer-cell-name" });
    setIcon(nameCell.createSpan({ cls: "trash-explorer-chevron" }), row.expanded ? "chevron-down" : "chevron-right");
    setIcon(nameCell.createSpan({ cls: "trash-explorer-file-icon" }), "folder");
    nameCell.createSpan({ cls: "trash-explorer-name", text: row.name });
    nameCell.createSpan({ cls: "trash-explorer-count", text: String(row.count) });
    el.setAttr("aria-expanded", String(row.expanded));
    el.addEventListener("click", () => this.toggleFolder(row.path, row.expanded));
  }

  private filesUnder(folder: string): TrashEntry[] {
    const prefix = folder + "/";
    return this.filtered.map((item) => item.entry).filter((entry) => entry.path.startsWith(prefix));
  }

  private toggleFolder(path: string, expanded: boolean): void {
    if (this.filters.query) return; // All folders are open while searching.
    if (expanded) this.expanded.delete(path);
    else this.expanded.add(path);
    this.rebuildRows(false);
  }

  private toggleSelection(index: number, range: boolean): void {
    const row = this.rows[index];
    if (row?.type !== "file") return;
    const path = row.item.entry.path;
    const select = !this.selected.has(path);
    if (range && this.anchorIndex !== null) {
      const [start, end] = this.anchorIndex < index ? [this.anchorIndex, index] : [index, this.anchorIndex];
      for (let i = start; i <= end; i++) {
        const target = this.rows[i];
        if (target?.type !== "file") continue;
        if (select) this.selected.add(target.item.entry.path);
        else this.selected.delete(target.item.entry.path);
      }
    } else if (select) this.selected.add(path);
    else this.selected.delete(path);
    this.anchorIndex = index;
    this.list.refresh();
    this.renderStatus();
  }

  private openEntry(entry: TrashEntry): void {
    this.activePath = entry.path;
    this.rootEl.addClass("has-preview");
    this.list.refresh();
    void this.preview.show(entry);
  }

  private closePreview(): void {
    this.activePath = null;
    this.rootEl.removeClass("has-preview");
    this.preview.clear();
    this.list.refresh();
  }

  private onListKey(event: KeyboardEvent): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      this.moveActive(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === " ") {
      const index = this.rows.findIndex((row) => row.type === "file" && row.item.entry.path === this.activePath);
      if (index >= 0) {
        event.preventDefault();
        this.toggleSelection(index, event.shiftKey);
      }
    } else if (event.key === "Escape" && this.activePath) {
      this.closePreview();
    }
  }

  private moveActive(step: number): void {
    const fileIndexes = this.rows.flatMap((row, index) => (row.type === "file" ? [index] : []));
    if (fileIndexes.length === 0) return;
    const current = fileIndexes.findIndex((index) => {
      const row = this.rows[index];
      return row?.type === "file" && row.item.entry.path === this.activePath;
    });
    const next = current === -1 ? 0 : Math.min(fileIndexes.length - 1, Math.max(0, current + step));
    const rowIndex = fileIndexes[next];
    const row = rowIndex === undefined ? undefined : this.rows[rowIndex];
    if (rowIndex === undefined || row?.type !== "file") return;
    this.anchorIndex = rowIndex;
    this.openEntry(row.item.entry);
    this.list.scrollToIndex(rowIndex);
  }

  // -------------------------------------------------------------- restore

  private selectedEntries(): TrashEntry[] {
    return this.entries.filter((entry) => this.selected.has(entry.path));
  }

  private pickTargetAndRestore(entries: TrashEntry[], uid: SyncUid | null): void {
    if (entries.length === 0) return;
    new FolderPickerModal(this.app, vaultFolderChoices(this.app), "Restore to folder…", (choice) => {
      void this.restoreEntries(entries, choice.path ?? "", uid);
    }).open();
  }

  private files(): RestoreFiles {
    const { vault } = this.app;
    return {
      exists: (path) => vault.adapter.exists(normalizePath(path)),
      createFolder: async (path) => {
        await vault.createFolder(normalizePath(path));
      },
      createBinary: async (path, data) => {
        await vault.createBinary(normalizePath(path), data);
      },
    };
  }

  /**
   * Restores files one by one. `uid` is only used for a single file (an older
   * version picked in the preview).
   */
  private async restoreEntries(entries: TrashEntry[], targetFolder: string | null, uid: SyncUid | null): Promise<void> {
    if (entries.length === 0 || this.restoring) return;
    let sync: SyncAccess;
    try {
      sync = this.requireSync();
    } catch (error) {
      new Notice(errorMessage(error));
      return;
    }
    const files = this.files();

    const targets = entries.map((entry) => {
      const folder = targetFolder ?? entry.folder;
      return folder === "" ? entry.name : `${folder}/${entry.name}`;
    });
    const taken = await Promise.all(targets.map((target) => files.exists(target)));
    const conflicts = targets.filter((_, index) => taken[index]);
    let onConflict: ConflictChoice = "skip";
    if (conflicts.length) {
      const choice = await askConflict(this.app, conflicts);
      if (!choice) return;
      onConflict = choice;
    }

    this.restoring = true;
    const progress = new Notice(`Restoring 0 of ${entries.length}…`, 0);
    const results: RestoreResult[] = [];
    try {
      for (const [index, entry] of entries.entries()) {
        results.push(
          // Sequential on purpose: one Sync request at a time, and the progress notice stays correct.
          // oxlint-disable-next-line no-await-in-loop
          await restoreFile(sync, files, {
            path: entry.path,
            uid: entries.length === 1 ? uid : null,
            targetFolder,
            onConflict,
          }),
        );
        progress.setMessage(`Restoring ${index + 1} of ${entries.length}…`);
      }
    } finally {
      progress.hide();
      this.restoring = false;
    }

    const restored = results.filter((result) => result.status === "restored");
    const skipped = results.filter((result) => result.status === "skipped");
    const failed = results.filter((result) => result.status === "failed");
    for (const result of failed)
      console.error(`Trash Explorer for Sync: cannot restore ${result.path}: ${result.reason}`);
    entries.forEach((entry, index) => {
      if (results[index]?.status === "restored") this.selected.delete(entry.path);
    });

    new Notice(summary(restored, skipped, failed), 8000);
    this.refilter(false);
  }
}

function renderHighlighted(el: HTMLElement, text: string, matches: MatchRanges, offset: number): void {
  for (const part of highlightParts(text, matches, offset)) {
    if (part.hit) el.createEl("mark", { cls: "trash-explorer-hit", text: part.text });
    else el.appendText(part.text);
  }
}

function summary(restored: RestoreResult[], skipped: RestoreResult[], failed: RestoreResult[]): string {
  const lines: string[] = [];
  if (restored.length === 1 && skipped.length === 0 && failed.length === 0) {
    const [only] = restored;
    if (only?.status === "restored") {
      return only.method === "server"
        ? `Restored ${only.path}. Sync downloads it in a moment.`
        : `Restored ${only.path}.`;
    }
  }
  if (restored.length) lines.push(`Restored ${restored.length} ${restored.length === 1 ? "file" : "files"}.`);
  if (skipped.length) lines.push(`Skipped ${skipped.length} because a file with the same name exists.`);
  if (failed.length) lines.push(`Could not restore ${failed.length}. The developer console has the details.`);
  return lines.join(" ") || "Nothing was restored.";
}

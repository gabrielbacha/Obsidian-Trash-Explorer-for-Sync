import { type App, Component, MarkdownRenderer, Notice, setIcon } from "obsidian";

import type { Availability } from "./availability";
import { formatSize, TEXT_EXTENSIONS, type TrashEntry } from "./model";
import { loadVersions, NO_CONTENT_REASON } from "./restore";
import type { HistoryItem, SyncAccess, SyncUid } from "./sync-api";
import { formatFull, formatMedium, fromNow } from "./time";

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  avif: "image/avif",
};

const MEDIA_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  flac: "audio/flac",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
};

/** Above this size, text is shown as plain text and not rendered as Markdown. */
const MAX_RENDERED_TEXT = 512 * 1024;
const CACHE_SIZE = 20;

export interface PreviewActions {
  restore(entry: TrashEntry, uid: SyncUid | null): void;
  restoreTo(entry: TrashEntry, uid: SyncUid | null): void;
  back(): void;
  /** Reports what the preview learned about the file's content. */
  known(path: string, availability: Availability): void;
}

/**
 * The right-hand pane: metadata, the version list and the content of one
 * version. Each `show` call cancels the previous one, so fast clicks never
 * show stale content.
 */
export class PreviewPane extends Component {
  private readonly app: App;
  private readonly containerEl: HTMLElement;
  private readonly getSync: () => SyncAccess;
  private readonly actions: PreviewActions;
  private readonly cache = new Map<string, ArrayBuffer>();
  private contentComponent: Component | null = null;
  private objectUrl: string | null = null;
  private token = 0;
  private entry: TrashEntry | null = null;
  private versions: HistoryItem[] = [];
  private selectedUid: SyncUid | null = null;
  private text: string | null = null;

  constructor(app: App, containerEl: HTMLElement, getSync: () => SyncAccess, actions: PreviewActions) {
    super();
    this.app = app;
    this.containerEl = containerEl;
    this.getSync = getSync;
    this.actions = actions;
  }

  override onunload(): void {
    this.clearContent();
  }

  get current(): TrashEntry | null {
    return this.entry;
  }

  clear(): void {
    this.token++;
    this.entry = null;
    this.clearContent();
    this.containerEl.empty();
    const empty = this.containerEl.createDiv({ cls: "trash-explorer-preview-empty" });
    setIcon(empty.createDiv({ cls: "trash-explorer-preview-empty-icon" }), "file-search");
    empty.createDiv({ text: "Select a deleted file to preview it." });
  }

  async show(entry: TrashEntry): Promise<void> {
    const token = ++this.token;
    this.entry = entry;
    this.versions = [];
    this.selectedUid = null;
    this.text = null;
    this.clearContent();
    this.containerEl.empty();

    const header = this.containerEl.createDiv({ cls: "trash-explorer-preview-header" });
    const backButton = header.createEl("button", {
      cls: "clickable-icon trash-explorer-back",
      attr: { "aria-label": "Back to the list" },
    });
    setIcon(backButton, "arrow-left");
    backButton.addEventListener("click", () => this.actions.back());

    const titleBlock = header.createDiv({ cls: "trash-explorer-preview-title-block" });
    titleBlock.createDiv({ cls: "trash-explorer-preview-title", text: entry.name });
    titleBlock.createDiv({ cls: "trash-explorer-preview-path", text: entry.folder === "" ? "/" : entry.folder });

    const meta = this.containerEl.createDiv({ cls: "trash-explorer-preview-meta" });
    meta.createSpan({ text: `Deleted ${fromNow(entry.ts)}`, attr: { title: formatFull(entry.ts) } });
    if (entry.device) meta.createSpan({ text: `on ${entry.device}` });

    const actionsEl = this.containerEl.createDiv({ cls: "trash-explorer-preview-actions" });
    this.addAction(actionsEl, "rotate-ccw", "Restore", true, () =>
      this.actions.restore(entry, this.selectedVersionUid()),
    );
    this.addAction(actionsEl, "folder-input", "Restore to…", false, () =>
      this.actions.restoreTo(entry, this.selectedVersionUid()),
    );
    this.addAction(actionsEl, "copy", "Copy text", false, () => void this.copyText());
    this.addAction(actionsEl, "history", "Sync history", false, () => this.openNativeHistory(entry.path)).addClass(
      "trash-explorer-keep",
    );

    const body = this.containerEl.createDiv({ cls: "trash-explorer-preview-body" });
    const versionsEl = body.createDiv({ cls: "trash-explorer-versions" });
    const contentEl = body.createDiv({ cls: "trash-explorer-content" });
    versionsEl.createDiv({ cls: "trash-explorer-muted", text: "Loading versions…" });

    try {
      const history = await loadVersions(this.getSync(), entry.path, { maxPages: 3 });
      if (token !== this.token) return;
      this.versions = history.versions;
      const first = this.versions[0];
      this.actions.known(entry.path, first ? { status: "content", size: first.size } : { status: "none" });
      if (!first) {
        versionsEl.empty();
        for (const button of Array.from(actionsEl.querySelectorAll("button"))) {
          if (!button.hasClass("trash-explorer-keep")) button.disabled = true;
        }
        contentEl.empty();
        const notice = contentEl.createDiv({ cls: "trash-explorer-no-content" });
        notice.createDiv({ cls: "trash-explorer-message-title", text: "Cannot restore this file" });
        notice.createDiv({ text: NO_CONTENT_REASON });
        return;
      }
      this.renderVersions(versionsEl, contentEl, history.more, token);
      await this.showVersion(first, contentEl, token);
    } catch (error) {
      if (token !== this.token) return;
      versionsEl.empty();
      contentEl.setText(`Cannot load the history: ${errorMessage(error)}`);
    }
  }

  /** null means "the newest version", which lets restore use the server restore. */
  private selectedVersionUid(): SyncUid | null {
    const first = this.versions[0];
    if (this.selectedUid === null || (first && first.uid === this.selectedUid)) return null;
    return this.selectedUid;
  }

  private addAction(parent: HTMLElement, icon: string, label: string, cta: boolean, onClick: () => void) {
    const button = parent.createEl("button", { cls: cta ? "mod-cta" : "" });
    setIcon(button.createSpan({ cls: "trash-explorer-button-icon" }), icon);
    button.createSpan({ text: label });
    button.addEventListener("click", onClick);
    return button;
  }

  private openNativeHistory(path: string) {
    try {
      this.getSync().showVersionHistory(path);
    } catch (error) {
      new Notice(errorMessage(error));
    }
  }

  private renderVersions(versionsEl: HTMLElement, contentEl: HTMLElement, more: boolean, token: number) {
    versionsEl.empty();
    versionsEl.createDiv({ cls: "trash-explorer-versions-title", text: "Versions" });
    const list = versionsEl.createDiv({ cls: "trash-explorer-version-list" });
    for (const version of this.versions) {
      const item = list.createEl("button", {
        cls: "trash-explorer-version",
        attr: { "data-uid": String(version.uid) },
      });
      item.createDiv({ text: formatMedium(version.ts) });
      const details = [formatSize(version.size), version.device].filter(Boolean).join(" · ");
      item.createDiv({ cls: "trash-explorer-muted", text: details });
      item.addEventListener("click", () => void this.showVersion(version, contentEl, token));
    }
    if (more) {
      versionsEl.createDiv({ cls: "trash-explorer-muted", text: "Older versions are in Sync history." });
    }
  }

  private async showVersion(version: HistoryItem, contentEl: HTMLElement, token: number): Promise<void> {
    if (token !== this.token || !this.entry) return;
    const entry = this.entry;
    this.selectedUid = version.uid;
    this.text = null;
    for (const el of Array.from(this.containerEl.querySelectorAll<HTMLElement>(".trash-explorer-version"))) {
      el.toggleClass("is-active", el.dataset.uid === String(version.uid));
    }
    this.clearContent();
    contentEl.empty();
    contentEl.createDiv({ cls: "trash-explorer-muted", text: "Loading content…" });

    let data: ArrayBuffer;
    try {
      data = await this.loadVersion(version.uid);
    } catch (error) {
      if (token === this.token && this.selectedUid === version.uid) {
        contentEl.setText(`Cannot load this version: ${errorMessage(error)}`);
      }
      return;
    }
    if (token !== this.token || this.selectedUid !== version.uid) return;
    contentEl.empty();
    await this.renderContent(entry, data, contentEl);
  }

  private async loadVersion(uid: SyncUid): Promise<ArrayBuffer> {
    const key = String(uid);
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    const data = await this.getSync().getContent(uid);
    this.cache.set(key, data);
    if (this.cache.size > CACHE_SIZE) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    return data;
  }

  private async renderContent(entry: TrashEntry, data: ArrayBuffer, contentEl: HTMLElement): Promise<void> {
    const ext = entry.extension;
    const imageType = IMAGE_TYPES[ext];
    if (imageType) {
      contentEl.createEl("img", {
        cls: "trash-explorer-image",
        attr: { src: this.blobUrl(data, imageType), alt: entry.name },
      });
      return;
    }
    const mediaType = MEDIA_TYPES[ext];
    if (mediaType) {
      const url = this.blobUrl(data, mediaType);
      if (ext === "pdf")
        contentEl.createEl("iframe", { cls: "trash-explorer-pdf", attr: { src: url, title: entry.name } });
      else if (entry.kind === "audio") contentEl.createEl("audio", { attr: { src: url, controls: "" } });
      else contentEl.createEl("video", { cls: "trash-explorer-video", attr: { src: url, controls: "" } });
      return;
    }
    if (TEXT_EXTENSIONS.has(ext) || ext === "") {
      const text = new TextDecoder().decode(data);
      this.text = text;
      if (ext === "md" && text.length <= MAX_RENDERED_TEXT) {
        const component = new Component();
        this.contentComponent = component;
        this.addChild(component);
        const rendered = contentEl.createDiv({ cls: "markdown-rendered trash-explorer-markdown" });
        await MarkdownRenderer.render(this.app, text, rendered, entry.path, component);
      } else {
        contentEl.createEl("pre", { cls: "trash-explorer-text", text });
      }
      return;
    }
    contentEl.createDiv({
      cls: "trash-explorer-muted",
      text: `No preview for .${ext} files (${formatSize(data.byteLength)}). You can still restore it.`,
    });
  }

  private blobUrl(data: ArrayBuffer, type: string): string {
    this.revokeUrl();
    this.objectUrl = URL.createObjectURL(new Blob([data], { type }));
    return this.objectUrl;
  }

  private revokeUrl() {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }

  private clearContent() {
    this.revokeUrl();
    if (this.contentComponent) {
      this.removeChild(this.contentComponent);
      this.contentComponent = null;
    }
  }

  private async copyText(): Promise<void> {
    if (this.text === null) {
      new Notice("Only text files can be copied.");
      return;
    }
    await navigator.clipboard.writeText(this.text);
    new Notice("Copied the text of this version.");
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

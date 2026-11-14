/**
 * Renders only the visible rows of a long list. Rows have one fixed height
 * that comes from the CSS variable --trash-explorer-row-height.
 */
export class VirtualList<T> {
  private readonly scrollEl: HTMLElement;
  private readonly spacerEl: HTMLElement;
  private readonly renderRow: (item: T, el: HTMLElement, index: number) => void;
  private items: T[] = [];
  private rowHeight = 32;
  private frame = 0;
  private readonly onScroll = () => this.schedule();

  constructor(scrollEl: HTMLElement, renderRow: (item: T, el: HTMLElement, index: number) => void) {
    this.scrollEl = scrollEl;
    this.renderRow = renderRow;
    this.spacerEl = scrollEl.createDiv({ cls: "trash-explorer-spacer" });
    scrollEl.addEventListener("scroll", this.onScroll, { passive: true });
  }

  setItems(items: T[], resetScroll: boolean): void {
    this.items = items;
    if (resetScroll) this.scrollEl.scrollTop = 0;
    this.measure();
    this.render();
  }

  /** Renders again, for example after the selection or the container size changed. */
  refresh(): void {
    this.measure();
    this.render();
  }

  scrollToIndex(index: number): void {
    const top = index * this.rowHeight;
    const bottom = top + this.rowHeight;
    if (top < this.scrollEl.scrollTop) this.scrollEl.scrollTop = top;
    else if (bottom > this.scrollEl.scrollTop + this.scrollEl.clientHeight) {
      this.scrollEl.scrollTop = bottom - this.scrollEl.clientHeight;
    }
    this.render();
  }

  destroy(): void {
    this.scrollEl.removeEventListener("scroll", this.onScroll);
    if (this.frame) this.scrollEl.win.cancelAnimationFrame(this.frame);
  }

  private measure(): void {
    const value = Number.parseFloat(
      this.scrollEl.win.getComputedStyle(this.scrollEl).getPropertyValue("--trash-explorer-row-height"),
    );
    if (Number.isFinite(value) && value > 0) this.rowHeight = value;
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = this.scrollEl.win.requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private render(): void {
    const { items, rowHeight } = this;
    this.spacerEl.setCssProps({ "--trash-explorer-list-height": `${items.length * rowHeight}px` });
    const overscan = 8;
    const first = Math.max(0, Math.floor(this.scrollEl.scrollTop / rowHeight) - overscan);
    const visible = Math.ceil(this.scrollEl.clientHeight / rowHeight) + overscan * 2;
    const last = Math.min(items.length, first + visible);

    this.spacerEl.empty();
    for (let index = first; index < last; index++) {
      const item = items[index];
      if (item === undefined) continue;
      const rowEl = this.spacerEl.createDiv({ cls: "trash-explorer-row" });
      rowEl.setCssProps({ "--trash-explorer-row-top": `${index * rowHeight}px` });
      this.renderRow(item, rowEl, index);
    }
  }
}

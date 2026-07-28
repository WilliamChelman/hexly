import { signal } from '@angular/core';
import { ListboxAnchor } from './listbox-placement';

/** What each open/update cycle hands the listbox: current items, a pick callback, and where to anchor. */
export interface ListboxProps<T> {
  items: T[];
  command: (item: T) => void;
  clientRect?: (() => DOMRect | null) | null;
  /**
   * True on an interim open/update with empty `items` while an async search is in
   * flight — the controller keeps the previous results rather than blanking the list.
   */
  loading?: boolean;
}

/**
 * Keyboard-driven listbox behaviour (ARIA active-descendant): open/update/close plus
 * ArrowUp/Down/Enter/Tab/Escape over a signal-backed item list, calling back `command` on
 * pick. Driver-agnostic — a `@tiptap/suggestion` plugin or a plain text input feeds it the
 * same {@link ListboxProps}. Subclasses supply row rendering and the option-id prefix.
 */
export abstract class ListboxController<T extends { id: string }> {
  protected readonly visible = signal(false);
  protected readonly items = signal<T[]>([]);
  protected readonly activeIndex = signal(0);
  /** The caret/field rect the box hangs off; {@link ListboxComponent} turns it into a position. */
  protected readonly anchor = signal<ListboxAnchor | null>(null);
  private command: ((item: T) => void) | null = null;

  /** Prefix for each option's stable DOM id (the aria-activedescendant target). */
  protected abstract readonly optionIdPrefix: string;

  open(props: ListboxProps<T>): void {
    this.command = props.command;
    this.items.set(props.items);
    this.activeIndex.set(0);
    // ponytail: fallback to the viewport origin when DOMRect is null (programmatic insertion
    // before layout flush); the first update() call corrects it once TipTap has a real rect.
    this.anchor.set(toAnchor(props.clientRect) ?? { left: 0, top: 0, bottom: 0 });
    this.visible.set(true);
  }

  update(props: ListboxProps<T>): void {
    this.command = props.command;
    // While an async search is in flight tiptap sends an interim update with
    // empty items (loading); keep the previous results until the resolved ones
    // arrive so refining the query doesn't blank the list (stale-while-revalidate).
    if (!props.loading) {
      this.items.set(props.items);
      this.activeIndex.set(0);
    }
    const anchor = toAnchor(props.clientRect);
    if (anchor) this.anchor.set(anchor);
  }

  close(): void {
    this.visible.set(false);
  }

  /** Route navigation keys while open; return true when consumed so the editor ignores them. */
  onKeyDown(event: KeyboardEvent): boolean {
    if (!this.visible()) return false;
    const count = this.items().length;
    switch (event.key) {
      case 'ArrowDown':
        if (count) this.activeIndex.update((i) => (i + 1) % count);
        return count > 0;
      case 'ArrowUp':
        if (count) this.activeIndex.update((i) => (i - 1 + count) % count);
        return count > 0;
      case 'Enter':
      case 'Tab': {
        const item = this.items()[this.activeIndex()];
        if (item) this.select(item);
        return !!item;
      }
      case 'Escape':
        this.close();
        return true;
      default:
        return false;
    }
  }

  protected optionId(id: string): string {
    return this.optionIdPrefix + id;
  }

  protected activeItemId(): string | null {
    const item = this.items()[this.activeIndex()];
    return item ? this.optionId(item.id) : null;
  }

  protected select(item: T): void {
    this.command?.(item);
    this.close();
  }
}

function toAnchor(clientRect?: (() => DOMRect | null) | null): ListboxAnchor | null {
  const rect = clientRect?.();
  return rect ? { left: rect.left, top: rect.top, bottom: rect.bottom } : null;
}

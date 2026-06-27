import { signal } from '@angular/core';

/** What a `@tiptap/suggestion` render cycle hands the menu on open/update. */
export interface SuggestionMenuProps<T> {
  items: T[];
  command: (item: T) => void;
  clientRect?: (() => DOMRect | null) | null;
}

/**
 * Shared keyboard-driven popup behind the `/` slash menu and the `@` entity picker
 * (ADR-0019, ADR-0023). The `@tiptap/suggestion` plugin drives both identically —
 * open/update/close/onKeyDown — and a pick just calls back the plugin's `command`;
 * the menu never touches the editor. Subclasses differ only in how each item
 * renders and the DOM-id prefix for its options, so all the state and key handling
 * live here and the two components are thin templates over it.
 */
export abstract class SuggestionMenu<T extends { id: string }> {
  protected readonly visible = signal(false);
  protected readonly items = signal<T[]>([]);
  protected readonly activeIndex = signal(0);
  protected readonly position = signal<{ x: number; y: number } | null>(null);
  private command: ((item: T) => void) | null = null;

  /** Prefix for each option's stable DOM id (the aria-activedescendant target). */
  protected abstract readonly optionIdPrefix: string;

  open(props: SuggestionMenuProps<T>): void {
    this.command = props.command;
    this.items.set(props.items);
    this.activeIndex.set(0);
    // ponytail: fallback {x:0,y:0} when DOMRect is null (programmatic insertion before
    // layout flush); the first update() call corrects it once TipTap has a real rect.
    this.position.set(toPosition(props.clientRect) ?? { x: 0, y: 0 });
    this.visible.set(true);
  }

  update(props: SuggestionMenuProps<T>): void {
    this.command = props.command;
    this.items.set(props.items);
    this.activeIndex.set(0);
    const pos = toPosition(props.clientRect);
    if (pos) this.position.set(pos);
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

function toPosition(
  clientRect?: (() => DOMRect | null) | null,
): { x: number; y: number } | null {
  const rect = clientRect?.();
  return rect ? { x: rect.left, y: rect.bottom } : null;
}

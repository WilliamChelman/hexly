import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SlashItem } from './slash-menu-items';

/** What the slash suggestion plugin hands the menu on open/update. */
export interface SlashMenuProps {
  items: SlashItem[];
  command: (item: SlashItem) => void;
  clientRect?: (() => DOMRect | null) | null;
}

/**
 * The keyboard-driven block picker that opens on `/` in the Content editor (#73).
 * Headless TipTap owns no chrome, so this is ours (ADR-0019): the suggestion plugin
 * drives it through {@link open}/{@link update}/{@link close}/{@link onKeyDown}; the menu
 * never touches the editor itself — selecting an item just calls back the plugin's `command`.
 */
@Component({
  selector: 'app-slash-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
  template: `
    @if (visible()) {
      <ul
        role="listbox"
        data-testid="slash-menu"
        [attr.aria-label]="'noteView.slashMenu.label' | transloco"
        [attr.aria-activedescendant]="activeItemId()"
        class="fixed z-50 max-h-72 w-56 overflow-auto rounded-md border border-line bg-surface py-1 shadow-2"
        [style.left.px]="position()!.x"
        [style.top.px]="position()!.y"
      >
        @for (item of items(); track item.id; let i = $index) {
          <li role="presentation">
            <button
              type="button"
              role="option"
              [id]="'slash-opt-' + item.id"
              [attr.data-testid]="'slash-item-' + item.id"
              [attr.aria-selected]="i === activeIndex()"
              class="block w-full cursor-pointer px-3 py-1 text-left text-sm text-ink"
              [class.bg-surface-sunken]="i === activeIndex()"
              (mousedown)="$event.preventDefault()"
              (click)="select(item)"
            >
              {{ item.labelKey | transloco }}
            </button>
          </li>
        } @empty {
          <li class="px-3 py-1 text-sm text-ink-muted">
            {{ 'noteView.slashMenu.empty' | transloco }}
          </li>
        }
      </ul>
    }
  `,
})
export class SlashMenu {
  protected readonly visible = signal(false);
  protected readonly items = signal<SlashItem[]>([]);
  protected readonly activeIndex = signal(0);
  protected readonly position = signal<{ x: number; y: number } | null>(null);
  private command: ((item: SlashItem) => void) | null = null;

  open(props: SlashMenuProps): void {
    const pos = toPosition(props.clientRect);
    if (!pos) return;
    this.command = props.command;
    this.items.set(props.items);
    this.activeIndex.set(0);
    this.position.set(pos);
    this.visible.set(true);
  }

  update(props: SlashMenuProps): void {
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

  protected activeItemId(): string | null {
    const item = this.items()[this.activeIndex()];
    return item ? 'slash-opt-' + item.id : null;
  }

  protected select(item: SlashItem): void {
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

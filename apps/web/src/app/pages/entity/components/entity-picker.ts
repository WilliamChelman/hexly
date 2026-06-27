import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { EntitySummary } from '@hexly/domain';

/** What the `@`/`/link` suggestion plugin hands the picker on open/update. */
export interface EntityPickerProps {
  items: EntitySummary[];
  command: (entity: EntitySummary) => void;
  clientRect?: (() => DOMRect | null) | null;
}

/**
 * The keyboard-driven Entity picker that opens on `@` (and via the `/link` slash
 * item) in the Content editor (issue #95, ADR-0023). Modeled on {@link SlashMenu}:
 * the `@tiptap/suggestion` plugin drives it through {@link open}/{@link update}/
 * {@link close}/{@link onKeyDown}; selecting an item just calls back the plugin's
 * `command`, which inserts the `entityLink` atom. Filtering by name happens in the
 * plugin's `items`, so the menu only renders what it is handed.
 */
@Component({
  selector: 'app-entity-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
  template: `
    @if (visible()) {
      <ul
        role="listbox"
        data-testid="entity-picker"
        [attr.aria-label]="'noteView.entityPicker.label' | transloco"
        [attr.aria-activedescendant]="activeItemId()"
        class="fixed z-50 max-h-72 w-64 overflow-auto rounded-md border border-line bg-surface py-1 shadow-2"
        [style.left.px]="position()!.x"
        [style.top.px]="position()!.y"
      >
        @for (item of items(); track item.id; let i = $index) {
          <li role="presentation">
            <button
              type="button"
              role="option"
              [id]="'entity-opt-' + item.id"
              [attr.data-testid]="'entity-picker-option-' + item.id"
              [attr.aria-selected]="i === activeIndex()"
              class="block w-full cursor-pointer px-3 py-1 text-left text-sm text-ink"
              [class.bg-surface-sunken]="i === activeIndex()"
              (mousedown)="$event.preventDefault()"
              (click)="select(item)"
            >
              {{ item.name }}
              <span class="font-mono text-2xs text-ink-muted">({{ item.type }})</span>
            </button>
          </li>
        } @empty {
          <li class="px-3 py-1 text-sm text-ink-muted">
            {{ 'noteView.entityPicker.empty' | transloco }}
          </li>
        }
      </ul>
    }
  `,
})
export class EntityPicker {
  protected readonly visible = signal(false);
  protected readonly items = signal<EntitySummary[]>([]);
  protected readonly activeIndex = signal(0);
  protected readonly position = signal<{ x: number; y: number } | null>(null);
  private command: ((entity: EntitySummary) => void) | null = null;

  open(props: EntityPickerProps): void {
    const pos = toPosition(props.clientRect);
    if (!pos) return;
    this.command = props.command;
    this.items.set(props.items);
    this.activeIndex.set(0);
    this.position.set(pos);
    this.visible.set(true);
  }

  update(props: EntityPickerProps): void {
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
    return item ? 'entity-opt-' + item.id : null;
  }

  protected select(item: EntitySummary): void {
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

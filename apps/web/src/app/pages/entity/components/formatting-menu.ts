import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Editor } from '@tiptap/core';
import { Button } from '../../../ui/button';
import {
  FORMAT_ITEMS,
  FormatItem,
  applyLink,
  clearLink,
  isLinkActive,
} from './formatting-items';

/**
 * The formatting toolbar that floats over a text selection in the Content editor (#74).
 * Headless TipTap owns no chrome (ADR-0019), so this is ours: a `@tiptap/extension-bubble-menu`
 * plugin (wired in {@link NoteView}) positions this component's host element over the selection
 * and toggles its visibility. The toolbar itself just reads/drives the editor through
 * {@link FORMAT_ITEMS} — every action round-trips through the opaque snapshot for free.
 */
@Component({
  selector: 'app-formatting-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, Button],
  host: { class: 'fixed invisible' },
  template: `
    <div
      role="toolbar"
      [attr.aria-label]="'noteView.formatMenu.label' | transloco"
      class="flex items-center gap-[2px] rounded-md border border-line bg-surface p-1 shadow-2"
    >
      @for (item of items; track item.id) {
        <button
          appButton
          variant="ghost"
          size="sm"
          icon
          type="button"
          [attr.aria-label]="item.labelKey | transloco"
          [attr.title]="item.labelKey | transloco"
          [active]="activeIds().has(item.id)"
          [attr.aria-pressed]="activeIds().has(item.id)"
          (mousedown)="$event.preventDefault()"
          (click)="apply(item)"
        >
          {{ item.glyph }}
        </button>
      }

      <button
        appButton
        variant="ghost"
        size="sm"
        type="button"
        [attr.aria-label]="'noteView.formatMenu.link' | transloco"
        [attr.title]="'noteView.formatMenu.link' | transloco"
        [active]="linkActive()"
        [attr.aria-pressed]="linkActive()"
        (mousedown)="$event.preventDefault()"
        (click)="toggleLink()"
      >
        {{ 'noteView.formatMenu.link' | transloco }}
      </button>

      @if (linkEditing()) {
        <input
          #urlInput
          type="url"
          [attr.aria-label]="'noteView.formatMenu.linkPlaceholder' | transloco"
          [attr.placeholder]="'noteView.formatMenu.linkPlaceholder' | transloco"
          class="ml-1 w-44 rounded-sm border border-line bg-surface-sunken px-2 py-1 text-sm text-ink"
          (keydown.enter)="submitLink($event)"
          (keydown.escape)="cancelLink()"
        />
      }
    </div>
  `,
})
export class FormattingMenu {
  readonly editor = input.required<Editor>();

  protected readonly items = FORMAT_ITEMS;
  protected readonly linkEditing = signal(false);
  private readonly urlInput = viewChild<ElementRef<HTMLInputElement>>('urlInput');

  // The editor mutates outside Angular; `tick` bumps on every transaction so the
  // active-state computed re-reads the selection and the toolbar highlights track it.
  private readonly tick = signal(0);

  // Single reactive read for both derived values; one subscriber per signal.
  private readonly _menuState = computed(() => {
    this.tick();
    const editor = this.editor();
    return {
      ids: new Set(FORMAT_ITEMS.filter((i) => i.isActive(editor)).map((i) => i.id)),
      link: isLinkActive(editor),
    };
  });

  protected readonly activeIds = computed(() => this._menuState().ids);
  protected readonly linkActive = computed(() => this._menuState().link);

  constructor() {
    effect((onCleanup) => {
      const editor = this.editor();
      // Editor swap (conflict-reload) must reset the URL input — stale linkEditing
      // state would make the input reappear on the next selection without user action.
      this.linkEditing.set(false);
      const bump = () => this.tick.update((t) => t + 1);
      editor.on('transaction', bump);
      onCleanup(() => editor.off('transaction', bump));
    });

    // Focus the URL input when it is rendered; buttons use preventDefault on mousedown
    // so focus stays in ProseMirror and won't reach the input naturally.
    effect(() => {
      if (!this.linkEditing()) return;
      this.urlInput()?.nativeElement.focus();
    });
  }

  /** Run an action, then collapse the selection so the bubble menu dismisses. */
  protected apply(item: FormatItem): void {
    if (item.run(this.editor())) this.dismiss();
  }

  /** Active link → drop it (and dismiss); otherwise reveal the URL input. */
  protected toggleLink(): void {
    const editor = this.editor();
    if (isLinkActive(editor)) {
      clearLink(editor);
      this.dismiss();
      return;
    }
    this.linkEditing.set(true);
  }

  protected submitLink(event: Event): void {
    const input = event.target as HTMLInputElement;
    const url = input.value.trim();
    if (!url || !applyLink(this.editor(), url)) return;
    this.dismiss();
  }

  // Collapsing the selection makes the plugin's shouldShow false (empty selection),
  // closing the menu while leaving the cursor where the user was working.
  // Use head (the active end) so right-to-left selections land at the correct side.
  private dismiss(): void {
    this.linkEditing.set(false);
    const editor = this.editor();
    editor.commands.setTextSelection(editor.state.selection.head);
  }

  protected cancelLink(): void {
    this.linkEditing.set(false);
    this.editor().commands.focus();
  }
}

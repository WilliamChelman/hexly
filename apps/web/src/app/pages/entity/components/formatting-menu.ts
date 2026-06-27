import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  signal,
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
  template: `
    <div
      role="toolbar"
      [attr.aria-label]="'noteView.formatMenu.label' | transloco"
      class="flex items-center gap-[2px] rounded-md border border-line bg-surface p-1 shadow-lg"
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

  // The editor mutates outside Angular; `tick` bumps on every transaction so the
  // active-state computeds re-read the selection and the toolbar highlights track it.
  private readonly tick = signal(0);

  protected readonly activeIds = computed(() => {
    this.tick();
    const editor = this.editor();
    return new Set(FORMAT_ITEMS.filter((i) => i.isActive(editor)).map((i) => i.id));
  });

  protected readonly linkActive = computed(() => {
    this.tick();
    return isLinkActive(this.editor());
  });

  constructor() {
    effect((onCleanup) => {
      const editor = this.editor();
      const bump = () => this.tick.update((t) => t + 1);
      editor.on('transaction', bump);
      onCleanup(() => editor.off('transaction', bump));
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
  private dismiss(): void {
    this.linkEditing.set(false);
    const editor = this.editor();
    editor.commands.setTextSelection(editor.state.selection.to);
  }

  protected cancelLink(): void {
    this.linkEditing.set(false);
    this.editor().commands.focus();
  }
}

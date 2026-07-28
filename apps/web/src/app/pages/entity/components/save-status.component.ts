import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ChipComponent, IconComponent, IconName } from '@hexly/web-ui';
import { EntitySession } from '../services/entity-session';

/** The routine autosave states, in the order the ladder falls through them. */
type QuietState = 'saving' | 'unsaved' | 'saved';

/** Each routine state's glyph and its copy — the tooltip, and the text assistive tech hears. */
const QUIET: Record<QuietState, { icon: IconName; key: string }> = {
  saving: { icon: 'spinner', key: 'editorShell.saving' },
  unsaved: { icon: 'pencil', key: 'editorShell.save.unsaved' },
  saved: { icon: 'check', key: 'editorShell.save.saved' },
};

/**
 * Autosave feedback chip (ADR-0026). One aria-live region over the session's persistence state.
 * States, highest priority first: conflict → save error (Retry) → saving → dirty → saved.
 *
 * The three routine states render as a fixed-size icon badge, not words: they cycle on every edit,
 * and a chip resizing between "Saved" / "Unsaved…" / "Saving…" would shove the header around while
 * you type; the words are kept for the tooltip and assistive tech. The exceptional states —
 * conflict, save failure, read-only — stay spelled out, since they must be read and acted on.
 */
@Component({
  selector: 'app-save-status',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChipComponent, IconComponent, TranslocoPipe],
  template: `
    <span aria-live="polite" class="inline-flex items-center">
      @if (conflict()) {
        <!-- The exceptional states are spelled out in words, and the accent tone is emphasis rather than
             one of the categorical tones, so there is no category for a glyph to carry (ADR-0075). -->
        <app-chip tone="accent" [icon]="null" data-testid="conflict">
          {{ 'editorShell.save.conflict' | transloco }}
          <button
            type="button"
            class="ml-2 p-0 underline bg-transparent border-0 cursor-pointer text-current"
            data-testid="conflict-reload"
            (click)="reload()"
          >
            {{ 'editorShell.reload' | transloco }}
          </button>
          @if (error() === 'reload') {
            <span data-testid="reload-error" class="ml-2">{{ 'editorShell.save.reloadFailed' | transloco }}</span>
          }
        </app-chip>
      } @else if (error() === 'readonly') {
        <app-chip [icon]="null" data-testid="readonly">{{ 'editorShell.save.readonly' | transloco }}</app-chip>
      } @else if (error() === 'save') {
        <app-chip tone="accent" [icon]="null" data-testid="save-error">
          {{ 'editorShell.save.failed' | transloco }}
          <button
            type="button"
            class="ml-2 p-0 underline bg-transparent border-0 cursor-pointer text-current"
            data-testid="save-retry"
            (click)="retry()"
          >
            {{ 'editorShell.save.retry' | transloco }}
          </button>
        </app-chip>
      } @else {
        <span
          class="inline-flex items-center justify-center w-6 h-6 rounded-full border border-line-strong bg-surface-sunken"
          [class.text-ink-faint]="quiet() === 'saved'"
          [class.text-accent]="quiet() !== 'saved'"
          [attr.data-state]="quiet()"
          [title]="QUIET[quiet()].key | transloco"
          data-testid="save-status"
        >
          <app-icon
            [name]="QUIET[quiet()].icon"
            [size]="14"
            [class.animate-spin]="quiet() === 'saving'"
            class="motion-reduce:animate-none"
          />
          <!-- The state still reaches the aria-live region as words, just not as pixels. -->
          <span class="sr-only">{{ QUIET[quiet()].key | transloco }}</span>
        </span>
      }
    </span>
  `,
})
export class SaveStatusComponent {
  private readonly session = inject(EntitySession);
  protected readonly saving = this.session.saving;
  protected readonly dirty = this.session.dirty;
  protected readonly conflict = this.session.conflict;
  protected readonly error = this.session.error;

  protected readonly QUIET = QUIET;

  /** Which routine state the badge is showing, once the exceptional branches have passed. */
  protected readonly quiet = computed<QuietState>(() =>
    this.saving() ? 'saving' : this.dirty() ? 'unsaved' : 'saved',
  );

  protected reload(): void {
    this.session.reload().subscribe();
  }

  /** Manual recovery after a network failure paused the scheduler. */
  protected retry(): void {
    this.session.save(true).subscribe();
  }
}

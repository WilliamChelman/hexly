import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Chip } from '../../../ui/chip';
import { EntitySession } from '../services/entity-session';

/**
 * Autosave feedback chip (ADR-0026) — the surface that replaced the Save button on
 * every Entity. One `aria-live="polite"` region over the session's persistence state,
 * so a screen-reader user (who no longer has a button to confirm intent) hears
 * "Saving…/Saved/Save failed". States, highest priority first:
 *   conflict → save error (Retry) → saving → dirty → saved.
 */
@Component({
  selector: 'app-save-status',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Chip, TranslocoPipe],
  template: `
    <span aria-live="polite" class="inline-flex items-center">
      @if (conflict()) {
        <app-chip tone="gold" data-testid="conflict">
          {{ 'editorShell.save.conflict' | transloco }}
          <button
            type="button"
            class="ml-2 p-0 underline bg-transparent border-0 cursor-pointer text-current"
            data-testid="conflict-reload"
            (click)="reload()"
          >
            {{ 'editorShell.reload' | transloco }}
          </button>
        </app-chip>
      } @else if (error() === 'save') {
        <app-chip tone="gold" data-testid="save-error">
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
      } @else if (saving()) {
        <app-chip tone="gold" data-testid="save-status">{{
          'editorShell.saving' | transloco
        }}</app-chip>
      } @else if (dirty()) {
        <app-chip data-testid="save-status">{{
          'editorShell.save.unsaved' | transloco
        }}</app-chip>
      } @else {
        <app-chip data-testid="save-status">{{
          'editorShell.save.saved' | transloco
        }}</app-chip>
      }
    </span>
  `,
})
export class SaveStatus {
  private readonly session = inject(EntitySession);
  protected readonly saving = this.session.saving;
  protected readonly dirty = this.session.dirty;
  protected readonly conflict = this.session.conflict;
  protected readonly error = this.session.error;

  protected reload(): void {
    this.session.reload().subscribe();
  }

  /** Manual recovery after a network failure paused the scheduler. */
  protected retry(): void {
    this.session.save().subscribe();
  }
}

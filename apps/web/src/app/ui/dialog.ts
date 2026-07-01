import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  booleanAttribute,
  effect,
  input,
  output,
  viewChild,
} from '@angular/core';
import { Panel } from './panel';

/** Process-wide counter for unique heading ids, so aria-labelledby always resolves. */
let nextDialogId = 0;

/**
 * A modal dialog built on the native `<dialog>` element (ADR-0007). Leaning on
 * `showModal()` means the platform owns the hard parts — top-layer stacking, the
 * `::backdrop`, focus trapping, and Escape-to-close — so this primitive only
 * bridges that imperative API to a declarative `[open]` input and a `(closed)`
 * output. The caller projects the body as content and the footer actions into the
 * `[dialogFooter]` slot; passing a `heading` labels the dialog (`aria-labelledby`)
 * for assistive tech.
 *
 *   <app-dialog [open]="confirming()" heading="Delete?" (closed)="cancel()">
 *     <p>This cannot be undone.</p>
 *     <button dialogFooter appButton (click)="cancel()">Cancel</button>
 *     <button dialogFooter appButton danger (click)="confirm()">Delete</button>
 *   </app-dialog>
 */
@Component({
  selector: 'app-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Panel],
  template: `
    <dialog
      #dialog
      appPanel
      class="m-auto w-[min(28rem,calc(100vw-2rem))] flex-col gap-4 p-8 open:flex"
      [style.margin-top]="align() === 'top' ? '10vh' : null"
      [attr.aria-labelledby]="heading() ? titleId : null"
      (close)="closed.emit()"
    >
      @if (heading(); as h) {
        <h2 [id]="titleId" class="font-display text-md text-ink-strong m-0">
          {{ h }}
        </h2>
      }
      <ng-content />
      <div class="flex justify-end gap-2 empty:hidden">
        <ng-content select="[dialogFooter]" />
      </div>
    </dialog>
  `,
  styles: `
    dialog::backdrop {
      background: rgb(0 0 0 / 0.5);
    }
  `,
})
export class Dialog {
  /** Whether the modal is shown; drives the native showModal/close imperatively. */
  readonly open = input(false, { transform: booleanAttribute });
  /** Optional title; when set, it labels the dialog for assistive tech. */
  readonly heading = input<string>();
  /**
   * Vertical placement. `center` (default) sits mid-viewport; `top` pins it near
   * the top so a body whose height changes (e.g. a live result list) grows
   * downward instead of shifting the whole dialog.
   */
  readonly align = input<'center' | 'top'>('center');
  /** Fires whenever the dialog closes — Escape, or a programmatic close. */
  readonly closed = output<void>();

  protected readonly titleId = `app-dialog-title-${nextDialogId++}`;
  // read: ElementRef — the #dialog element also hosts appPanel, so a bare query
  // would resolve to the Panel component instance instead of the native element.
  private readonly dialog = viewChild.required('dialog', { read: ElementRef });

  constructor() {
    // Sync the imperative <dialog> to the declarative input. Guarded against the
    // element's current state so re-runs don't double-open or fight a native close.
    effect(() => {
      const el = this.dialog().nativeElement as HTMLDialogElement;
      if (this.open() && !el.open) el.showModal();
      else if (!this.open() && el.open) el.close();
    });
  }
}

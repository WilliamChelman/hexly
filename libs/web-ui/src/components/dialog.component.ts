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
import { PanelComponent } from './panel.component';

/** Process-wide counter for unique heading ids, so aria-labelledby always resolves. */
let nextDialogId = 0;

/**
 * A modal dialog built on the native `<dialog>` element (ADR-0007): `showModal()` bridged to a
 * declarative `[open]` input and a `(closed)` output, so the platform owns top-layer stacking, the
 * `::backdrop`, focus trapping, and Escape-to-close. The caller projects the body as content and the
 * footer actions into the `[dialogFooter]` slot; a `heading` labels the dialog (`aria-labelledby`).
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
  // display:contents so the wrapper never becomes a flow/grid/flex item of its host.
  // The native <dialog> renders in the top layer (modal) or display:none (closed), so a
  // conditionally-inserted dialog must contribute no box — otherwise, dropped into a
  // fixed grid (e.g. the entity page's `auto 1fr`), it steals a track and shoves siblings.
  host: { class: 'contents' },
  imports: [PanelComponent],
  template: `
    <!-- Backdrop-click-to-dismiss on the native <dialog>: the platform already gives the
         keyboard equivalent (Escape → close, wired via (close)), and the <dialog> itself must
         not be focusable — so these a11y rules, which don't model the native element, would
         only be satisfied by an incorrect handler/tabindex. -->
    <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
    <dialog
      #dialog
      appPanel
      class="m-auto w-[min(28rem,calc(100vw-2rem))] flex-col gap-4 p-8 open:flex"
      [style.margin-top]="align() === 'top' ? '10vh' : null"
      [attr.aria-labelledby]="heading() ? titleId : null"
      (close)="closed.emit()"
      (click)="onClick($event)"
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
export class DialogComponent {
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

  /**
   * Dismiss on a backdrop click. The `<dialog>` fills the top layer, so a click outside the content
   * lands on the element itself (`target === dialog`) while a body click targets an inner node.
   */
  protected onClick(event: MouseEvent): void {
    const el = this.dialog().nativeElement as HTMLDialogElement;
    if (event.target === el) el.close();
  }

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

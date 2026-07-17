import { ChangeDetectionStrategy, Component, ElementRef, effect, inject } from '@angular/core';
import { NgClass } from '@angular/common';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { TranslocoPipe } from '@jsverse/transloco';
import { ToasterService } from '@hexly/web-core';

/**
 * Renders the {@link ToasterService}'s messages as a toast stack; mounted once
 * in the app root. New toasts are announced through CDK's {@link LiveAnnouncer}
 * (an always-present live region) rather than an inserted `role="alert"`
 * element, which assistive tech routinely fails to announce. An `error` toast
 * announces assertively; the rest are polite.
 */
@Component({
  selector: 'app-toaster',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The host ignores the pointer so it never blocks the canvas; each toast
  // re-enables it for its own controls.
  host: {
    class: 'fixed left-1/2 bottom-5 -translate-x-1/2 z-[1000] flex flex-col gap-2 items-center pointer-events-none',
    // A manual popover so the stack rides the top layer, above a modal <dialog>'s backdrop
    // (a plain z-index can't beat the top layer). `manual` = we own show/hide; no light-dismiss.
    popover: 'manual',
  },
  imports: [NgClass, TranslocoPipe],
  template: `
    @for (toast of toaster.toasts(); track toast.id) {
      <!-- .toast is a test/e2e hook; its styling is inline. -->
      <div
        class="toast pointer-events-auto flex items-center gap-3 max-w-[min(90vw,32rem)] py-2 px-3 bg-surface-raised text-ink border border-l-[3px] border-t-line border-r-line border-b-line rounded-md shadow-2 text-[0.9rem]"
        [ngClass]="{
          'border-l-ember': toast.tone === 'error',
          'border-l-terrain-forest': toast.tone === 'success',
          'border-l-gold-strong': toast.tone === 'info',
        }"
      >
        <span class="flex-1">{{ toast.message }}</span>
        <button
          type="button"
          class="flex-none inline-flex items-center justify-center size-5 p-0 bg-transparent border-0 rounded-sm text-ink-muted text-[0.85rem] leading-none cursor-pointer hover:bg-surface-sunken hover:text-ink"
          data-testid="toast-dismiss"
          [attr.aria-label]="'common.close' | transloco"
          (click)="toaster.dismiss(toast.id)"
        >
          ✕
        </button>
      </div>
    }
  `,
  styles: `
    @reference '#app-styles.css';
    /* As a top-layer popover the host inherits the UA popover box (centered, bordered,
       opaque); neutralize it so the toaster keeps its own transparent, bottom-centered,
       click-through chrome. Outranks the host's positioning utilities, so re-set them. */
    :host:popover-open {
      @apply inset-auto bottom-5 left-1/2 m-0 p-0 border-0 bg-transparent overflow-visible w-auto h-auto;
    }
  `,
})
export class ToasterComponent {
  protected readonly toaster = inject(ToasterService);
  private readonly liveAnnouncer = inject(LiveAnnouncer);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  /** Toast ids already announced, reconciled to the live set so it stays bounded. */
  private announced = new Set<number>();

  constructor() {
    effect(() => {
      const toasts = this.toaster.toasts();
      for (const toast of toasts) {
        if (this.announced.has(toast.id)) continue;
        this.liveAnnouncer.announce(toast.message, toast.tone === 'error' ? 'assertive' : 'polite');
      }
      this.announced = new Set(toasts.map((toast) => toast.id));
      this.syncTopLayer(toasts.length > 0);
    });
  }

  /**
   * Keep the toast stack in the top layer while any toast is showing. Re-showing on each
   * change re-enters the top layer at the top of the stack — so a toast raised *while* a
   * modal <dialog> is open lands above its backdrop (top-layer order is most-recent-first).
   */
  private syncTopLayer(hasToasts: boolean): void {
    const el = this.host.nativeElement;
    try {
      const open = el.matches(':popover-open');
      if (!hasToasts) {
        if (open) el.hidePopover();
        return;
      }
      if (open) el.hidePopover();
      el.showPopover();
    } catch {
      // The Popover API is absent under jsdom, where the `popover` attribute is
      // inert and toasts render in normal flow.
    }
  }
}

import {
  ApplicationRef,
  EnvironmentInjector,
  Injectable,
  Injector,
  Type,
  createComponent,
  inject,
} from '@angular/core';
import { Observable, Subject } from 'rxjs';

/**
 * Handle to a dialog opened through {@link DialogService}. Injected by the opened component to read
 * the `data` it was launched with and to `close()` itself (optionally returning a result) — so a
 * dialog needs no reference back to whatever opened it, and no shared state signal to bridge them.
 */
export class DialogRef<Data = unknown, Result = unknown> {
  private readonly _closed = new Subject<Result | undefined>();
  /** Emits once with the result when the dialog closes (button, Escape, or backdrop), then completes. */
  readonly closed: Observable<Result | undefined> = this._closed.asObservable();

  constructor(readonly data: Data) {}

  /** Close the dialog and tear it down. Idempotent — a second call is a no-op. */
  close(result?: Result): void {
    this._closed.next(result);
    this._closed.complete();
  }
}

/**
 * Opens a dialog component on demand instead of mounting it in a template, so a Command's `run()`
 * (or a button) can launch one without the component being permanently in the tree behind a shared
 * open-state signal.
 *
 * The component is created, attached to the app's change detection, and appended to `<body>`; it
 * renders its own native `<dialog>` (ADR-0007), so the platform still owns the top layer, backdrop,
 * and focus trap — this service adds no overlay of its own. It tears the component down when its
 * {@link DialogRef} closes.
 */
@Injectable({ providedIn: 'root' })
export class DialogService {
  private readonly appRef = inject(ApplicationRef);
  private readonly environmentInjector = inject(EnvironmentInjector);

  open<Data = unknown, Result = unknown>(component: Type<unknown>, data?: Data): DialogRef<Data, Result> {
    const ref = new DialogRef<Data, Result>(data as Data);
    // We remove the <dialog> element ourselves on close, which skips the native focus restoration —
    // so capture the caller's focus (e.g. the Command Palette input) and hand it back afterwards.
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const componentRef = createComponent(component, {
      environmentInjector: this.environmentInjector,
      elementInjector: Injector.create({
        providers: [{ provide: DialogRef, useValue: ref }],
        parent: this.environmentInjector,
      }),
    });
    document.body.appendChild(componentRef.location.nativeElement);
    this.appRef.attachView(componentRef.hostView);

    ref.closed.subscribe(() => {
      this.appRef.detachView(componentRef.hostView);
      componentRef.destroy();
      previouslyFocused?.focus?.();
    });

    return ref;
  }
}

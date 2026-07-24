import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ShortcutService } from '@hexly/web-core';
import { DialogComponent } from './dialog.component';

/** Drives the primitive from a typed signal, the way the Index does. */
@Component({
  imports: [DialogComponent],
  template: `
    <app-dialog [open]="open()" [heading]="heading()" (closed)="closes = closes + 1">
      <p>Body</p>
      <button dialogFooter>Confirm</button>
    </app-dialog>
  `,
})
class Host {
  readonly open = signal(false);
  readonly heading = signal<string | undefined>(undefined);
  closes = 0;
}

describe('Dialog', () => {
  // The imperative <dialog> API is polyfilled for jsdom in test-setup.ts.
  beforeEach(() => TestBed.configureTestingModule({ imports: [Host] }));

  function render() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    return { fixture, dialog };
  }

  it('shows the modal when open and closes it when not', () => {
    const { fixture, dialog } = render();
    const show = vi.spyOn(dialog, 'showModal');
    const close = vi.spyOn(dialog, 'close');

    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    expect(show).toHaveBeenCalledOnce();

    fixture.componentInstance.open.set(false);
    fixture.detectChanges();
    expect(close).toHaveBeenCalledOnce();
  });

  it('emits closed on the native close event (Escape or programmatic)', () => {
    const { fixture, dialog } = render();

    dialog.dispatchEvent(new Event('close'));
    expect(fixture.componentInstance.closes).toBe(1);
  });

  it('closes when the backdrop (the dialog element itself) is clicked', () => {
    const { fixture, dialog } = render();
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    const close = vi.spyOn(dialog, 'close');

    // A backdrop click lands on the <dialog> element; a click on the body does not.
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(close).toHaveBeenCalledOnce();

    const body = dialog.querySelector('p') as HTMLElement;
    body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(close).toHaveBeenCalledOnce();
  });

  it('labels the dialog with the heading for assistive tech', () => {
    const { fixture, dialog } = render();
    expect(dialog.getAttribute('aria-labelledby')).toBeNull();

    fixture.componentInstance.heading.set('Delete world?');
    fixture.detectChanges();

    const titleId = dialog.getAttribute('aria-labelledby');
    expect(titleId).not.toBeNull();
    const heading = fixture.nativeElement.querySelector(`#${titleId}`);
    expect(heading?.textContent).toContain('Delete world?');
  });

  it('projects body content and footer actions', () => {
    const el = render().fixture.nativeElement as HTMLElement;
    expect(el.querySelector('p')?.textContent).toBe('Body');
    expect(el.querySelector('button[dialogFooter]')?.textContent).toContain('Confirm');
  });

  /**
   * A declaratively-mounted dialog claims the keyboard exactly like a DialogService one (ADR-0063,
   * amendment): without the scope, a surface's Escape registration preventDefaults the keydown, which
   * cancels the native <dialog> "cancel" — Escape could never close a dialog opened over a board/hexmap.
   */
  describe('modal shortcut scope', () => {
    function pressEscape(): KeyboardEvent {
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      window.dispatchEvent(event);
      return event;
    }

    it('suppresses surface shortcuts while open, so Escape reaches the native cancel un-defaulted', () => {
      const handler = vi.fn();
      const unregister = TestBed.inject(ShortcutService).register({ layer: 'surface', keys: 'escape', handler });
      const { fixture } = render();

      fixture.componentInstance.open.set(true);
      fixture.detectChanges();

      // The surface handler is silenced and nothing preventDefaults, so the platform's
      // Escape-to-close (the native cancel → close) proceeds.
      const whileOpen = pressEscape();
      expect(handler).not.toHaveBeenCalled();
      expect(whileOpen.defaultPrevented).toBe(false);

      fixture.componentInstance.open.set(false);
      fixture.detectChanges();

      // Scope released on close: the surface owns Escape again (open → close → open re-holds it).
      pressEscape();
      expect(handler).toHaveBeenCalledOnce();

      fixture.componentInstance.open.set(true);
      fixture.detectChanges();
      pressEscape();
      expect(handler).toHaveBeenCalledOnce();

      unregister();
    });

    it('releases the scope when destroyed while open — no close event ever fires', () => {
      const handler = vi.fn();
      const unregister = TestBed.inject(ShortcutService).register({ layer: 'surface', keys: 'escape', handler });
      const { fixture } = render();
      fixture.componentInstance.open.set(true);
      fixture.detectChanges();

      fixture.destroy();

      pressEscape();
      expect(handler).toHaveBeenCalledOnce();
      unregister();
    });
  });
});

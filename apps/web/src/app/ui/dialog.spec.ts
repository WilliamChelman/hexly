import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Dialog } from './dialog';

/** Drives the primitive from a typed signal, the way the Index does. */
@Component({
  imports: [Dialog],
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
    const dialog = fixture.nativeElement.querySelector(
      'dialog',
    ) as HTMLDialogElement;
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
    expect(el.querySelector('button[dialogFooter]')?.textContent).toContain(
      'Confirm',
    );
  });
});

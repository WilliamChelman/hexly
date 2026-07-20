import { ApplicationRef, Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ShortcutService } from '@hexly/web-core';
import { DialogRef, DialogService } from './dialog.service';

/** A standalone stand-in for a real dialog: reads its seed from the ref and can close with a result. */
@Component({
  selector: 'app-test-dialog',
  template: `<p data-testid="body">{{ ref.data }}</p>`,
})
class TestDialogComponent {
  readonly ref = inject(DialogRef) as DialogRef<string, string>;
}

describe('DialogService', () => {
  let service: DialogService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(DialogService);
  });

  function body() {
    return document.body.querySelector('[data-testid="body"]');
  }

  it('creates the component in the document body, seeded with the data it was opened with', () => {
    service.open<string, string>(TestDialogComponent, 'seed');
    TestBed.inject(ApplicationRef).tick();

    expect(body()?.textContent).toBe('seed');
  });

  it('tears the component down and reports the result on close', () => {
    const ref = service.open<string, string>(TestDialogComponent, 'seed');
    let result: string | undefined;
    ref.closed.subscribe((r) => (result = r));

    ref.close('done');

    expect(body()).toBeNull();
    expect(result).toBe('done');
  });

  it('restores focus to whatever was focused when it opened', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    const ref = service.open(TestDialogComponent);
    ref.close();

    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('holds a modal shortcut scope while open, so surface shortcuts cannot fire behind it (ADR-0063)', () => {
    const handler = vi.fn();
    TestBed.inject(ShortcutService).register({ layer: 'surface', keys: 'backspace', handler });
    const press = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true }));

    const ref = service.open(TestDialogComponent);
    press();
    expect(handler).not.toHaveBeenCalled();

    ref.close();
    press();
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

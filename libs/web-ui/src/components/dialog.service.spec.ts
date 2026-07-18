import { ApplicationRef, Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
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
});

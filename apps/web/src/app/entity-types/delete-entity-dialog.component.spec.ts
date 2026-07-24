import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { TestBed } from '@angular/core/testing';
import { NEVER, of } from 'rxjs';
import { InboundReference } from '@hexly/domain';
import { EntitiesClient } from '@hexly/web-core';
import { MockEntitiesClient } from '@hexly/web-core/testing';
import { DialogRef } from '@hexly/web-ui';
import { DeleteEntityDialogComponent, DeleteEntityDialogData } from './delete-entity-dialog.component';

/** A viewer-visible inbound reference — the shape the usage list names. */
function inbound(id: string, name: string): InboundReference {
  return { descriptor: null, decor: false, source: { id, name, types: ['core.type.note'] } };
}

describe('DeleteEntityDialog', () => {
  let client: MockEntitiesClient;
  let dialogRef: DialogRef<DeleteEntityDialogData, boolean>;

  function render(data: DeleteEntityDialogData, referencedBy: readonly InboundReference[] = []) {
    client = new MockEntitiesClient();
    client.references.mockReturnValue(of({ references: [], referencedBy }));
    dialogRef = new DialogRef<DeleteEntityDialogData, boolean>(data);
    vi.spyOn(dialogRef, 'close');
    TestBed.configureTestingModule({
      imports: [DeleteEntityDialogComponent, provideTranslocoTesting()],
      providers: [
        { provide: EntitiesClient, useValue: client },
        { provide: DialogRef, useValue: dialogRef },
      ],
    });
    const fixture = TestBed.createComponent(DeleteEntityDialogComponent);
    fixture.detectChanges();
    return fixture;
  }

  const q = (fixture: ReturnType<typeof render>, testid: string) =>
    fixture.nativeElement.querySelector(`[data-testid="${testid}"]`) as HTMLElement | null;

  it('reads the target Entity’s usage per viewer (ADR-0065/ADR-0046)', () => {
    render({ id: 'a1', name: 'Map.png' });
    expect(client.references).toHaveBeenCalledWith('a1');
  });

  it('shows a plain prompt naming the target when nothing references it', () => {
    const fixture = render({ id: 'a1', name: 'Map.png' });

    expect(q(fixture, 'delete-prompt')?.textContent).toContain('Map.png');
    expect(q(fixture, 'delete-usage-list')).toBeNull();
  });

  it('names the referencing Entities the caller can see', () => {
    const fixture = render({ id: 'a1', name: 'Map.png' }, [inbound('e1', 'The Reach'), inbound('e2', 'Aldermoor')]);

    expect(q(fixture, 'delete-usage-intro')?.textContent).toContain('Map.png');
    const names = Array.from(fixture.nativeElement.querySelectorAll('[data-testid=delete-usage-item]')).map((el) =>
      (el as HTMLElement).textContent?.trim(),
    );
    expect(names).toEqual(['The Reach', 'Aldermoor']);
    expect(q(fixture, 'delete-usage-more')).toBeNull();
  });

  it('caps the named list at five and collapses the rest into "and N more"', () => {
    const refs = Array.from({ length: 8 }, (_, i) => inbound(`e${i}`, `Entity ${i}`));
    const fixture = render({ id: 'a1', name: 'Map.png' }, refs);

    expect(fixture.nativeElement.querySelectorAll('[data-testid=delete-usage-item]')).toHaveLength(5);
    // 8 referrers − 5 named = 3 collapsed.
    expect(q(fixture, 'delete-usage-more')?.textContent).toContain('3');
  });

  it('resolves true on confirm', () => {
    const fixture = render({ id: 'a1', name: 'Map.png' });

    (q(fixture, 'delete-confirm') as HTMLButtonElement).click();

    expect(dialogRef.close).toHaveBeenCalledWith(true);
  });

  it('resolves false on cancel', () => {
    const fixture = render({ id: 'a1', name: 'Map.png' });

    (q(fixture, 'delete-cancel') as HTMLButtonElement).click();

    expect(dialogRef.close).toHaveBeenCalledWith(false);
  });

  it('stays inert until usage lands, so a delete is never confirmed before its usage is shown', () => {
    client = new MockEntitiesClient();
    client.references.mockReturnValue(NEVER); // usage never resolves
    dialogRef = new DialogRef<DeleteEntityDialogData, boolean>({ id: 'a1', name: 'Map.png' });
    vi.spyOn(dialogRef, 'close');
    TestBed.configureTestingModule({
      imports: [DeleteEntityDialogComponent, provideTranslocoTesting()],
      providers: [
        { provide: EntitiesClient, useValue: client },
        { provide: DialogRef, useValue: dialogRef },
      ],
    });
    const fixture = TestBed.createComponent(DeleteEntityDialogComponent);
    fixture.detectChanges();

    const confirm = fixture.nativeElement.querySelector('[data-testid=delete-confirm]') as HTMLButtonElement;
    expect(confirm.getAttribute('aria-disabled')).toBe('true');
    confirm.click();
    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid=delete-checking]')).not.toBeNull();
  });
});

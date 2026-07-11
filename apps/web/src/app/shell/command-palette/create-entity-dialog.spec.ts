import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { emptyContent, EntityDetail, WorldSummary } from '@hexly/domain';
import { ActiveWorld, EntitiesClient, WorldStore } from '@hexly/web-core';
import { MockEntitiesClient, provideTranslocoTesting } from '@hexly/web-core/testing';
import { CreateEntityDialogState } from './create-entity-dialog.state';
import { CreateEntityDialog } from './create-entity-dialog';

function world(id: string, name: string): WorldSummary {
  return { id, name, owners: ['u1'], rights: ['read', 'manage'], createdAt: 1, updatedAt: 1 };
}

describe('CreateEntityDialog', () => {
  let entitiesClient: MockEntitiesClient;
  let navigate: ReturnType<typeof vi.spyOn>;
  let state: CreateEntityDialogState;

  function render(worlds: WorldSummary[], activeWorldId: string | null) {
    entitiesClient = new MockEntitiesClient();
    TestBed.configureTestingModule({
      imports: [CreateEntityDialog, provideTranslocoTesting()],
      providers: [
        provideRouter([]),
        { provide: EntitiesClient, useValue: entitiesClient },
        { provide: WorldStore, useValue: { worlds: () => worlds } },
      ],
    });
    navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    TestBed.inject(ActiveWorld).set(activeWorldId);
    state = TestBed.inject(CreateEntityDialogState);
    const fixture = TestBed.createComponent(CreateEntityDialog);
    fixture.detectChanges();
    return fixture;
  }

  function q(fixture: ReturnType<typeof render>, testid: string) {
    return fixture.nativeElement.querySelector(`[data-testid="${testid}"]`);
  }

  it('stays closed until the dialog state names a type to create', () => {
    const fixture = render([world('w1', 'Aldermoor')], 'w1');
    expect(fixture.nativeElement.querySelector('dialog')?.open).toBeFalsy();
  });

  it('opens prefilled to the active World when Create Note runs', () => {
    const fixture = render(
      [world('w1', 'Aldermoor'), world('w2', 'Whisperwood')],
      'w2',
    );

    state.open('core.note');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('dialog')?.open).toBe(true);
    const select: HTMLSelectElement = q(fixture, 'create-entity-world');
    expect(select.value).toBe('w2');
  });

  it("falls back to the first loaded World when there's no active World", () => {
    const fixture = render(
      [world('w1', 'Aldermoor'), world('w2', 'Whisperwood')],
      null,
    );

    state.open('core.hexmap');
    fixture.detectChanges();

    const select: HTMLSelectElement = q(fixture, 'create-entity-world');
    expect(select.value).toBe('w1');
  });

  it('creates the Entity in the selected World and navigates to it', () => {
    const fixture = render([world('w1', 'Aldermoor')], 'w1');
    const created: EntityDetail = {
      id: 'e1',
      name: 'The Reach',
      worldId: 'w1',
      types: ['core.note'],
      tags: [],
      visibility: 'private',
      version: 1,
      seq: 1,
      createdAt: 1,
      updatedAt: 1,
      document: { content: emptyContent() },
    };
    entitiesClient.create.mockReturnValue(of(created));

    state.open('core.note');
    fixture.detectChanges();

    const nameInput: HTMLInputElement = q(fixture, 'create-entity-name');
    nameInput.value = 'The Reach';
    nameInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (q(fixture, 'create-entity-submit') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(entitiesClient.create).toHaveBeenCalledWith(
      'The Reach',
      'core.note',
      'w1',
    );
    expect(navigate).toHaveBeenCalledWith(['/w', 'w1', 'entities', 'e1']);
    expect(fixture.nativeElement.querySelector('dialog')?.open).toBeFalsy();
  });

  it('closes without creating anything on cancel', () => {
    const fixture = render([world('w1', 'Aldermoor')], 'w1');
    state.open('core.note');
    fixture.detectChanges();

    (q(fixture, 'create-entity-cancel') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(entitiesClient.create).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('dialog')?.open).toBeFalsy();
  });
});

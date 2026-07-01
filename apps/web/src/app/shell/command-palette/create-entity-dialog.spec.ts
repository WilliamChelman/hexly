import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { emptyContent, EntityDetail, WorldSummary } from '@hexly/domain';
import { ActiveWorld } from '../../core/services/active-world';
import { EntitiesClient } from '../../core/services/entities.client';
import { MockEntitiesClient } from '../../core/testing/entities-client.mock';
import { WorldStore } from '../../core/services/world.store';
import { provideTranslocoTesting } from '../../core/i18n/transloco-testing';
import { CreateEntityDialogState } from './create-entity-dialog.state';
import { CreateEntityDialog } from './create-entity-dialog';

function world(id: string, name: string): WorldSummary {
  return { id, name, ownerId: 'u1', createdAt: 1, updatedAt: 1 };
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

    state.open('note');
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

    state.open('hexmap');
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
      ownerId: 'u1',
      type: 'note',
      tags: [],
      visibility: 'private',
      version: 1,
      createdAt: 1,
      updatedAt: 1,
      document: { type: 'note', content: emptyContent() },
    };
    entitiesClient.create.mockReturnValue(of(created));

    state.open('note');
    fixture.detectChanges();

    const nameInput: HTMLInputElement = q(fixture, 'create-entity-name');
    nameInput.value = 'The Reach';
    nameInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (q(fixture, 'create-entity-submit') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(entitiesClient.create).toHaveBeenCalledWith(
      'The Reach',
      'note',
      'w1',
    );
    expect(navigate).toHaveBeenCalledWith(['/w', 'w1', 'entities', 'e1']);
    expect(fixture.nativeElement.querySelector('dialog')?.open).toBeFalsy();
  });

  it('closes without creating anything on cancel', () => {
    const fixture = render([world('w1', 'Aldermoor')], 'w1');
    state.open('note');
    fixture.detectChanges();

    (q(fixture, 'create-entity-cancel') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(entitiesClient.create).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('dialog')?.open).toBeFalsy();
  });
});

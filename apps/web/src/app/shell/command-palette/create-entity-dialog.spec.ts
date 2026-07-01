import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { EntityDetail, WorldSummary } from '@hexly/domain';
import { ActiveWorld } from '../../core/services/active-world';
import { EntitiesClient } from '../../core/services/entities.client';
import { MockEntitiesClient } from '../../core/testing/entities-client.mock';
import { WorldStore } from '../../core/services/world.store';
import { provideTranslocoTesting } from '../../core/i18n/transloco-testing';
import { CreateEntityLauncher } from './create-entity-launcher';
import { CreateEntityDialog } from './create-entity-dialog';

function world(id: string, name: string): WorldSummary {
  return { id, name, ownerId: 'u1', createdAt: 1, updatedAt: 1 };
}

describe('CreateEntityDialog', () => {
  let client: MockEntitiesClient;
  let launcher: CreateEntityLauncher;
  let navigate: ReturnType<typeof vi.spyOn>;

  function render(worlds: WorldSummary[], activeId: string | null) {
    client = new MockEntitiesClient();
    TestBed.configureTestingModule({
      imports: [CreateEntityDialog, provideTranslocoTesting()],
      providers: [
        provideRouter([]),
        { provide: EntitiesClient, useValue: client },
        { provide: WorldStore, useValue: { worlds: signal(worlds) } },
      ],
    });
    TestBed.inject(ActiveWorld).set(activeId);
    launcher = TestBed.inject(CreateEntityLauncher);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(CreateEntityDialog);
    fixture.detectChanges();
    return fixture;
  }

  const el = (f: ReturnType<typeof render>, testid: string) =>
    f.nativeElement.querySelector(`[data-testid=${testid}]`);

  it('creates the Entity in the prefilled World and navigates to it', () => {
    const created = { id: 'e9' } as EntityDetail;
    const fixture = render([world('w1', 'Aldermoor'), world('w2', 'Whisperwood')], 'w2');
    client.create.mockReturnValue(of(created));

    launcher.open('note');
    fixture.detectChanges();

    const name = el(fixture, 'create-name') as HTMLInputElement;
    name.value = 'Bramblewick';
    name.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (el(fixture, 'create-submit') as HTMLButtonElement).click();

    // Prefilled to the active World (ADR-0028), not the first in the list.
    expect(client.create).toHaveBeenCalledWith('Bramblewick', 'note', 'w2');
    expect(navigate).toHaveBeenCalledWith(['/entities', 'e9']);
    expect(launcher.type()).toBeNull();
  });
});

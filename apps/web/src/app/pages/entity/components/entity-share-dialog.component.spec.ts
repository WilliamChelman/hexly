import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { of } from 'rxjs';
import { AuthClient, ClientConfigStore, EntitiesClient, UserDirectoryClient, WorldsClient } from '@hexly/web-core';
import {
  MockAuthClient,
  MockEntitiesClient,
  MockUserDirectoryClient,
  MockWorldsClient,
  mockClientConfigStore,
} from '@hexly/web-core/testing';
import { GrantSetComponent, OwnerSetComponent, ENTITY_SESSION } from '@hexly/web-entity';
import { providePluginContent } from '@hexly/plugin-content/web';
import { provideTranslocoTesting } from '../../../../testing/transloco-testing';
import { EntitySession } from '../services/entity-session';
import { EntityShareDialogComponent } from './entity-share-dialog.component';
import { noteDetail } from './note-detail.fixtures';

describe('EntityShareDialog', () => {
  let entities: MockEntitiesClient;
  let collaboration: WritableSignal<boolean>;

  beforeEach(async () => {
    entities = new MockEntitiesClient();
    collaboration = signal(true);
    const users = new MockUserDirectoryClient();
    users.list.mockReturnValue(of([{ id: 'u1', displayName: 'Ada' }]));
    await TestBed.configureTestingModule({
      imports: [EntityShareDialogComponent, provideTranslocoTesting()],
      providers: [
        providePluginContent(),
        EntitySession,
        { provide: ENTITY_SESSION, useExisting: EntitySession },
        { provide: EntitiesClient, useValue: entities },
        { provide: WorldsClient, useValue: new MockWorldsClient() },
        { provide: UserDirectoryClient, useValue: users },
        { provide: AuthClient, useValue: new MockAuthClient() },
        { provide: ClientConfigStore, useValue: mockClientConfigStore({ collaboration }) },
      ],
    }).compileComponents();
    entities.owners.mockReturnValue(of(['u1']));
  });

  /** Mount the dialog asked to be open, over an Entity opened through the real session. */
  function render(): ComponentFixture<EntityShareDialogComponent> {
    const detail = noteDetail('Lady Mara');
    entities.load.mockReturnValue(of(detail));
    TestBed.inject(EntitySession).open(detail.id).subscribe();
    const fixture = TestBed.createComponent(EntityShareDialogComponent);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    return fixture;
  }

  it('mounts the owner set and the grant set for the open Entity', () => {
    const fixture = render();

    expect(fixture.debugElement.query(By.directive(OwnerSetComponent))).not.toBeNull();
    expect(fixture.debugElement.query(By.directive(GrantSetComponent))).not.toBeNull();
  });

  // The surface guards itself, so no host can mount it and nothing fetches an endpoint that now 404s
  // (ADR-0071, #316).
  it('renders nothing when Collaboration is off, even asked to open', () => {
    collaboration.set(false);
    const fixture = render();

    expect(fixture.debugElement.query(By.directive(OwnerSetComponent))).toBeNull();
    expect(fixture.debugElement.query(By.directive(GrantSetComponent))).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid=owners-close]')).toBeNull();
    expect(entities.owners).not.toHaveBeenCalled();
    expect(entities.grants).not.toHaveBeenCalled();
  });
});

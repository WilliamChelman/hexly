import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { CORE_HEXMAP, EntityDetail, EntitySaveOutcome, HexMap, coordKey, emptyContent } from '@hexly/domain';
import { provideTranslocoTesting, MockEntitiesClient } from '@hexly/web-core/testing';
import { EntitiesClient } from '@hexly/web-core';
import { EntitySession } from '../services/entity-session';
import { HexMapStore } from '@hexly/web-map';
import { ENTITY_SESSION } from '@hexly/web-entity';
import { SaveStatus } from './save-status';

// Autosave feedback chip that replaced the Save button (ADR-0026):
// one aria-live surface over the session's saving/dirty/error/conflict state.
describe('SaveStatus', () => {
  let session: EntitySession;
  let editor: HexMapStore;
  let entities: MockEntitiesClient;
  let fixture: ComponentFixture<SaveStatus>;

  const content = emptyContent();
  const bodyOf = (grid: HexMap) => ({ content, ...grid });
  const forestAt00: HexMap = {
    hexes: { [coordKey({ q: 0, r: 0 })]: { terrain: 'forest' } },
    regions: [],
    labels: [],
  };
  const aldermoor: EntityDetail = {
    id: 'm1',
    worldId: 'w1',
    name: 'Aldermoor',
    types: [CORE_HEXMAP],
    tags: [],
    visibility: 'private',
    version: 3,
    seq: 1,
    createdAt: 1,
    updatedAt: 1,
    // Owner opener (ADR-0039): the `edit` Right keeps saves flowing.
    rights: ['read', 'edit', 'delete', 'set-visibility', 'manage'],
    document: bodyOf(forestAt00),
  };

  beforeEach(() => {
    entities = new MockEntitiesClient();
    TestBed.configureTestingModule({
      imports: [SaveStatus, provideTranslocoTesting()],
      providers: [
        EntitySession,
        HexMapStore,
        { provide: ENTITY_SESSION, useExisting: EntitySession },
        { provide: EntitiesClient, useValue: entities },
        provideRouter([]),
      ],
    });
    session = TestBed.inject(EntitySession);
    editor = TestBed.inject(HexMapStore);
    fixture = TestBed.createComponent(SaveStatus);
  });

  function open() {
    entities.load.mockReturnValue(of(aldermoor));
    session.open('m1').subscribe();
    fixture.detectChanges();
  }

  const text = () => fixture.nativeElement.textContent as string;

  it('reads Saved when the open entity is clean', () => {
    open();
    expect(text()).toContain('Saved');
  });

  it('reads Unsaved after an edit, before the save lands', () => {
    open();
    editor.paintAt({ q: 5, r: 5 }, 'ocean');
    fixture.detectChanges();
    expect(text()).toContain('Unsaved');
  });

  it('reads Saving while a save is in flight, then Saved', () => {
    open();
    editor.paintAt({ q: 5, r: 5 }, 'ocean');
    const save$ = new Subject<EntitySaveOutcome>();
    entities.save.mockReturnValue(save$);
    session.save().subscribe();
    fixture.detectChanges();
    expect(text()).toContain('Saving');

    save$.next({
      status: 'saved',
      entity: { ...aldermoor, version: 4, document: bodyOf(editor.document()) },
    });
    save$.complete();
    fixture.detectChanges();
    expect(text()).toContain('Saved');
  });

  it('shows a conflict with a working Reload', () => {
    open();
    editor.paintAt({ q: 5, r: 5 }, 'ocean');
    entities.save.mockReturnValue(of({ status: 'conflict', current: aldermoor }));
    session.save().subscribe();
    fixture.detectChanges();
    expect(text()).toContain('Newer version on server');

    entities.load.mockReturnValue(of(aldermoor));
    (fixture.nativeElement.querySelector('[data-testid=conflict-reload]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(session.conflict()).toBeNull();
  });

  it('surfaces a failed Reload while keeping the conflict and its Reload button', () => {
    open();
    editor.paintAt({ q: 5, r: 5 }, 'ocean');
    entities.save.mockReturnValue(of({ status: 'conflict', current: aldermoor }));
    session.save().subscribe();
    fixture.detectChanges();

    // Re-pull fails: the conflict stands, but the user must be told Reload failed
    // else the chip looks unchanged and Reload appears to do nothing (ADR-0026).
    entities.load.mockReturnValue(throwError(() => new Error('network')));
    (fixture.nativeElement.querySelector('[data-testid=conflict-reload]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(session.conflict()).not.toBeNull();
    expect(session.error()).toBe('reload');
    expect(fixture.nativeElement.querySelector('[data-testid=reload-error]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid=conflict-reload]')).not.toBeNull();
  });

  it('shows a save error with a Retry that re-saves', () => {
    open();
    editor.paintAt({ q: 5, r: 5 }, 'ocean');
    entities.save.mockReturnValue(throwError(() => new Error('network')));
    session.save().subscribe();
    fixture.detectChanges();
    expect(text()).toContain('Save failed');

    entities.save.mockReturnValue(
      of({
        status: 'saved',
        entity: {
          ...aldermoor,
          version: 4,
          document: bodyOf(editor.document()),
        },
      }),
    );
    (fixture.nativeElement.querySelector('[data-testid=save-retry]') as HTMLButtonElement).click();
    expect(entities.save).toHaveBeenCalledTimes(2);
  });

  it('announces status politely for assistive tech', () => {
    open();
    const live = fixture.nativeElement.querySelector('[aria-live=polite]');
    expect(live).not.toBeNull();
  });
});

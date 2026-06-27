import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { EntityDetail, HexMap, coordKey, emptyContent } from '@hexly/domain';
import { provideTranslocoTesting } from '../../../core/i18n/transloco-testing';
import { EntitySession } from '../services/entity-session';
import { HexMapStore } from '../services/hexmap-store';
import { SaveStatus } from './save-status';

// SaveStatus is the autosave feedback chip that replaced the Save button (ADR-0026):
// one aria-live surface over the session's saving/dirty/error/conflict state.
describe('SaveStatus', () => {
  let session: EntitySession;
  let editor: HexMapStore;
  let http: HttpTestingController;
  let fixture: ComponentFixture<SaveStatus>;

  const content = emptyContent();
  const bodyOf = (grid: HexMap) => ({ type: 'hexmap' as const, content, ...grid });
  const forestAt00: HexMap = {
    hexes: { [coordKey({ q: 0, r: 0 })]: { terrain: 'forest' } },
    regions: [],
    labels: [],
  };
  const aldermoor: EntityDetail = {
    id: 'm1',
    ownerId: 'u1',
    name: 'Aldermoor',
    type: 'hexmap',
    tags: [],
    visibility: 'private',
    version: 3,
    createdAt: 1,
    updatedAt: 1,
    document: bodyOf(forestAt00),
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [SaveStatus, provideTranslocoTesting()],
      providers: [
        EntitySession,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
    session = TestBed.inject(EntitySession);
    editor = TestBed.inject(HexMapStore);
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(SaveStatus);
  });

  afterEach(() => http.verify());

  function open() {
    session.open('m1').subscribe();
    http.expectOne('/api/entities/m1').flush(aldermoor);
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
    session.save().subscribe();
    fixture.detectChanges();
    expect(text()).toContain('Saving');

    http
      .expectOne('/api/entities/m1')
      .flush({ ...aldermoor, version: 4, document: bodyOf(editor.document()) });
    fixture.detectChanges();
    expect(text()).toContain('Saved');
  });

  it('shows a conflict with a working Reload', () => {
    open();
    editor.paintAt({ q: 5, r: 5 }, 'ocean');
    session.save().subscribe();
    http
      .expectOne('/api/entities/m1')
      .flush(aldermoor, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();
    expect(text()).toContain('Newer version on server');

    (
      fixture.nativeElement.querySelector(
        '[data-testid=conflict-reload]',
      ) as HTMLButtonElement
    ).click();
    http.expectOne('/api/entities/m1').flush(aldermoor);
    fixture.detectChanges();
    expect(session.conflict()).toBeNull();
  });

  it('surfaces a failed Reload while keeping the conflict and its Reload button', () => {
    open();
    editor.paintAt({ q: 5, r: 5 }, 'ocean');
    session.save().subscribe();
    http
      .expectOne('/api/entities/m1')
      .flush(aldermoor, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();

    // The re-pull fails: the conflict stands, but the user must be told Reload failed —
    // else the chip looks unchanged and Reload appears to do nothing (ADR-0026).
    (
      fixture.nativeElement.querySelector(
        '[data-testid=conflict-reload]',
      ) as HTMLButtonElement
    ).click();
    http.expectOne('/api/entities/m1').error(new ProgressEvent('network'));
    fixture.detectChanges();

    expect(session.conflict()).not.toBeNull();
    expect(session.error()).toBe('reload');
    expect(
      fixture.nativeElement.querySelector('[data-testid=reload-error]'),
    ).not.toBeNull();
    // The Reload button is still there to try again.
    expect(
      fixture.nativeElement.querySelector('[data-testid=conflict-reload]'),
    ).not.toBeNull();
  });

  it('shows a save error with a Retry that re-saves', () => {
    open();
    editor.paintAt({ q: 5, r: 5 }, 'ocean');
    session.save().subscribe();
    http
      .expectOne('/api/entities/m1')
      .error(new ProgressEvent('network'));
    fixture.detectChanges();
    expect(text()).toContain('Save failed');

    (
      fixture.nativeElement.querySelector(
        '[data-testid=save-retry]',
      ) as HTMLButtonElement
    ).click();
    const retry = http.expectOne('/api/entities/m1');
    expect(retry.request.method).toBe('PUT');
    retry.flush({ ...aldermoor, version: 4, document: bodyOf(editor.document()) });
  });

  it('announces status politely for assistive tech', () => {
    open();
    const live = fixture.nativeElement.querySelector('[aria-live=polite]');
    expect(live).not.toBeNull();
  });
});

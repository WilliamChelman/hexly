import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { CONTENT_FORMAT, coordKey, emptyContent, EntityDetail, HexMap } from '@hexly/domain';
import { provideTranslocoTesting } from '../../../core/i18n/transloco-testing';
import { EntitySession } from './entity-session';
import { HexMapStore } from './hexmap-store';

describe('EntitySession', () => {
  let session: EntitySession;
  let editor: HexMapStore;
  let http: HttpTestingController;

  const content = emptyContent();
  /** Wrap a hex grid into the hexmap body the store carries end to end. */
  const bodyOf = (grid: HexMap) => ({ type: 'hexmap' as const, content, ...grid });

  const forestAt00: HexMap = {
    hexes: { [coordKey({ q: 0, r: 0 })]: { terrain: 'forest' } },
    regions: [],
    labels: [],
  };
  const desertAt99: HexMap = {
    hexes: { [coordKey({ q: 9, r: 9 })]: { terrain: 'desert' } },
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
      imports: [provideTranslocoTesting()],
      providers: [
        EntitySession,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    session = TestBed.inject(EntitySession);
    editor = TestBed.inject(HexMapStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('opens an entity by id and loads its hex grid into the editor', () => {
    session.open('m1').subscribe();

    http.expectOne('/api/entities/m1').flush(aldermoor);

    // The editor sees the bare grid, not the body — the seam unwraps it.
    expect(editor.document()).toEqual(forestAt00);
  });

  /** Open Aldermoor (version 3) so save/conflict tests have an open entity. */
  function openAldermoor() {
    session.open('m1').subscribe();
    http.expectOne('/api/entities/m1').flush(aldermoor);
  }

  it('saves the editor grid, re-wrapped under the open entity base version', () => {
    openAldermoor();
    editor.paintAt({ q: 5, r: 5 }, 'ocean');

    let outcome: unknown;
    session.save().subscribe((o) => (outcome = o));

    const req = http.expectOne('/api/entities/m1');
    expect(req.request.method).toBe('PUT');
    // Content preserved untouched.
    expect(req.request.body).toEqual({
      document: bodyOf(editor.document()),
      version: 3,
      tags: [],
    });

    const saved: EntityDetail = {
      ...aldermoor,
      version: 4,
      document: bodyOf(editor.document()),
    };
    req.flush(saved);
    expect(outcome).toEqual({ status: 'saved', entity: saved });
  });

  it('seeds the open entity’s tags and sends edited tags with the save (#72)', () => {
    openAldermoor();
    expect(session.tags()).toEqual([]);

    session.setTags(['deity', 'ruined']);
    expect(session.tags()).toEqual(['deity', 'ruined']);

    session.save().subscribe();

    const req = http.expectOne('/api/entities/m1');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({
      document: bodyOf(editor.document()),
      version: 3,
      tags: ['deity', 'ruined'],
    });

    const saved: EntityDetail = {
      ...aldermoor,
      version: 4,
      tags: ['deity', 'ruined'],
      document: bodyOf(editor.document()),
    };
    req.flush(saved);
    expect(session.current()?.tags).toEqual(['deity', 'ruined']);
  });

  it('surfaces a stale save as a conflict and keeps the editor edit', () => {
    openAldermoor();
    editor.paintAt({ q: 5, r: 5 }, 'ocean');
    const edited = editor.document();

    const serverCurrent: EntityDetail = {
      ...aldermoor,
      version: 7,
      document: bodyOf(desertAt99),
    };

    let outcome: unknown;
    session.save().subscribe((o) => (outcome = o));
    http
      .expectOne('/api/entities/m1')
      .flush(serverCurrent, { status: 409, statusText: 'Conflict' });

    expect(outcome).toEqual({ status: 'conflict', current: serverCurrent });
    expect(session.conflict()).toEqual(serverCurrent);
    // The in-progress edit is not lost — it stays in the editor for the re-pull.
    expect(editor.document()).toEqual(edited);
  });

  it('re-pulls the server version on reload, replacing the edit and clearing the conflict', () => {
    openAldermoor();
    editor.paintAt({ q: 5, r: 5 }, 'ocean');

    const serverCurrent: EntityDetail = {
      ...aldermoor,
      version: 7,
      document: bodyOf(desertAt99),
    };
    session.save().subscribe();
    http
      .expectOne('/api/entities/m1')
      .flush(serverCurrent, { status: 409, statusText: 'Conflict' });

    session.reload().subscribe();
    http.expectOne('/api/entities/m1').flush(serverCurrent);

    expect(editor.document()).toEqual(desertAt99);
    expect(session.conflict()).toBeNull();
  });

  it('renames the open entity', () => {
    openAldermoor();

    session.rename('The Whisperwood').subscribe();

    const req = http.expectOne('/api/entities/m1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ name: 'The Whisperwood' });
    req.flush({ ...aldermoor, name: 'The Whisperwood' });

    expect(session.current()?.name).toBe('The Whisperwood');
  });

  it('re-fetches on openRoute even when the same entity is already open', () => {
    openAldermoor();

    // Re-entering the route (e.g. reopened from the library after an in-library
    // rename) must fetch the server's current Entity, not trust a retained
    // `current` — the route-scoped session can outlive a trip to the library (#70).
    let opened: EntityDetail | undefined;
    session.openRoute('m1').subscribe((m) => (opened = m));

    const renamed: EntityDetail = { ...aldermoor, name: 'Lady Mara' };
    http.expectOne('/api/entities/m1').flush(renamed);
    expect(opened).toEqual(renamed);
    expect(session.current()?.name).toBe('Lady Mara');
  });

  it('clears the canvas then fetches when openRoute targets a different entity', () => {
    openAldermoor();
    editor.paintAt({ q: 5, r: 5 }, 'ocean');

    session.openRoute('m2').subscribe();
    // The previous map's canvas is cleared to empty while the load is in flight.
    expect(editor.document()).toEqual({ hexes: {}, regions: [], labels: [] });

    const other: EntityDetail = { ...aldermoor, id: 'm2', document: bodyOf(forestAt00) };
    http.expectOne('/api/entities/m2').flush(other);
    expect(editor.document()).toEqual(forestAt00);
  });

  it('saves a non-hexmap entity without coercing it into a hexmap (no data loss)', () => {
    // A note opened through this seam must save back as a note — the editor's
    // empty grid must not overwrite it with a blank hexmap body.
    const noteBody = { type: 'note' as const, content };
    const note: EntityDetail = {
      ...aldermoor,
      id: 'n1',
      type: 'note',
      document: noteBody,
    };
    session.open('n1').subscribe();
    http.expectOne('/api/entities/n1').flush(note);

    session.save().subscribe();

    const req = http.expectOne('/api/entities/n1');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ document: noteBody, version: 3, tags: [] });
    req.flush({ ...note, version: 4 });
  });

  it('saves a note’s edited Content opaquely, round-tripping the snapshot untouched', () => {
    const noteBody = { type: 'note' as const, content };
    const note: EntityDetail = {
      ...aldermoor,
      id: 'n1',
      type: 'note',
      document: noteBody,
    };
    session.open('n1').subscribe();
    http.expectOne('/api/entities/n1').flush(note);

    const snapshot = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Lady Mara rules the north.' }],
        },
      ],
    };
    session.setContent(snapshot);

    session.save().subscribe();

    const req = http.expectOne('/api/entities/n1');
    expect(req.request.method).toBe('PUT');
    // Snapshot wrapped in format envelope, never parsed (ADR-0019).
    expect(req.request.body).toEqual({
      document: { type: 'note', content: { format: CONTENT_FORMAT, snapshot } },
      version: 3,
      tags: [],
    });
    req.flush({ ...note, version: 4 });
  });

  it('does not save or rename while a route load is in flight (mid-navigation)', () => {
    openAldermoor(); // current = m1, not loading
    editor.paintAt({ q: 5, r: 5 }, 'ocean');

    // load in flight for m2, current still m1
    session.openRoute('m2').subscribe();

    // A late Save/rename from the outgoing header is inert — neither writes to
    // the m1 the user navigated away from (#4, #70).
    session.save().subscribe();
    session.rename('Nope').subscribe();
    http.expectNone('/api/entities/m1');
    expect(session.saving()).toBe(false);

    // The pending load still resolves normally.
    http
      .expectOne('/api/entities/m2')
      .flush({ ...aldermoor, id: 'm2', document: bodyOf(forestAt00) });
  });

  it('is a safe no-op with no entity open (no request, no throw)', () => {
    // Save/rename/reload before any entity is opened must not hit the server or
    // throw out of a handler-less subscribe.
    expect(() => session.save().subscribe()).not.toThrow();
    expect(() => session.rename('whatever').subscribe()).not.toThrow();
    expect(() => session.reload().subscribe()).not.toThrow();

    http.expectNone('/api/entities/m1');
    // `_saving` was never flipped, so the Save button can't stick on "Saving…".
    expect(session.saving()).toBe(false);
  });
});

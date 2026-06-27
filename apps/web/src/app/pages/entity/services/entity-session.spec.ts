import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { createEnvironmentInjector, EnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
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
    // In-progress edit survives in the editor for the re-pull.
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

  it('is not dirty on open, and dirty after a grid edit', () => {
    openAldermoor();
    expect(session.dirty()).toBe(false);

    editor.paintAt({ q: 5, r: 5 }, 'ocean');
    expect(session.dirty()).toBe(true);
  });

  it('clears dirty on a clean save', () => {
    openAldermoor();
    editor.paintAt({ q: 5, r: 5 }, 'ocean');
    expect(session.dirty()).toBe(true);

    session.save().subscribe();
    http
      .expectOne('/api/entities/m1')
      .flush({ ...aldermoor, version: 4, document: bodyOf(editor.document()) });

    expect(session.dirty()).toBe(false);
  });

  it('keeps a mid-flight Content edit dirty across a clean save (linchpin, ADR-0026)', () => {
    openAldermoor();
    const first = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }],
    };
    session.setContent(first);

    // Save captures `first`, then the user keeps typing before the response lands.
    session.save().subscribe();
    const second = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'second' }] }],
    };
    session.setContent(second);

    http.expectOne('/api/entities/m1').flush({ ...aldermoor, version: 4 });

    // Baseline advanced to the sent `first`, not the live `second`, so the
    // mid-flight keystrokes are still pending — not silently dropped.
    expect(session.dirty()).toBe(true);
  });

  describe('autosave scheduler', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    /** Flush Angular effects, then fire any debounce timer due within `ms`. */
    function settle(ms = 800) {
      TestBed.tick();
      vi.advanceTimersByTime(ms);
    }

    it('autosaves a debounced PUT after an edit', () => {
      openAldermoor();
      editor.paintAt({ q: 5, r: 5 }, 'ocean');

      TestBed.tick();
      vi.advanceTimersByTime(799);
      http.expectNone('/api/entities/m1'); // not yet

      vi.advanceTimersByTime(1);
      const req = http.expectOne('/api/entities/m1');
      expect(req.request.method).toBe('PUT');
      req.flush({ ...aldermoor, version: 4, document: bodyOf(editor.document()) });

      settle(); // let the post-save effect settle (no follow-up save)
      http.expectNone('/api/entities/m1');
    });

    it('flushes a pending edit on destroy (route leave), best-effort', () => {
      // A fresh session in a child injector we can destroy with the HTTP controller
      // still alive — modelling navigation away mid-debounce.
      const parent = TestBed.inject(EnvironmentInjector);
      const child = createEnvironmentInjector([EntitySession, HexMapStore], parent);
      const leaving = child.get(EntitySession);
      const leavingEditor = child.get(HexMapStore);

      leaving.open('m1').subscribe();
      http.expectOne('/api/entities/m1').flush(aldermoor);
      leavingEditor.paintAt({ q: 5, r: 5 }, 'ocean'); // dirty, debounce not yet elapsed
      expect(leaving.dirty()).toBe(true);

      child.destroy();

      const req = http.expectOne('/api/entities/m1');
      expect(req.request.method).toBe('PUT');
      req.flush({ ...aldermoor, version: 4 });
    });

    it('does not flush on destroy when nothing is dirty', () => {
      const parent = TestBed.inject(EnvironmentInjector);
      const child = createEnvironmentInjector([EntitySession, HexMapStore], parent);
      const leaving = child.get(EntitySession);

      leaving.open('m1').subscribe();
      http.expectOne('/api/entities/m1').flush(aldermoor);

      child.destroy();
      http.expectNone('/api/entities/m1');
    });

    it('coalesces edits during an in-flight save into one follow-up save', () => {
      openAldermoor();
      editor.paintAt({ q: 5, r: 5 }, 'ocean');
      settle();
      const first = http.expectOne('/api/entities/m1'); // in flight, version 3

      // Edit while the save is in flight: no second save starts (single-flight).
      editor.paintAt({ q: 6, r: 6 }, 'forest');
      settle();
      http.expectNone('/api/entities/m1');

      first.flush({ ...aldermoor, version: 4, document: bodyOf(editor.document()) });

      // Exactly one coalesced follow-up, under the advanced version, carrying both edits.
      settle();
      const second = http.expectOne('/api/entities/m1');
      expect(second.request.body).toEqual(
        expect.objectContaining({ version: 4 }),
      );
      second.flush({ ...aldermoor, version: 5, document: bodyOf(editor.document()) });

      settle();
      http.expectNone('/api/entities/m1');
    });

    it('resets the debounce on each edit, saving only after the last (trailing)', () => {
      openAldermoor();
      editor.paintAt({ q: 5, r: 5 }, 'ocean');
      TestBed.tick();
      vi.advanceTimersByTime(500);

      editor.paintAt({ q: 6, r: 6 }, 'forest'); // re-arms the window
      TestBed.tick();
      vi.advanceTimersByTime(500); // 500ms since the last edit — still quiet
      http.expectNone('/api/entities/m1');

      vi.advanceTimersByTime(300); // 800ms since the last edit
      http
        .expectOne('/api/entities/m1')
        .flush({ ...aldermoor, version: 4, document: bodyOf(editor.document()) });
    });

    it('pauses autosave while a conflict is unresolved', () => {
      openAldermoor();
      editor.paintAt({ q: 5, r: 5 }, 'ocean');
      settle();
      http
        .expectOne('/api/entities/m1')
        .flush({ ...aldermoor, version: 7, document: bodyOf(desertAt99) }, {
          status: 409,
          statusText: 'Conflict',
        });
      expect(session.conflict()).not.toBeNull();

      // Further edits accumulate but must not loop the stale base version.
      editor.paintAt({ q: 6, r: 6 }, 'forest');
      settle();
      http.expectNone('/api/entities/m1');
      expect(session.dirty()).toBe(true);
    });

    it('resumes autosave after a conflict is resolved by reload', () => {
      openAldermoor();
      editor.paintAt({ q: 5, r: 5 }, 'ocean');
      settle();
      http
        .expectOne('/api/entities/m1')
        .flush({ ...aldermoor, version: 7, document: bodyOf(desertAt99) }, {
          status: 409,
          statusText: 'Conflict',
        });

      session.reload().subscribe();
      http
        .expectOne('/api/entities/m1')
        .flush({ ...aldermoor, version: 7, document: bodyOf(desertAt99) });
      expect(session.conflict()).toBeNull();

      // A fresh edit autosaves again under the reloaded version.
      editor.paintAt({ q: 1, r: 1 }, 'ocean');
      settle();
      const req = http.expectOne('/api/entities/m1');
      expect(req.request.body).toEqual(
        expect.objectContaining({ version: 7 }),
      );
      req.flush({ ...aldermoor, version: 8, document: bodyOf(editor.document()) });
    });
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

    // Re-entering the route must re-fetch, not trust a retained `current`: the
    // route-scoped session outlives a trip to the library (e.g. in-library rename) (#70).
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
    // Previous canvas cleared while the load is in flight.
    expect(editor.document()).toEqual({ hexes: {}, regions: [], labels: [] });

    const other: EntityDetail = { ...aldermoor, id: 'm2', document: bodyOf(forestAt00) };
    http.expectOne('/api/entities/m2').flush(other);
    expect(editor.document()).toEqual(forestAt00);
  });

  it('saves a non-hexmap entity without coercing it into a hexmap (no data loss)', () => {
    // A note must save back as a note; the editor's empty grid must not
    // overwrite it with a blank hexmap body.
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

  it('rides a hexmap’s edited Content alongside its grid on save (#75)', () => {
    openAldermoor();
    // Both surfaces edited: a hex painted on the grid and the Note view's prose.
    editor.paintAt({ q: 5, r: 5 }, 'ocean');
    const snapshot = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'The reach lies north.' }],
        },
      ],
    };
    session.setContent(snapshot);

    session.save().subscribe();

    const req = http.expectOne('/api/entities/m1');
    expect(req.request.method).toBe('PUT');
    // Body carries both edits; neither surface drops the other's (ADR-0019).
    expect(req.request.body).toEqual({
      document: {
        type: 'hexmap',
        content: { format: CONTENT_FORMAT, snapshot },
        ...editor.document(),
      },
      version: 3,
      tags: [],
    });
    req.flush({ ...aldermoor, version: 4 });
  });

  it('does not save or rename while a route load is in flight (mid-navigation)', () => {
    openAldermoor(); // current = m1, not loading
    editor.paintAt({ q: 5, r: 5 }, 'ocean');

    // load in flight for m2, current still m1
    session.openRoute('m2').subscribe();

    // A late Save/rename from the outgoing header must not write to the m1 the
    // user navigated away from (#4, #70).
    session.save().subscribe();
    session.rename('Nope').subscribe();
    http.expectNone('/api/entities/m1');
    expect(session.saving()).toBe(false);

    // The pending load still resolves normally.
    http
      .expectOne('/api/entities/m2')
      .flush({ ...aldermoor, id: 'm2', document: bodyOf(forestAt00) });
  });

  it('restores the editor view from the ?view query param on load (#75)', () => {
    // A shared link with ?view=note lands on the Note view. No id param → no fetch.
    session.watchRoute({
      paramMap: of(convertToParamMap({})),
      queryParamMap: of(convertToParamMap({ view: 'note' })),
    } as unknown as ActivatedRoute);

    expect(editor.view()).toBe('note');
  });

  it('opens on the Map view when the URL carries no view param (#75)', () => {
    editor.setView('note'); // a stale view from a previously open Entity

    session.watchRoute({
      paramMap: of(convertToParamMap({})),
      queryParamMap: of(convertToParamMap({})),
    } as unknown as ActivatedRoute);

    expect(editor.view()).toBe('map');
  });

  it('warns on tab close (beforeunload) only when there are unsaved edits', () => {
    openAldermoor();

    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    editor.paintAt({ q: 5, r: 5 }, 'ocean');
    const dirty = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });

  it('flushes a save immediately on Cmd/Ctrl+S, bypassing the debounce', () => {
    openAldermoor();
    editor.paintAt({ q: 5, r: 5 }, 'ocean');

    const event = new KeyboardEvent('keydown', {
      key: 's',
      metaKey: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true); // suppresses the browser "save page" dialog
    const req = http.expectOne('/api/entities/m1');
    expect(req.request.method).toBe('PUT');
    req.flush({ ...aldermoor, version: 4, document: bodyOf(editor.document()) });
  });

  it('is a safe no-op with no entity open (no request, no throw)', () => {
    // Save/rename/reload before any open must not hit the server or throw out
    // of a handler-less subscribe.
    expect(() => session.save().subscribe()).not.toThrow();
    expect(() => session.rename('whatever').subscribe()).not.toThrow();
    expect(() => session.reload().subscribe()).not.toThrow();

    http.expectNone('/api/entities/m1');
    // `_saving` was never flipped, so the Save button can't stick on "Saving…".
    expect(session.saving()).toBe(false);
  });
});

import { provideTranslocoTesting } from '../../../../testing/transloco-testing';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, Subject, throwError } from 'rxjs';
import { CONTENT_FORMAT, CORE_NOTE, emptyContent, EntityDetail, EntitySaveOutcome } from '@hexly/domain';
import { coordKey, CORE_HEXMAP, emptyHexMap, HEX_GRID_FIELD, HexMap } from '@hexly/plugin-hexmap';
import { MockEntitiesClient, MockNudgeBusClient } from '@hexly/web-core/testing';
import { EntitiesClient, NudgeBusClient, EVICTED, Watched } from '@hexly/web-core';
import { EntitySession } from './entity-session';
import { ENTITY_SESSION, VIEW_FIELD_KEY } from '@hexly/web-entity';
import { providePluginHexmap } from '@hexly/plugin-hexmap/web';
import { HexMapStore } from '@hexly/plugin-hexmap/testing';

describe('EntitySession', () => {
  let session: EntitySession;
  let editor: HexMapStore;
  let entities: MockEntitiesClient;
  let bus: MockNudgeBusClient;

  const content = emptyContent();
  /** Wrap a hex grid into the hexmap body the store carries end to end: its `grid` Field value. */
  const bodyOf = (grid: HexMap) => ({ content, metadata: { grid } });

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
    worldId: 'w1',
    name: 'Aldermoor',
    types: [CORE_HEXMAP],
    tags: [],
    visibility: 'private',
    version: 3,
    seq: 1,
    createdAt: 1,
    updatedAt: 1,
    // The default opener is an Owner — full Rights (ADR-0039), so writable and manageable.
    rights: ['read', 'edit', 'delete', 'set-visibility', 'manage'],
    document: bodyOf(forestAt00),
  };

  /** The server computes Rights only on read — save/patch responses omit them (ADR-0039). */
  const stripRights = ({ rights: _rights, ...rest }: EntityDetail): EntityDetail => rest;

  beforeEach(() => {
    entities = new MockEntitiesClient();
    bus = new MockNudgeBusClient();
    TestBed.configureTestingModule({
      imports: [provideTranslocoTesting()],
      providers: [
        providePluginHexmap(),
        EntitySession,
        // The session is the central store; HexMapStore edits it through the ENTITY_SESSION
        // token, as the app's composition root wires it (ADR-0048).
        { provide: ENTITY_SESSION, useExisting: EntitySession },
        HexMapStore,
        // Which grid the store edits is the page's to say (#200); here, `core.hexmap`'s own.
        { provide: VIEW_FIELD_KEY, useValue: HEX_GRID_FIELD.key },
        { provide: EntitiesClient, useValue: entities },
        { provide: NudgeBusClient, useValue: bus },
      ],
    });
    session = TestBed.inject(EntitySession);
    editor = TestBed.inject(HexMapStore);
  });

  it('opens an entity by id and loads its hex grid into the editor', () => {
    entities.load.mockReturnValue(of(aldermoor));
    session.open('m1').subscribe();

    // The editor sees the bare grid, not the body — the seam unwraps it.
    expect(editor.document()).toEqual(forestAt00);
  });

  /** Open Aldermoor (version 3) so save/conflict tests have an open entity. */
  function openAldermoor() {
    entities.load.mockReturnValue(of(aldermoor));
    session.open('m1').subscribe();
  }

  it('saves the editor grid, re-wrapped under the open entity base version', () => {
    openAldermoor();
    editor.paintAt({ q: 5, r: 5 }, 'ocean');

    const saved: EntityDetail = {
      ...aldermoor,
      version: 4,
      document: bodyOf(editor.document()),
    };
    entities.save.mockReturnValue(of({ status: 'saved', entity: saved }));

    let outcome: unknown;
    session.save().subscribe((o) => (outcome = o));

    // Content preserved untouched.
    expect(entities.save).toHaveBeenCalledWith('m1', bodyOf(editor.document()), 3, []);
    expect(outcome).toEqual({ status: 'saved', entity: saved });
  });

  it('seeds the open entity’s tags and sends edited tags with the save (#72)', () => {
    openAldermoor();
    expect(session.tags()).toEqual([]);

    session.setTags(['deity', 'ruined']);
    expect(session.tags()).toEqual(['deity', 'ruined']);

    const saved: EntityDetail = {
      ...aldermoor,
      version: 4,
      tags: ['deity', 'ruined'],
      document: bodyOf(editor.document()),
    };
    entities.save.mockReturnValue(of({ status: 'saved', entity: saved }));
    session.save().subscribe();

    expect(entities.save).toHaveBeenCalledWith('m1', bodyOf(editor.document()), 3, ['deity', 'ruined']);
    expect(session.current()?.tags).toEqual(['deity', 'ruined']);
  });

  it('seeds the open entity’s types and sends an authored type set with the save (#189)', () => {
    openAldermoor(); // types: [core.hexmap]
    expect(session.types()).toEqual([CORE_HEXMAP]);
    expect(session.dirty()).toBe(false);

    // Reorder to re-primary the note, and add nothing new — a pure type-set edit.
    session.setTypes([CORE_NOTE, CORE_HEXMAP]);
    expect(session.types()).toEqual([CORE_NOTE, CORE_HEXMAP]);
    expect(session.dirty()).toBe(true);

    const saved: EntityDetail = {
      ...aldermoor,
      version: 4,
      types: [CORE_NOTE, CORE_HEXMAP],
      document: bodyOf(editor.document()),
    };
    entities.save.mockReturnValue(of({ status: 'saved', entity: saved }));
    session.save().subscribe();

    // The type set rides the save as the 5th arg — an active typed edit the server gates.
    expect(entities.save).toHaveBeenCalledWith('m1', bodyOf(editor.document()), 3, [], [CORE_NOTE, CORE_HEXMAP]);
    expect(session.current()?.types).toEqual([CORE_NOTE, CORE_HEXMAP]);
    expect(session.dirty()).toBe(false);
  });

  it('mints the grid Field’s empty plane when core.hexmap is added to a note (#189)', () => {
    const noteBody = { content };
    const note: EntityDetail = { ...aldermoor, id: 'n1', types: [CORE_NOTE], document: noteBody };
    entities.load.mockReturnValue(of(note));
    session.open('n1').subscribe();
    expect(session.body()).toEqual(noteBody);

    session.setTypes([CORE_NOTE, CORE_HEXMAP]);

    // The body gained an empty grid so the map View has a plane to render; Content is preserved.
    expect(session.body()).toEqual({ ...noteBody, metadata: { grid: emptyHexMap() } });
    expect(session.dirty()).toBe(true);
  });

  it('never sends types on a plain body edit — data at rest is not re-typed (#189)', () => {
    openAldermoor();
    editor.paintAt({ q: 5, r: 5 }, 'ocean'); // body edit, no type change

    entities.save.mockReturnValue(of({ status: 'saved', entity: { ...aldermoor, version: 4 } }));
    session.save().subscribe();

    // Four args: the type set is omitted, so the server leaves the stored types untouched.
    expect(entities.save).toHaveBeenCalledWith('m1', expect.anything(), 3, []);
    expect(entities.save.mock.calls[0]).toHaveLength(4);
  });

  it('preserves the caller’s load-time Rights across a save (ADR-0039)', () => {
    // Load carries the Owner's Rights; the server's save response omits them. A content
    // save mustn't drop the caller's standing — else Share vanishes after autosave.
    entities.load.mockReturnValue(of(aldermoor));
    session.open('m1').subscribe();
    editor.paintAt({ q: 5, r: 5 }, 'ocean');

    const saved = stripRights({
      ...aldermoor,
      version: 4,
      document: bodyOf(editor.document()),
    });
    entities.save.mockReturnValue(of({ status: 'saved', entity: saved }));
    session.save().subscribe();

    expect(session.current()?.rights).toContain('manage');
    expect(session.manageable()).toBe(true);
    expect(session.writable()).toBe(true);
  });

  it('preserves the caller’s Rights across a rename/visibility patch (ADR-0039)', () => {
    entities.load.mockReturnValue(of(aldermoor));
    session.open('m1').subscribe();

    // The PATCH response (like the server's) carries no Rights.
    entities.patch.mockReturnValue(of(stripRights({ ...aldermoor, name: 'Renamed' })));
    session.rename('Renamed').subscribe();

    expect(session.current()?.name).toBe('Renamed');
    expect(session.manageable()).toBe(true);
    expect(session.writable()).toBe(true);
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
    entities.save.mockReturnValue(of({ status: 'conflict', current: serverCurrent }));

    let outcome: unknown;
    session.save().subscribe((o) => (outcome = o));

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
    entities.save.mockReturnValue(of({ status: 'conflict', current: serverCurrent }));
    session.save().subscribe();

    entities.load.mockReturnValue(of(serverCurrent));
    session.reload().subscribe();

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
    session.save().subscribe();

    expect(session.dirty()).toBe(false);
  });

  it('stays clean when a re-wrapped value-equal snapshot is pushed on load (#164)', () => {
    // TipTap fires an `update` on load/normalization; the editor re-pushes the loaded
    // snapshot through setContent, which mints a new Content each call. A value-equal push
    // must collapse to the baseline reference — else reference-equality dirty trips an
    // autosave PUT with no user edit.
    openAldermoor();
    session.setContent({ type: 'doc', content: [] }); // same value as the loaded content
    expect(session.dirty()).toBe(false);

    session.setContent({ type: 'doc', content: [{ type: 'paragraph' }] }); // a real edit
    expect(session.dirty()).toBe(true);
  });

  it('keeps a mid-flight Content edit dirty across a clean save (linchpin, ADR-0026)', () => {
    openAldermoor();
    const first = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }],
    };
    session.setContent(first);

    // Save captures `first`, then the user keeps typing before the response lands.
    const save$ = new Subject<EntitySaveOutcome>();
    entities.save.mockReturnValue(save$);
    session.save().subscribe();
    const second = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'second' }] }],
    };
    session.setContent(second);

    save$.next({ status: 'saved', entity: { ...aldermoor, version: 4 } });
    save$.complete();

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

      TestBed.tick();
      vi.advanceTimersByTime(799);
      expect(entities.save).not.toHaveBeenCalled(); // not yet

      vi.advanceTimersByTime(1);
      expect(entities.save).toHaveBeenCalledWith('m1', expect.anything(), 3, []);

      settle(); // let the post-save effect settle (no follow-up save)
      expect(entities.save).toHaveBeenCalledTimes(1);
    });

    it('never autosaves a read-only entity (no edit Right)', () => {
      entities.load.mockReturnValue(of({ ...aldermoor, rights: ['read'] }));
      session.open('m1').subscribe();

      // An edit would arm the scheduler for a writable entity; here every debounce is a no-op.
      session.setContent({ type: 'doc', content: [{ type: 'paragraph' }] });
      settle();
      settle();

      expect(entities.save).not.toHaveBeenCalled();
    });

    it('flush() persists a pending edit on leave, completing when it lands', () => {
      openAldermoor();
      editor.paintAt({ q: 5, r: 5 }, 'ocean'); // dirty, debounce not yet elapsed
      expect(session.dirty()).toBe(true);

      entities.save.mockReturnValue(of({ status: 'saved', entity: { ...aldermoor, version: 4 } }));
      let done = false;
      session.flush().subscribe({ complete: () => (done = true) });

      expect(entities.save).toHaveBeenCalled();
      expect(done).toBe(true);
      expect(session.dirty()).toBe(false);
    });

    it('flush() is a no-op (completes, no request) when nothing is dirty', () => {
      openAldermoor();

      let done = false;
      session.flush().subscribe({ complete: () => (done = true) });

      expect(entities.save).not.toHaveBeenCalled();
      expect(done).toBe(true);
    });

    it('coalesces edits during an in-flight save into one follow-up save', () => {
      openAldermoor();
      editor.paintAt({ q: 5, r: 5 }, 'ocean');
      const first$ = new Subject<EntitySaveOutcome>();
      entities.save.mockReturnValueOnce(first$);
      settle();
      expect(entities.save).toHaveBeenCalledTimes(1); // in flight, version 3

      // Edit while the save is in flight: no second save starts (single-flight).
      editor.paintAt({ q: 6, r: 6 }, 'forest');
      settle();
      expect(entities.save).toHaveBeenCalledTimes(1);

      const second$ = new Subject<EntitySaveOutcome>();
      entities.save.mockReturnValueOnce(second$);
      first$.next({
        status: 'saved',
        entity: {
          ...aldermoor,
          version: 4,
          document: bodyOf(editor.document()),
        },
      });
      first$.complete();

      // Exactly one coalesced follow-up, under the advanced version, carrying both edits.
      settle();
      expect(entities.save).toHaveBeenCalledTimes(2);
      expect(entities.save.mock.calls[1][2]).toBe(4);

      second$.next({
        status: 'saved',
        entity: {
          ...aldermoor,
          version: 5,
          document: bodyOf(editor.document()),
        },
      });
      second$.complete();

      settle();
      expect(entities.save).toHaveBeenCalledTimes(2);
    });

    it('resets the debounce on each edit, saving only after the last (trailing)', () => {
      openAldermoor();
      editor.paintAt({ q: 5, r: 5 }, 'ocean');
      TestBed.tick();
      vi.advanceTimersByTime(500);

      editor.paintAt({ q: 6, r: 6 }, 'forest'); // re-arms the window
      TestBed.tick();
      vi.advanceTimersByTime(500); // 500ms since the last edit — still quiet
      expect(entities.save).not.toHaveBeenCalled();

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
      vi.advanceTimersByTime(300); // 800ms since the last edit
      expect(entities.save).toHaveBeenCalled();
    });

    it('pauses autosave while a conflict is unresolved', () => {
      openAldermoor();
      editor.paintAt({ q: 5, r: 5 }, 'ocean');
      entities.save.mockReturnValue(
        of({
          status: 'conflict',
          current: { ...aldermoor, version: 7, document: bodyOf(desertAt99) },
        }),
      );
      settle();
      expect(session.conflict()).not.toBeNull();

      // Further edits accumulate but must not loop the stale base version.
      editor.paintAt({ q: 6, r: 6 }, 'forest');
      settle();
      expect(entities.save).toHaveBeenCalledTimes(1);
      expect(session.dirty()).toBe(true);
    });

    it('resumes autosave after a conflict is resolved by reload', () => {
      openAldermoor();
      editor.paintAt({ q: 5, r: 5 }, 'ocean');
      const serverCurrent: EntityDetail = {
        ...aldermoor,
        version: 7,
        document: bodyOf(desertAt99),
      };
      entities.save.mockReturnValue(of({ status: 'conflict', current: serverCurrent }));
      settle();

      entities.load.mockReturnValue(of(serverCurrent));
      session.reload().subscribe();
      expect(session.conflict()).toBeNull();

      // A fresh edit autosaves again under the reloaded version.
      entities.save.mockReturnValue(
        of({
          status: 'saved',
          entity: {
            ...aldermoor,
            version: 8,
            document: bodyOf(editor.document()),
          },
        }),
      );
      editor.paintAt({ q: 1, r: 1 }, 'ocean');
      settle();
      expect(entities.save).toHaveBeenCalledTimes(2);
      expect(entities.save.mock.calls[1][2]).toBe(7);
    });

    it('pauses autosave after a failed save until the next edit (no retry loop)', () => {
      openAldermoor();
      editor.paintAt({ q: 5, r: 5 }, 'ocean');
      // The save fails; the edit stays dirty (baseline isn't advanced).
      entities.save.mockReturnValue(throwError(() => new Error('boom')));
      settle();
      expect(session.error()).toBe('save');
      expect(session.dirty()).toBe(true);

      // The scheduler must not re-fire the same failing PUT every 800ms.
      settle();
      settle();
      expect(entities.save).toHaveBeenCalledTimes(1);

      // A fresh edit lifts the pause and autosave resumes.
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
      editor.paintAt({ q: 6, r: 6 }, 'forest');
      settle();
      expect(entities.save).toHaveBeenCalledTimes(2);
    });

    it('flush() is a no-op while a conflict is unresolved (no stale re-PUT)', () => {
      openAldermoor();
      editor.paintAt({ q: 5, r: 5 }, 'ocean');
      entities.save.mockReturnValue(
        of({
          status: 'conflict',
          current: { ...aldermoor, version: 7, document: bodyOf(desertAt99) },
        }),
      );
      session.save().subscribe();
      expect(session.conflict()).not.toBeNull();

      // Leaving with the conflict unresolved must not re-send the stale base version.
      let done = false;
      session.flush().subscribe({ complete: () => (done = true) });
      expect(entities.save).toHaveBeenCalledTimes(1);
      expect(done).toBe(true);
    });

    it('flush() waits out an in-flight save, then sends the latest edit (ADR-0026)', () => {
      openAldermoor();
      editor.paintAt({ q: 5, r: 5 }, 'ocean');
      const first$ = new Subject<EntitySaveOutcome>();
      entities.save.mockReturnValueOnce(first$);
      session.save().subscribe();
      expect(entities.save).toHaveBeenCalledTimes(1); // in flight, snapshot = ocean

      // The user types more after the PUT started, then leaves before it returns.
      editor.paintAt({ q: 6, r: 6 }, 'forest');
      let done = false;
      session.flush().subscribe({ complete: () => (done = true) });
      TestBed.tick(); // let the in-flight wait observe saving === true
      expect(entities.save).toHaveBeenCalledTimes(1); // single-flight: no second save yet

      // The first save settles and advances the version...
      const second$ = new Subject<EntitySaveOutcome>();
      entities.save.mockReturnValueOnce(second$);
      first$.next({
        status: 'saved',
        entity: { ...aldermoor, version: 4, document: bodyOf(desertAt99) },
      });
      first$.complete();
      TestBed.tick(); // ...the wait sees saving flip false and sends the follow-up
      expect(entities.save).toHaveBeenCalledTimes(2);
      expect(entities.save.mock.calls[1][2]).toBe(4);
      second$.next({ status: 'saved', entity: { ...aldermoor, version: 5 } });
      second$.complete();
      expect(done).toBe(true);
    });
  });

  it('renames the open entity', () => {
    openAldermoor();

    entities.patch.mockReturnValue(of({ ...aldermoor, name: 'The Whisperwood' }));
    session.rename('The Whisperwood').subscribe();

    expect(entities.patch).toHaveBeenCalledWith('m1', {
      name: 'The Whisperwood',
    });
    expect(session.current()?.name).toBe('The Whisperwood');
  });

  it('flips the open entity’s visibility (ADR-0037, #160)', () => {
    openAldermoor();

    entities.patch.mockReturnValue(of({ ...aldermoor, visibility: 'shared' }));
    session.setVisibility('shared').subscribe();

    expect(entities.patch).toHaveBeenCalledWith('m1', { visibility: 'shared' });
    expect(session.current()?.visibility).toBe('shared');
  });

  it('treats an entity with no edit Right as read-only and never attempts a save', () => {
    // A read-only World member opens a shared entity. Even an edit + explicit save
    // (Cmd/Ctrl+S) must not fire a PUT — the root of the permanent save-failed banner.
    entities.load.mockReturnValue(of({ ...aldermoor, rights: ['read'] }));
    session.open('m1').subscribe();
    expect(session.writable()).toBe(false);

    session.setContent({ type: 'doc', content: [{ type: 'paragraph' }] });
    session.save(true).subscribe();

    expect(entities.save).not.toHaveBeenCalled();
  });

  it('surfaces a 403 save as a terminal read-only state, not the retryable save error', () => {
    openAldermoor(); // Owner Rights → writable, so the save is actually attempted
    editor.paintAt({ q: 5, r: 5 }, 'ocean');
    entities.save.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403 })));

    session.save().subscribe();

    // Read-only, not the generic 'save' banner (which offers a Retry the user can't clear).
    expect(session.error()).toBe('readonly');
  });

  it('re-fetches on openRoute even when the same entity is already open', () => {
    openAldermoor();

    // Re-entering the route must re-fetch, not trust a retained `current`: the
    // route-scoped session outlives a trip to the library (e.g. in-library rename) (#70).
    const renamed: EntityDetail = { ...aldermoor, name: 'Lady Mara' };
    entities.load.mockReturnValue(of(renamed));

    let opened: EntityDetail | undefined;
    session.openRoute('m1').subscribe((m) => (opened = m));

    expect(opened).toEqual(renamed);
    expect(session.current()?.name).toBe('Lady Mara');
  });

  it('flushes the dirty previous entity, then clears and fetches the new one (ADR-0026)', () => {
    openAldermoor();
    editor.paintAt({ q: 5, r: 5 }, 'ocean'); // m1 now dirty

    entities.save.mockReturnValue(of({ status: 'saved', entity: { ...aldermoor, version: 4 } }));
    const load$ = new Subject<EntityDetail>();
    entities.load.mockReturnValue(load$);

    // openRoute awaits the flush of m1's pending edit before clearing its canvas — an
    // in-app swap reuses this session, so the edit must land while the live signals still
    // hold it; the m2 load only starts once the flush PUT resolves.
    session.openRoute('m2').subscribe();
    expect(entities.save).toHaveBeenCalledWith('m1', expect.anything(), 3, []);

    // Previous canvas cleared while the load is in flight — and re-baselined, so this
    // empty placeholder doesn't read as dirty (else a 404 leave would PUT it over m1).
    expect(editor.document()).toEqual({ hexes: {}, regions: [], labels: [] });
    expect(session.dirty()).toBe(false);

    const other: EntityDetail = {
      ...aldermoor,
      id: 'm2',
      document: bodyOf(forestAt00),
    };
    load$.next(other);
    load$.complete();
    expect(editor.document()).toEqual(forestAt00);
  });

  it('saves a non-hexmap entity without coercing it into a hexmap (no data loss)', () => {
    // A note must save back as a note; the editor's empty grid must not
    // overwrite it with a blank hexmap body.
    const noteBody = { content };
    const note: EntityDetail = {
      ...aldermoor,
      id: 'n1',
      types: [CORE_NOTE],
      document: noteBody,
    };
    entities.load.mockReturnValue(of(note));
    session.open('n1').subscribe();

    entities.save.mockReturnValue(of({ status: 'saved', entity: { ...note, version: 4 } }));
    session.save().subscribe();

    expect(entities.save).toHaveBeenCalledWith('n1', noteBody, 3, []);
  });

  it('saves a note’s edited Content opaquely, round-tripping the snapshot untouched', () => {
    const noteBody = { content };
    const note: EntityDetail = {
      ...aldermoor,
      id: 'n1',
      types: [CORE_NOTE],
      document: noteBody,
    };
    entities.load.mockReturnValue(of(note));
    session.open('n1').subscribe();

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

    entities.save.mockReturnValue(of({ status: 'saved', entity: { ...note, version: 4 } }));
    session.save().subscribe();

    // Snapshot wrapped in format envelope, never parsed (ADR-0019).
    expect(entities.save).toHaveBeenCalledWith('n1', { content: { format: CONTENT_FORMAT, snapshot } }, 3, []);
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

    entities.save.mockReturnValue(of({ status: 'saved', entity: { ...aldermoor, version: 4 } }));
    session.save().subscribe();

    // Body carries both edits; neither surface drops the other's (ADR-0019). The grid rides the
    // Metadata map as the `grid` Field's value, beside whatever other Fields the Entity carries.
    expect(entities.save).toHaveBeenCalledWith(
      'm1',
      {
        content: { format: CONTENT_FORMAT, snapshot },
        metadata: { grid: editor.document() },
      },
      3,
      [],
    );
  });

  it('does not save or rename while a route load is in flight (mid-navigation)', () => {
    openAldermoor(); // current = m1, not loading
    editor.paintAt({ q: 5, r: 5 }, 'ocean');

    // Navigating away first flushes m1's pending edit (ADR-0026), then loads m2.
    entities.save.mockReturnValue(of({ status: 'saved', entity: { ...aldermoor, version: 4 } }));
    const load$ = new Subject<EntityDetail>();
    entities.load.mockReturnValue(load$);

    session.openRoute('m2').subscribe();
    expect(session.saving()).toBe(false);

    // A *late* Save/rename from the outgoing header — now that the load is in flight —
    // must not write to the m1 the user navigated away from (#4, #70).
    session.save().subscribe();
    session.rename('Nope').subscribe();
    expect(entities.save).toHaveBeenCalledTimes(1); // only the leave-flush, no late save
    expect(entities.patch).not.toHaveBeenCalled();

    // The pending load still resolves normally.
    load$.next({ ...aldermoor, id: 'm2', document: bodyOf(forestAt00) });
    load$.complete();
  });

  // The `?view=` → active-View sync moved to EntityPage (ADR-0048, Views amendment);
  // its coverage lives in entity.page.spec.ts, driven off the outletted view.

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
    const event = new KeyboardEvent('keydown', {
      key: 's',
      metaKey: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true); // suppresses the browser "save page" dialog
    expect(entities.save).toHaveBeenCalledWith('m1', expect.anything(), 3, []);
  });

  it('is a safe no-op with no entity open (no request, no throw)', () => {
    // Save/rename/reload before any open must not hit the server or throw out
    // of a handler-less subscribe.
    expect(() => session.save().subscribe()).not.toThrow();
    expect(() => session.rename('whatever').subscribe()).not.toThrow();
    expect(() => session.reload().subscribe()).not.toThrow();

    expect(entities.save).not.toHaveBeenCalled();
    expect(entities.patch).not.toHaveBeenCalled();
    expect(entities.load).not.toHaveBeenCalled();
    // `_saving` was never flipped, so the Save button can't stick on "Saving…".
    expect(session.saving()).toBe(false);
  });

  /**
   * Live-follow (ADR-0044): the session reacts to what `EntitiesClient.watch` emits — a fresh detail
   * (adopt if newer and not mid-edit) or `EVICTED` (blank, unless dirty). The follow / debounced
   * refetch / freshness dedup / write-through fanout all live in EntityStore + watchResource (their
   * specs) — here we test only the session's reaction, driving the store's stream directly.
   */
  describe('live-follow', () => {
    let watched: Subject<Watched<EntityDetail>>;

    /** Open Aldermoor (version 3) and settle the reconciler's subscription to entities.watch. */
    function openAndFollow() {
      watched = new Subject<Watched<EntityDetail>>();
      entities.watch.mockReturnValue(watched);
      openAldermoor();
      TestBed.tick(); // toObservable(followedId) subscribes async off the signal
    }

    it('follows the open Entity by id', () => {
      openAndFollow();
      expect(entities.watch).toHaveBeenCalledWith('m1');
    });

    it('adopts a fresh detail newer than held', () => {
      openAndFollow(); // seq 1
      watched.next({ ...aldermoor, seq: 2, version: 4 });
      expect(session.current()?.version).toBe(4);
    });

    /**
     * `seq` is the freshness key (ADR-0045): a rename bumps neither `version` nor — for a grant or
     * a visibility flip — `updatedAt`, so gating on those would silently drop the refetched detail
     * the FollowStore just fetched.
     */
    it('adopts a detail whose seq moved though version and updatedAt did not (a rename)', () => {
      openAndFollow(); // seq 1, version 3, updatedAt 1
      watched.next({ ...aldermoor, seq: 2, name: 'Aldermoor, Renamed' });
      expect(session.current()?.name).toBe('Aldermoor, Renamed');
    });

    /**
     * The bug this gate shipped with: a grant or ownership change bumps `seq` **alone** — the
     * server deliberately leaves `version` and `updatedAt` where they are, so a sharing change
     * can't 409 an in-flight save or reorder "Recently edited". A demoted Editor must lose their
     * Save button on the nudge, not on the next unrelated edit.
     */
    it('adopts a seq-only detail whose rights changed, so a demoted Editor loses `edit`', () => {
      openAndFollow(); // seq 1, full Rights
      expect(session.writable()).toBe(true);

      watched.next({ ...aldermoor, seq: 2, rights: ['read'] });

      expect(session.writable()).toBe(false);
      expect(session.manageable()).toBe(false);
    });

    it('ignores a detail no newer than held — the store fans our own save back at its seq', () => {
      openAndFollow(); // seq 1
      const before = session.current();
      watched.next({ ...aldermoor, seq: 1, version: 99 });
      expect(session.current()).toBe(before); // not re-adopted, so the editor is not re-seeded
    });

    it('does NOT adopt a fresh detail over unsaved edits (clobber guard)', () => {
      openAndFollow();
      editor.paintAt({ q: 5, r: 5 }, 'ocean'); // unsaved edit
      expect(session.dirty()).toBe(true);

      watched.next({ ...aldermoor, seq: 2, version: 4 });
      expect(session.current()?.version).toBe(3); // buffer preserved, access loss meets it at save
    });

    it('blanks the view to an unavailable state on EVICTED (live eviction)', () => {
      openAndFollow();
      watched.next(EVICTED);
      expect(session.current()).toBeNull();
      expect(session.evicted()).toBe(true);
    });

    it('does NOT evict over unsaved edits — access loss surfaces at save time instead', () => {
      openAndFollow();
      editor.paintAt({ q: 5, r: 5 }, 'ocean'); // unsaved edit
      expect(session.dirty()).toBe(true);

      watched.next(EVICTED);

      expect(session.current()).not.toBeNull();
      expect(session.evicted()).toBe(false);
    });

    it('tears the follow down on eviction — a later emission does nothing', () => {
      openAndFollow();
      watched.next(EVICTED);
      TestBed.tick(); // nulling current nulls followedId, so switchMap withdraws the follow

      watched.next({ ...aldermoor, seq: 99 });
      expect(session.current()).toBeNull();
    });

    it('clears the evicted state when a new load starts, so it never masks that load’s real error', () => {
      openAndFollow();
      watched.next(EVICTED);
      expect(session.evicted()).toBe(true);

      // Navigate to another Entity whose load fails: the page must render the load error, not
      // last route's "no longer available".
      entities.load.mockReturnValue(throwError(() => new Error('boom')));
      session.openRoute('n2').subscribe({ error: () => undefined });

      expect(session.evicted()).toBe(false);
    });
  });
});

import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { firstValueFrom, of, Subject, throwError } from 'rxjs';
import {
  CONTENT_FORMAT,
  coordKey,
  emptyContent,
  EntityDetail,
  EntitySaveOutcome,
  HexMap,
} from '@hexly/domain';
import { provideTranslocoTesting } from '../../../core/i18n/transloco-testing';
import { MockEntitiesClient } from '../../../core/testing/mock-entities-client';
import { EntitiesClient } from '../../../core/services/entities.client';
import { EntitySession } from './entity-session';
import { HexMapStore } from './hexmap-store';

/**
 * EntitySession over a mocked {@link EntitiesClient} (#129): the session is the unit
 * under test, the client its facade. A spec drives the outcome the client returns —
 * `saved`, `conflict`, a transport error, or a `Subject` left in flight — and asserts
 * the session's behaviour and the call it made. The client↔TrailBase mapping lives in
 * `entities.client.spec`; the wire never appears here.
 */
describe('EntitySession', () => {
  let session: EntitySession;
  let editor: HexMapStore;
  let entities: MockEntitiesClient;

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
    worldId: 'w1',
    name: 'Aldermoor',
    type: 'hexmap',
    tags: [],
    visibility: 'private',
    version: 3,
    createdAt: 1,
    updatedAt: 1,
    document: bodyOf(forestAt00),
  };
  /** A clean-save outcome carrying the entity at `version`, document defaulting to the live grid. */
  const saved = (version: number, document: unknown = bodyOf(editor.document())): EntitySaveOutcome => ({
    status: 'saved',
    entity: { ...aldermoor, version, document } as EntityDetail,
  });

  beforeEach(() => {
    entities = new MockEntitiesClient();
    TestBed.configureTestingModule({
      imports: [provideTranslocoTesting()],
      providers: [EntitySession, { provide: EntitiesClient, useValue: entities }],
    });
    session = TestBed.inject(EntitySession);
    editor = TestBed.inject(HexMapStore);
  });

  /** Open Aldermoor (version 3) so save/edit tests have an open entity. */
  function openAldermoor(detail: EntityDetail = aldermoor): void {
    entities.load.mockReturnValue(of(detail));
    session.open('m1').subscribe();
  }

  it('opens an entity by id and loads its hex grid into the editor', () => {
    openAldermoor();

    // The editor sees the bare grid, not the body — the seam unwraps it.
    expect(editor.document()).toEqual(forestAt00);
  });

  it('saves the editor grid, re-wrapped under the open entity base version', async () => {
    openAldermoor();
    editor.paintAt({ q: 5, r: 5 }, 'ocean');
    entities.save.mockReturnValue(of(saved(4)));

    const outcome = await firstValueFrom(session.save());

    // Sent under the base version, Content preserved, grid re-wrapped.
    expect(entities.save).toHaveBeenCalledWith('m1', bodyOf(editor.document()), 3, [], []);
    expect(outcome).toEqual(saved(4));
    expect(session.current()?.version).toBe(4);
  });

  it('seeds the open entity’s tags and sends edited tags with the save (#72)', async () => {
    openAldermoor();
    expect(session.tags()).toEqual([]);

    session.setTags(['deity', 'ruined']);
    expect(session.tags()).toEqual(['deity', 'ruined']);
    entities.save.mockReturnValue(
      of({ status: 'saved', entity: { ...aldermoor, version: 4, tags: ['deity', 'ruined'] } }),
    );

    await firstValueFrom(session.save());

    expect(entities.save).toHaveBeenCalledWith(
      'm1',
      bodyOf(editor.document()),
      3,
      ['deity', 'ruined'],
      [],
    );
    expect(session.current()?.tags).toEqual(['deity', 'ruined']);
  });

  it('harvests link descriptors from the live Content and sends them with the save (#96)', async () => {
    openAldermoor();
    // A Content snapshot carrying a characterised entityLink — the descriptor rides the
    // save so the server can index the owner's vocabulary (it never parses the snapshot).
    session.setContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'entityLink', attrs: { entityId: 'x', label: 'Jane', descriptor: 'Spouse' } },
          ],
        },
      ],
    });
    entities.save.mockReturnValue(of(saved(4)));

    await firstValueFrom(session.save());

    // Descriptors are the 5th arg; sent verbatim (the server normalizes).
    expect(entities.save.mock.calls[0][4]).toEqual(['Spouse']);
  });

  it('surfaces a stale save as a conflict and keeps the editor edit', async () => {
    openAldermoor();
    editor.paintAt({ q: 5, r: 5 }, 'ocean');
    const edited = editor.document();
    const serverCurrent: EntityDetail = { ...aldermoor, version: 7, document: bodyOf(desertAt99) };
    entities.save.mockReturnValue(of({ status: 'conflict', current: serverCurrent }));

    const outcome = await firstValueFrom(session.save());

    expect(outcome).toEqual({ status: 'conflict', current: serverCurrent });
    expect(session.conflict()).toEqual(serverCurrent);
    // In-progress edit survives in the editor for the re-pull.
    expect(editor.document()).toEqual(edited);
  });

  it('re-pulls the server version on reload, replacing the edit and clearing the conflict', async () => {
    openAldermoor();
    editor.paintAt({ q: 5, r: 5 }, 'ocean');
    const serverCurrent: EntityDetail = { ...aldermoor, version: 7, document: bodyOf(desertAt99) };
    entities.save.mockReturnValue(of({ status: 'conflict', current: serverCurrent }));
    session.save().subscribe();
    expect(session.conflict()).toEqual(serverCurrent);

    entities.load.mockReturnValue(of(serverCurrent));
    await firstValueFrom(session.reload());

    expect(editor.document()).toEqual(desertAt99);
    expect(session.conflict()).toBeNull();
  });

  it('is not dirty on open, and dirty after a grid edit', () => {
    openAldermoor();
    expect(session.dirty()).toBe(false);

    editor.paintAt({ q: 5, r: 5 }, 'ocean');
    expect(session.dirty()).toBe(true);
  });

  it('clears dirty on a clean save', async () => {
    openAldermoor();
    editor.paintAt({ q: 5, r: 5 }, 'ocean');
    expect(session.dirty()).toBe(true);
    entities.save.mockReturnValue(of(saved(4)));

    await firstValueFrom(session.save());

    expect(session.dirty()).toBe(false);
  });

  it('keeps a mid-flight Content edit dirty across a clean save (linchpin, ADR-0026)', () => {
    openAldermoor();
    const first = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }],
    };
    session.setContent(first);

    // Save captures `first` (in flight via a Subject); the user keeps typing before it lands.
    const save$ = new Subject<EntitySaveOutcome>();
    entities.save.mockReturnValue(save$);
    session.save().subscribe();
    const second = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'second' }] }],
    };
    session.setContent(second);
    save$.next(saved(4));
    save$.complete();

    // Baseline advanced to the sent `first`, not the live `second`, so the
    // mid-flight keystrokes are still pending — not silently dropped.
    expect(session.dirty()).toBe(true);
  });

  describe('autosave scheduler', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    /** Flush Angular effects, then fire any debounce timer + microtasks due within `ms`. */
    async function settle(ms = 800): Promise<void> {
      TestBed.tick();
      await vi.advanceTimersByTimeAsync(ms);
    }

    function open(): void {
      entities.load.mockReturnValue(of(aldermoor));
      session.open('m1').subscribe();
    }

    it('autosaves a debounced save after an edit', async () => {
      open();
      editor.paintAt({ q: 5, r: 5 }, 'ocean');
      entities.save.mockReturnValue(of(saved(4)));

      TestBed.tick();
      await vi.advanceTimersByTimeAsync(799);
      expect(entities.save).not.toHaveBeenCalled(); // not yet

      await vi.advanceTimersByTimeAsync(1);
      expect(entities.save).toHaveBeenCalledWith('m1', bodyOf(editor.document()), 3, [], []);

      await settle(); // no follow-up save after a clean one
      expect(entities.save).toHaveBeenCalledTimes(1);
    });

    it('flush() persists a pending edit on leave, completing when it lands', async () => {
      open();
      editor.paintAt({ q: 5, r: 5 }, 'ocean'); // dirty, debounce not yet elapsed
      expect(session.dirty()).toBe(true);
      entities.save.mockReturnValue(of(saved(4)));

      let done = false;
      session.flush().subscribe({ complete: () => (done = true) });
      await settle(0);

      expect(done).toBe(true);
      expect(session.dirty()).toBe(false);
      expect(entities.save).toHaveBeenCalledTimes(1);
    });

    it('flush() is a no-op (completes, no save) when nothing is dirty', async () => {
      open();

      let done = false;
      session.flush().subscribe({ complete: () => (done = true) });
      await settle(0);

      expect(done).toBe(true);
      expect(entities.save).not.toHaveBeenCalled();
    });

    it('coalesces edits during an in-flight save into one follow-up save', async () => {
      open();
      const saves: Subject<EntitySaveOutcome>[] = [];
      entities.save.mockImplementation(() => {
        const s = new Subject<EntitySaveOutcome>();
        saves.push(s);
        return s;
      });

      editor.paintAt({ q: 5, r: 5 }, 'ocean');
      await settle(); // autosave fires → save #1 in flight, version 3
      expect(entities.save).toHaveBeenCalledTimes(1);

      // Edit while the save is in flight: no second save starts (single-flight).
      editor.paintAt({ q: 6, r: 6 }, 'forest');
      await settle();
      expect(entities.save).toHaveBeenCalledTimes(1);

      saves[0].next(saved(4));
      saves[0].complete();

      // Exactly one coalesced follow-up, under the advanced version, carrying both edits.
      await settle();
      expect(entities.save).toHaveBeenCalledTimes(2);
      expect(entities.save.mock.calls[1][2]).toBe(4);

      saves[1].next(saved(5));
      saves[1].complete();
      await settle();
      expect(entities.save).toHaveBeenCalledTimes(2);
    });

    it('resets the debounce on each edit, saving only after the last (trailing)', async () => {
      open();
      entities.save.mockReturnValue(of(saved(4)));
      editor.paintAt({ q: 5, r: 5 }, 'ocean');
      TestBed.tick();
      await vi.advanceTimersByTimeAsync(500);

      editor.paintAt({ q: 6, r: 6 }, 'forest'); // re-arms the window
      TestBed.tick();
      await vi.advanceTimersByTimeAsync(500); // 500ms since the last edit — still quiet
      expect(entities.save).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(300); // 800ms since the last edit
      expect(entities.save).toHaveBeenCalledTimes(1);
    });

    it('pauses autosave while a conflict is unresolved', async () => {
      open();
      const serverCurrent: EntityDetail = { ...aldermoor, version: 7, document: bodyOf(desertAt99) };
      entities.save.mockReturnValue(of({ status: 'conflict', current: serverCurrent }));
      editor.paintAt({ q: 5, r: 5 }, 'ocean');
      await settle();
      expect(session.conflict()).not.toBeNull();
      expect(entities.save).toHaveBeenCalledTimes(1);

      // Further edits accumulate but must not loop the stale base version.
      editor.paintAt({ q: 6, r: 6 }, 'forest');
      await settle();
      expect(entities.save).toHaveBeenCalledTimes(1);
      expect(session.dirty()).toBe(true);
    });

    it('resumes autosave after a conflict is resolved by reload', async () => {
      open();
      const serverCurrent: EntityDetail = { ...aldermoor, version: 7, document: bodyOf(desertAt99) };
      entities.save.mockReturnValue(of({ status: 'conflict', current: serverCurrent }));
      editor.paintAt({ q: 5, r: 5 }, 'ocean');
      await settle();
      expect(session.conflict()).not.toBeNull();

      entities.load.mockReturnValue(of(serverCurrent));
      session.reload().subscribe();
      await settle(0);
      expect(session.conflict()).toBeNull();

      // A fresh edit autosaves again under the reloaded version.
      entities.save.mockReturnValue(of({ status: 'saved', entity: { ...serverCurrent, version: 8 } }));
      editor.paintAt({ q: 1, r: 1 }, 'ocean');
      await settle();
      expect(entities.save).toHaveBeenCalledTimes(2);
      expect(entities.save.mock.calls[1][2]).toBe(7); // sent under the reloaded version
    });

    it('pauses autosave after a failed save until the next edit (no retry loop)', async () => {
      open();
      entities.save.mockReturnValue(throwError(() => new Error('boom')));
      editor.paintAt({ q: 5, r: 5 }, 'ocean');
      await settle();
      expect(session.error()).toBe('save');
      expect(session.dirty()).toBe(true);
      expect(entities.save).toHaveBeenCalledTimes(1);

      // The scheduler must not re-fire the same failing save every 800ms.
      await settle();
      await settle();
      expect(entities.save).toHaveBeenCalledTimes(1);

      // A fresh edit lifts the pause and autosave resumes.
      entities.save.mockReturnValue(of(saved(4)));
      editor.paintAt({ q: 6, r: 6 }, 'forest');
      await settle();
      expect(entities.save).toHaveBeenCalledTimes(2);
    });

    it('flush() is a no-op while a conflict is unresolved (no stale re-PUT)', async () => {
      open();
      const serverCurrent: EntityDetail = { ...aldermoor, version: 7, document: bodyOf(desertAt99) };
      entities.save.mockReturnValue(of({ status: 'conflict', current: serverCurrent }));
      editor.paintAt({ q: 5, r: 5 }, 'ocean');
      session.save().subscribe();
      expect(session.conflict()).not.toBeNull();
      entities.save.mockClear();

      // Leaving with the conflict unresolved must not re-send the stale base version.
      let done = false;
      session.flush().subscribe({ complete: () => (done = true) });
      await settle(0);
      expect(entities.save).not.toHaveBeenCalled();
      expect(done).toBe(true);
    });

    it('flush() waits out an in-flight save, then sends the latest edit (ADR-0026)', async () => {
      open();
      const saves: Subject<EntitySaveOutcome>[] = [];
      entities.save.mockImplementation(() => {
        const s = new Subject<EntitySaveOutcome>();
        saves.push(s);
        return s;
      });
      editor.paintAt({ q: 5, r: 5 }, 'ocean');
      session.save().subscribe(); // in flight, snapshot = ocean
      expect(entities.save).toHaveBeenCalledTimes(1);

      // The user types more after the save started, then leaves before it returns.
      editor.paintAt({ q: 6, r: 6 }, 'forest');
      let done = false;
      session.flush().subscribe({ complete: () => (done = true) });
      await settle(0); // the wait observes saving === true
      expect(entities.save).toHaveBeenCalledTimes(1); // single-flight: no second save yet

      // The first save settles and advances the version...
      saves[0].next(saved(4, bodyOf(desertAt99)));
      saves[0].complete();
      await settle(0); // ...the wait sees saving flip false and sends the follow-up
      expect(entities.save).toHaveBeenCalledTimes(2);
      expect(entities.save.mock.calls[1][2]).toBe(4);

      saves[1].next(saved(5));
      saves[1].complete();
      await settle(0);
      expect(done).toBe(true);
    });
  });

  it('renames the open entity', async () => {
    openAldermoor();
    entities.rename.mockReturnValue(of({ ...aldermoor, name: 'The Whisperwood' }));

    await firstValueFrom(session.rename('The Whisperwood'));

    expect(entities.rename).toHaveBeenCalledWith('m1', 'The Whisperwood');
    expect(session.current()?.name).toBe('The Whisperwood');
  });

  it('re-fetches on openRoute even when the same entity is already open', async () => {
    openAldermoor();
    // Re-entering the route must re-fetch, not trust a retained `current`: the
    // route-scoped session outlives a trip to the library (e.g. in-library rename) (#70).
    const renamed: EntityDetail = { ...aldermoor, name: 'Lady Mara' };
    entities.load.mockReturnValue(of(renamed));

    const opened = await firstValueFrom(session.openRoute('m1'));

    expect(opened).toEqual(renamed);
    expect(session.current()?.name).toBe('Lady Mara');
  });

  it('flushes the dirty previous entity, then clears and fetches the new one (ADR-0026)', async () => {
    openAldermoor();
    editor.paintAt({ q: 5, r: 5 }, 'ocean'); // m1 now dirty
    entities.save.mockReturnValue(of(saved(4)));
    const other: EntityDetail = { ...aldermoor, id: 'm2', document: bodyOf(forestAt00) };
    entities.load.mockReturnValue(of(other));

    await firstValueFrom(session.openRoute('m2'));

    // m1's pending edit was flushed before the swap.
    expect(entities.save).toHaveBeenCalledTimes(1);
    // m2's grid is now loaded into the editor.
    expect(editor.document()).toEqual(forestAt00);
    expect(session.current()?.id).toBe('m2');
  });

  it('saves a non-hexmap entity without coercing it into a hexmap (no data loss)', async () => {
    const noteBody = { type: 'note' as const, content };
    openAldermoor({ ...aldermoor, id: 'n1', type: 'note', document: noteBody });
    entities.save.mockReturnValue(of({ status: 'saved', entity: { ...aldermoor, id: 'n1', type: 'note', document: noteBody, version: 4 } }));

    await firstValueFrom(session.save());

    // Saved back as a note; the editor's empty grid did not overwrite it with a hexmap.
    expect(entities.save).toHaveBeenCalledWith('n1', noteBody, 3, [], []);
  });

  it('saves a note’s edited Content opaquely, round-tripping the snapshot untouched', async () => {
    const noteBody = { type: 'note' as const, content };
    openAldermoor({ ...aldermoor, id: 'n1', type: 'note', document: noteBody });
    const snapshot = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Lady Mara rules the north.' }] }],
    };
    session.setContent(snapshot);
    entities.save.mockReturnValue(of(saved(4)));

    await firstValueFrom(session.save());

    // Snapshot wrapped in the format envelope, never parsed (ADR-0019).
    expect(entities.save).toHaveBeenCalledWith(
      'n1',
      { type: 'note', content: { format: CONTENT_FORMAT, snapshot } },
      3,
      [],
      [],
    );
  });

  it('rides a hexmap’s edited Content alongside its grid on save (#75)', async () => {
    openAldermoor();
    editor.paintAt({ q: 5, r: 5 }, 'ocean');
    const snapshot = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The reach lies north.' }] }],
    };
    session.setContent(snapshot);
    entities.save.mockReturnValue(of(saved(4)));

    await firstValueFrom(session.save());

    // Body carries both edits; neither surface drops the other's (ADR-0019).
    expect(entities.save).toHaveBeenCalledWith(
      'm1',
      { type: 'hexmap', content: { format: CONTENT_FORMAT, snapshot }, ...editor.document() },
      3,
      [],
      [],
    );
  });

  it('does not save or rename while a route load is in flight (mid-navigation)', async () => {
    openAldermoor(); // current = m1, not loading
    editor.paintAt({ q: 5, r: 5 }, 'ocean');
    entities.save.mockReturnValue(of(saved(4)));
    // The m2 load stays in flight so the session sits in the loading state.
    const load$ = new Subject<EntityDetail>();
    entities.load.mockReturnValue(load$);
    session.openRoute('m2').subscribe();
    entities.save.mockClear();

    // A *late* Save/rename from the outgoing header — now that the load is in flight —
    // must not write to the m1 the user navigated away from (#4, #70).
    session.save().subscribe();
    session.rename('Nope').subscribe();
    expect(entities.save).not.toHaveBeenCalled();
    expect(entities.rename).not.toHaveBeenCalled();

    // The pending load still resolves normally.
    load$.next({ ...aldermoor, id: 'm2', document: bodyOf(forestAt00) });
    load$.complete();
    await Promise.resolve();
    expect(session.current()?.id).toBe('m2');
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
    entities.save.mockReturnValue(of(saved(4)));

    const event = new KeyboardEvent('keydown', { key: 's', metaKey: true, cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true); // suppresses the browser "save page" dialog
    expect(entities.save).toHaveBeenCalledTimes(1);
  });

  it('is a safe no-op with no entity open (no save, no throw)', () => {
    // Save/rename/reload before any open must not call the client or throw out of a
    // handler-less subscribe.
    expect(() => session.save().subscribe()).not.toThrow();
    expect(() => session.rename('whatever').subscribe()).not.toThrow();
    expect(() => session.reload().subscribe()).not.toThrow();

    expect(entities.save).not.toHaveBeenCalled();
    // `_saving` was never flipped, so the Save button can't stick on "Saving…".
    expect(session.saving()).toBe(false);
  });
});

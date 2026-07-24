import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { EntityDetail } from '@hexly/domain';
import { EntitiesClient, EVICTED, Watched } from '@hexly/web-core';
import { MockEntitiesClient } from '@hexly/web-core/testing';
import { TypeRegistry } from '../../../entity-types/type-registry';
import { EmbedEntitySession } from './embed-entity-session';

function detail(over: Partial<EntityDetail> = {}): EntityDetail {
  return {
    id: 'note-1',
    worldId: 'w1',
    name: 'A note',
    types: ['core.type.note'],
    document: { 'core.body': { text: 'v1' } },
    seq: 1,
    ...over,
  } as unknown as EntityDetail;
}

/**
 * The read-only session behind a Board Embed's live transclusion (ADR-0062, #270): it loads a target,
 * stays never-writable, and — the fix under test — **live-follows** the target's committed changes off
 * `EntitiesClient.watch` (ADR-0044) rather than freezing at load time.
 */
describe('EmbedEntitySession', () => {
  let entities: MockEntitiesClient;
  let session: EmbedEntitySession;
  let watched: Subject<Watched<EntityDetail>>;

  beforeEach(() => {
    entities = new MockEntitiesClient();
    watched = new Subject<Watched<EntityDetail>>();
    entities.watch.mockReturnValue(watched);
    TestBed.configureTestingModule({
      providers: [
        EmbedEntitySession,
        { provide: EntitiesClient, useValue: entities },
        // The session only touches the registry through its derived `fields` (unread here); a stub keeps
        // this spec off the app's full type/view/plugin graph.
        { provide: TypeRegistry, useValue: { resolveFields: () => [], field: () => undefined } },
      ],
    });
    session = TestBed.inject(EmbedEntitySession);
  });

  /** Open the target and settle the reconciler's async subscription to `entities.watch`. */
  function openAndFollow(): void {
    entities.load.mockReturnValue(of(detail()));
    session.open('note-1').subscribe();
    TestBed.tick(); // toObservable(followedId) subscribes async off the signal
  }

  it('adopts the target on open and is never writable', () => {
    openAndFollow();
    expect(session.current()?.id).toBe('note-1');
    expect(session.doc()['core.body']).toEqual({ text: 'v1' });
    expect(session.writable()).toBe(false);
  });

  it('follows the target by id', () => {
    openAndFollow();
    expect(entities.watch).toHaveBeenCalledWith('note-1');
  });

  it('reflects a watched committed update in the session document (live transclusion)', () => {
    openAndFollow();
    watched.next(detail({ document: { 'core.body': { text: 'v2' } }, seq: 2 }));
    expect(session.doc()['core.body']).toEqual({ text: 'v2' });
    expect(session.current()?.seq).toBe(2);
  });

  it('blanks the held detail when the target is evicted mid-view (un-shared / deleted)', () => {
    openAndFollow();
    watched.next(EVICTED);
    expect(session.current()).toBeNull();
  });

  it('tears the follow down on eviction — a later emission does nothing', () => {
    openAndFollow();
    watched.next(EVICTED);
    TestBed.tick(); // nulling current nulls followedId, so switchMap withdraws the follow
    watched.next(detail({ seq: 99 }));
    expect(session.current()).toBeNull();
  });
});

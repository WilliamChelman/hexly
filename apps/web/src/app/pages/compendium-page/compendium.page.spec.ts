import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, ParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { CompendiumSummary } from '@hexly/domain';
import { ActiveWorld, WorldsClient } from '@hexly/web-core';
import { MockWorldsClient } from '@hexly/web-core/testing';
import { provideTranslocoTesting } from '../../../testing/transloco-testing';
import { CompendiumPage } from './compendium.page';

/** Canonical ids: the route segment is decoded before the read, so a pretty slug would not survive. */
const PACK_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0001';
const UNMOUNTED_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0002';
const TOKEN = 'tok-1';

/**
 * The **Compendium page** (#402, #410): one pack's terms, and — since ADR-0080's cascade reaches
 * anonymous **World Public Link** holders — the standing each reader spends to get them. That is the
 * whole of what this spec pins: a session buys the Instance-wide pack, a token buys only what its
 * World **Mounts**, and the page must ask with the one its reader actually holds.
 */
describe('Compendium page', () => {
  let http: HttpTestingController;
  let params$: BehaviorSubject<ParamMap>;

  const pack: CompendiumSummary = {
    id: PACK_ID,
    name: 'Draw Steel: Monsters',
    importer: 'draw-steel.importer.monsters',
    rev: '2024.1',
    attribution: { publisher: 'MCDM Productions, LLC', license: 'Draw Steel Creator License' },
    createdAt: 1,
    updatedAt: 1,
  };

  beforeEach(async () => {
    params$ = new BehaviorSubject<ParamMap>(convertToParamMap({}));
    await TestBed.configureTestingModule({
      imports: [CompendiumPage, provideTranslocoTesting()],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: WorldsClient, useValue: new MockWorldsClient() },
        { provide: ActivatedRoute, useValue: { paramMap: params$.asObservable() } },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  // The verify is load-bearing: a page asking the *other* route fails here even where its own read
  // resolves — which is exactly the 401 an anonymous reader met on `/api/compendiums/:id`.
  afterEach(() => http.verify());

  /** Render at `params` and answer the one read it makes. */
  function render(params: Record<string, string>, respond: (req: ReturnType<typeof http.expectOne>) => void) {
    params$.next(convertToParamMap(params));
    const fixture = TestBed.createComponent(CompendiumPage);
    fixture.detectChanges();
    respond(http.expectOne(() => true));
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('reads a signed-in reader’s pack from the Instance-wide route', () => {
    TestBed.inject(ActiveWorld).set('w1');
    const el = render({ worldId: 'w1', compendiumId: PACK_ID }, (req) => {
      expect(req.request.url).toBe(`/api/compendiums/${PACK_ID}`);
      req.flush(pack);
    });

    expect(el.querySelector('[data-testid=compendium-name]')?.textContent).toContain('Draw Steel: Monsters');
    // Back to the Library that credited it — they came from a World, and it is there to return to.
    expect(el.querySelector('[data-testid=compendium-back]')).not.toBeNull();
  });

  it('reads an anonymous reader’s pack through the World Public Link that carried them', () => {
    const el = render({ token: TOKEN, compendiumId: PACK_ID }, (req) => {
      // The token is their whole standing: the session-guarded route answers them 401, and a pack's
      // terms must never sit behind a wall its content does not (ADR-0080, #410).
      expect(req.request.url).toBe(`/api/public/worlds/${TOKEN}/compendiums/${PACK_ID}`);
      req.flush(pack);
    });

    expect(el.querySelector('[data-testid=compendium-name]')?.textContent).toContain('Draw Steel: Monsters');
    expect(el.querySelector('[data-testid=compendium-publisher]')?.textContent).toContain('MCDM Productions, LLC');
    // Nothing offers them a way into a World they have no standing in.
    expect(el.querySelector('[data-testid=compendium-back]')).toBeNull();
  });

  it('says plainly that a pack the token’s World does not Mount is not there', () => {
    const el = render({ token: TOKEN, compendiumId: UNMOUNTED_ID }, (req) =>
      req.flush('Not found', { status: 404, statusText: 'Not Found' }),
    );

    // An unmounted Container reads as a pack that isn't there rather than as a failure — the id is an
    // identifier on that route, never a credential.
    expect(el.querySelector('[data-testid=compendium-not-found]')).not.toBeNull();
    expect(el.querySelector('[data-testid=load-error]')).toBeNull();
  });
});

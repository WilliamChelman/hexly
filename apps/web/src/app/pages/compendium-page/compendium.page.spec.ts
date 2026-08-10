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
const MISSING_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0002';

/**
 * The **Compendium page** (#402): one pack's terms, read by the reader's session on the Instance-wide
 * route. Every reader is signed in — the anonymous **World Public Link** read retired with the surface
 * (ADR-0084) — so the page asks `/api/compendiums/:id` and nothing else.
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

  it('reads the pack from the Instance-wide route, and links back to the Library that credited it', () => {
    TestBed.inject(ActiveWorld).set('w1');
    const el = render({ worldId: 'w1', compendiumId: PACK_ID }, (req) => {
      expect(req.request.url).toBe(`/api/compendiums/${PACK_ID}`);
      req.flush(pack);
    });

    expect(el.querySelector('[data-testid=compendium-name]')?.textContent).toContain('Draw Steel: Monsters');
    expect(el.querySelector('[data-testid=compendium-publisher]')?.textContent).toContain('MCDM Productions, LLC');
    // Back to the Library that credited it — they came from a World, and it is there to return to.
    expect(el.querySelector('[data-testid=compendium-back]')).not.toBeNull();
  });

  it('says plainly that an id naming no reachable pack is not there', () => {
    TestBed.inject(ActiveWorld).set('w1');
    const el = render({ worldId: 'w1', compendiumId: MISSING_ID }, (req) => {
      expect(req.request.url).toBe(`/api/compendiums/${MISSING_ID}`);
      req.flush('Not found', { status: 404, statusText: 'Not Found' });
    });

    // A 404 reads as a pack that isn't there rather than as a failure — a link kept after an operator
    // removed the pack is the ordinary case, so it is said plainly, not toasted.
    expect(el.querySelector('[data-testid=compendium-not-found]')).not.toBeNull();
    expect(el.querySelector('[data-testid=load-error]')).toBeNull();
  });
});

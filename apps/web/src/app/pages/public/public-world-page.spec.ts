import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { BehaviorSubject, Observable, defer, finalize, of, throwError } from 'rxjs';
import { PublicWorldView } from '@hexly/domain';
import {
  PublicClient,
  NudgeBusClient,
  WORLD_NUDGE_DEBOUNCE_MS,
  Watched,
  watchResource,
} from '@hexly/web-core';
import { MockNudgeBusClient, provideTranslocoTesting } from '@hexly/web-core/testing';
import { PublicWorldPage } from './public-world-page';

const TOKEN = 'tok-123';
const WORLD_ID = 'w1';

function view(worldName: string, entities: PublicWorldView['entities'] = []): PublicWorldView {
  return { worldId: WORLD_ID, worldName, entities };
}

/** Minimal stand-in for the token-scoped Public read client. */
class MockPublicClient {
  world = vi.fn<(token: string) => Observable<PublicWorldView>>();
  watchWorld =
    vi.fn<(token: string, worldId: string) => Observable<Watched<PublicWorldView>>>();
}

describe('PublicWorldPage', () => {
  let client: MockPublicClient;
  let bus: MockNudgeBusClient;
  let fixture: ComponentFixture<PublicWorldPage>;
  const params$ = new BehaviorSubject(convertToParamMap({ token: TOKEN }));

  function render(): ComponentFixture<PublicWorldPage> {
    fixture = TestBed.createComponent(PublicWorldPage);
    fixture.detectChanges();
    return fixture;
  }

  const nameOf = (el: HTMLElement) =>
    el.querySelector('[data-testid=public-world-name]')?.textContent?.trim() ?? null;
  const notFound = (el: HTMLElement) =>
    !!el.querySelector('[data-testid=public-notfound]');

  beforeEach(async () => {
    vi.useFakeTimers();
    client = new MockPublicClient();
    bus = new MockNudgeBusClient();
    client.world.mockReturnValue(of(view('Aldermoor')));
    // Relay the mock bus through the real live-follow loop, as PublicClient.watchWorld wires in
    // prod: it pins the token principal for the follow's lifetime, then refetches via client.world.
    client.watchWorld.mockImplementation((token, worldId) =>
      defer(() => {
        bus.useToken(token);
        return watchResource({
          follow: bus.follow({ kind: 'world', id: worldId }),
          fetch: () => client.world(token),
          debounceMs: WORLD_NUDGE_DEBOUNCE_MS,
        });
      }).pipe(finalize(() => bus.useToken(null))),
    );
    await TestBed.configureTestingModule({
      imports: [PublicWorldPage, provideTranslocoTesting()],
      providers: [
        provideRouter([]),
        { provide: PublicClient, useValue: client },
        { provide: NudgeBusClient, useValue: bus },
        { provide: ActivatedRoute, useValue: { paramMap: params$.asObservable() } },
      ],
    }).compileComponents();
  });

  afterEach(() => vi.useRealTimers());

  it('connects the bus as the token principal and follows the World ref', () => {
    const el = render().nativeElement as HTMLElement;

    expect(bus.useToken).toHaveBeenCalledWith(TOKEN);
    expect(bus.follow).toHaveBeenCalledWith({ kind: 'world', id: WORLD_ID });
    expect(nameOf(el)).toBe('Aldermoor');
  });

  it('refetches and replaces the view on a readable world nudge (rename), without a reload', () => {
    const el = render().nativeElement as HTMLElement;
    client.world.mockReturnValue(of(view('Aldermoor Reborn')));

    bus.emit({ id: WORLD_ID, seq: 2 });
    vi.advanceTimersByTime(200);
    fixture.detectChanges();

    expect(client.world).toHaveBeenLastCalledWith(TOKEN);
    expect(nameOf(el)).toBe('Aldermoor Reborn');
  });

  it('refetches on a stale reconnect pulse, reconciling a change missed while disconnected (#177)', () => {
    const el = render().nativeElement as HTMLElement;
    client.world.mockReturnValue(of(view('Aldermoor Reborn')));

    // A stale pulse is a readable (non-unavailable) nudge, so the World path refetches — it never
    // version-gates. Reconciles whatever the anonymous viewer missed during the gap, no reload.
    bus.emit({ id: WORLD_ID, stale: true });
    vi.advanceTimersByTime(200);
    fixture.detectChanges();

    expect(client.world).toHaveBeenLastCalledWith(TOKEN);
    expect(nameOf(el)).toBe('Aldermoor Reborn');
  });

  it('keeps the view on a transient refetch failure — a valid link is not blanked on a 5xx (#177)', () => {
    const el = render().nativeElement as HTMLElement;
    // A nudge arrives (reconnect or rename), but the refetch hits a bouncing backend.
    client.world.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));

    bus.emit({ id: WORLD_ID, stale: true });
    vi.advanceTimersByTime(200);
    fixture.detectChanges();

    // Not the dead-link panel — the last-good view stands, healing on the next event.
    expect(notFound(el)).toBe(false);
    expect(nameOf(el)).toBe('Aldermoor');
  });

  it('evicts to the dead-link panel when the refetch finds the World gone (404 across the gap) (#177)', () => {
    const el = render().nativeElement as HTMLElement;
    client.world.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));

    bus.emit({ id: WORLD_ID, stale: true });
    vi.advanceTimersByTime(200);
    fixture.detectChanges();

    expect(notFound(el)).toBe(true);
  });

  it('evicts to the dead-link panel on an unavailable nudge (link revoked)', () => {
    const el = render().nativeElement as HTMLElement;

    bus.emit({ id: WORLD_ID, unavailable: true });
    fixture.detectChanges();

    expect(notFound(el)).toBe(true);
    expect(nameOf(el)).toBeNull();
  });

  it('clears the token principal on destroy', () => {
    render();
    bus.useToken.mockClear();

    fixture.destroy();

    expect(bus.useToken).toHaveBeenCalledWith(null);
  });
});

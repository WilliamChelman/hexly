import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { PublicWorldView } from '@hexly/domain';
import { PublicClient, NudgeBusClient } from '@hexly/web-core';
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

    bus.emit({ id: WORLD_ID, updatedAt: 2 });
    vi.advanceTimersByTime(200);
    fixture.detectChanges();

    expect(client.world).toHaveBeenLastCalledWith(TOKEN);
    expect(nameOf(el)).toBe('Aldermoor Reborn');
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

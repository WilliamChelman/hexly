import { BreakpointObserver, BreakpointState } from '@angular/cdk/layout';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { BehaviorSubject, Observable, map, of } from 'rxjs';
import { AuthClient, WorldsClient, ActiveWorld } from '@hexly/web-core';
import { MockAuthClient, MockWorldsClient, provideTranslocoTesting } from '@hexly/web-core/testing';
import { NavRail } from './nav-rail';
import { NavRailStore } from './nav-rail.store';

@Component({ template: '' })
class Blank {}

/** A viewport the test drives directly: `setWide(false)` simulates a narrow screen. */
class FakeBreakpointObserver {
  private readonly wide$ = new BehaviorSubject(true);
  setWide(wide: boolean): void {
    this.wide$.next(wide);
  }
  observe(): Observable<BreakpointState> {
    return this.wide$.pipe(map((matches) => ({ matches, breakpoints: {} })));
  }
}

describe('NavRail', () => {
  let viewport: FakeBreakpointObserver;
  let auth: MockAuthClient;

  beforeEach(async () => {
    localStorage.clear();
    auth = new MockAuthClient();
    viewport = new FakeBreakpointObserver();
    const worldsClient = new MockWorldsClient();
    // The expanded rail mounts the World switcher, which loads the world list
    // (ADR-0024); tests that never expand simply never call this.
    worldsClient.list.mockReturnValue(of([]));
    await TestBed.configureTestingModule({
      imports: [NavRail, provideTranslocoTesting()],
      providers: [
        provideRouter([
          { path: '', component: Blank },
          { path: 'w/:worldId/entities', component: Blank },
          { path: 'styleguide', component: Blank },
        ]),
        { provide: BreakpointObserver, useValue: viewport },
        { provide: AuthClient, useValue: auth },
        { provide: WorldsClient, useValue: worldsClient },
      ],
    }).compileComponents();
  });

  afterEach(() => localStorage.clear());
  afterEach(() => {
    document
      .querySelectorAll('.cdk-overlay-container')
      .forEach((el) => el.remove());
  });

  function signIn(displayName = 'Ada Lovelace'): void {
    auth.setUser({ id: 'u1', email: 'ada@hexly.test', displayName, preferences: {}, roles: ['create-worlds'], isSuperadmin: false });
  }

  function render() {
    const fixture = TestBed.createComponent(NavRail);
    fixture.detectChanges();
    return fixture;
  }

  function q(
    fixture: ReturnType<typeof render>,
    testid: string,
  ): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testid}"]`);
  }

  /** Fill the rail slot the way a routed scope (e.g. WorldLayout) does. */
  function injectEntries(...entries: Parameters<NavRailStore['entries']['set']>[0]) {
    TestBed.inject(NavRailStore).entries.set(entries);
  }

  it('renders the destinations the routed scope injects, hiding the instance ones (ADR-0041)', () => {
    signIn();
    // Inside a World the layout fills the slot (ADR-0041); the rail only renders it.
    TestBed.inject(ActiveWorld).set('w1');
    injectEntries({ link: '/w/w1/entities', testid: 'nav-entities', icon: 'library', labelKey: 'nav.library' });
    const fixture = render();

    const brand = q(fixture, 'brand') as HTMLAnchorElement;
    expect(brand?.getAttribute('href')).toBe('/');

    const library = q(fixture, 'nav-entities') as HTMLAnchorElement;
    expect(library?.getAttribute('href')).toBe('/w/w1/entities');
    expect(library?.textContent).toContain('Library');

    // Styleguide and Admin are instance-scoped: hidden while inside a World.
    expect(q(fixture, 'nav-styleguide')).toBeNull();
    expect(q(fixture, 'nav-admin')).toBeNull();
  });

  it('outside a World shows the instance destinations, not the World ones (ADR-0041)', () => {
    signIn();
    // No active World: sitting on the World Index (`/`).
    const fixture = render();

    const styleguide = q(fixture, 'nav-styleguide') as HTMLAnchorElement;
    expect(styleguide?.getAttribute('href')).toBe('/styleguide');
    expect(styleguide?.textContent).toContain('Styleguide');

    // Library and the World Switcher are World-scoped: absent on the Index.
    expect(q(fixture, 'nav-entities')).toBeNull();
    expect(q(fixture, 'nav-world-settings')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-world-switcher')).toBeNull();
  });

  // Manage-gated World Settings + Library building now live in WorldLayout (ADR-0041);
  // see world-layout.spec.ts. The rail only renders whatever entries it's handed.

  it('starts collapsed and expands when the toggle is pressed', () => {
    signIn();
    const fixture = render();

    const toggle = q(fixture, 'rail-toggle') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    toggle.click();
    fixture.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    toggle.click();
    fixture.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('marks the current destination for assistive tech', async () => {
    signIn();
    // Pin the active World (switcher gate) and hand the rail the link the layout would.
    TestBed.inject(ActiveWorld).set('w1');
    injectEntries({ link: '/w/w1/entities', testid: 'nav-entities', icon: 'library', labelKey: 'nav.library' });
    const fixture = render();

    await TestBed.inject(Router).navigateByUrl('/w/w1/entities');
    fixture.detectChanges();
    // Let routerLinkActive settle against the world-scoped link (ADR-0028).
    await fixture.whenStable();
    fixture.detectChanges();

    expect(q(fixture, 'nav-entities')?.getAttribute('aria-current')).toBe(
      'page',
    );
    // Styleguide is instance-scoped and absent inside a World (ADR-0041).
    expect(q(fixture, 'nav-styleguide')).toBeNull();
  });

  it('houses account and appearance behind the avatar', () => {
    signIn();
    const fixture = render();
    expect(fixture.nativeElement.querySelector('app-user-menu')).not.toBeNull();
  });

  it('instantiates the rail body once when the narrow overlay is open', () => {
    viewport.setWide(false);
    signIn();
    const fixture = render();

    (q(fixture, 'rail-toggle') as HTMLButtonElement).click();
    fixture.detectChanges();

    const all = (testid: string) =>
      fixture.nativeElement.querySelectorAll(`[data-testid="${testid}"]`)
        .length;
    // The overlay is open; the docked strip behind it must not re-render the body.
    expect(q(fixture, 'nav-rail-overlay')).not.toBeNull();
    expect(all('brand')).toBe(1);
    expect(all('rail-toggle')).toBe(1);
    // The lone toggle's ARIA tracks its visibly-open state, not a stale source.
    expect(q(fixture, 'rail-toggle')?.getAttribute('aria-expanded')).toBe(
      'true',
    );
  });

  it('does not resurrect the overlay after a narrow → wide → narrow round trip', () => {
    viewport.setWide(false);
    signIn();
    const fixture = render();

    (q(fixture, 'rail-toggle') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(q(fixture, 'nav-rail-overlay')).not.toBeNull();

    viewport.setWide(true);
    fixture.detectChanges();
    expect(q(fixture, 'nav-rail-overlay')).toBeNull();

    viewport.setWide(false);
    fixture.detectChanges();
    // The overlay stays closed — the transient open flag didn't survive the resize.
    expect(q(fixture, 'nav-rail-overlay')).toBeNull();
  });

  it('reduces to brand + avatar with no destinations for an anonymous viewer', () => {
    const fixture = render(); // not signed in

    expect(q(fixture, 'brand')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-user-menu')).not.toBeNull();
    // No doors a viewer can't open (ADR-0022).
    expect(q(fixture, 'nav-entities')).toBeNull();
    expect(q(fixture, 'nav-styleguide')).toBeNull();
  });
});

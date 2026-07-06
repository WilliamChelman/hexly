import { BreakpointObserver, BreakpointState } from '@angular/cdk/layout';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { BehaviorSubject, Observable, map, of } from 'rxjs';
import { AuthClient } from '../core/services/auth.client';
import { MockAuthClient } from '../core/testing/auth-client.mock';
import { WorldsClient } from '../core/services/worlds.client';
import { MockWorldsClient } from '../core/testing/worlds-client.mock';
import { ActiveWorld } from '../core/services/active-world';
import { provideTranslocoTesting } from '../core/i18n/transloco-testing';
import { NavRail } from './nav-rail';

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
    auth.setUser({ id: 'u1', email: 'ada@hexly.test', displayName, preferences: {}, isAdmin: false, isSuperadmin: false, canCreateWorlds: true });
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

  it('inside a World shows the World destinations, not the instance ones (ADR-0041)', () => {
    signIn();
    // The Library link follows the active World (ADR-0028), pinned by the resolver.
    TestBed.inject(ActiveWorld).set('w1');
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

  it('shows World Settings only to a caller who may manage the World (ADR-0041)', () => {
    signIn();
    const worlds = TestBed.inject(WorldsClient) as unknown as MockWorldsClient;
    worlds.list.mockReturnValue(
      of([{ id: 'w1', name: 'Aldermoor', owners: ['u1'], rights: ['manage'], createdAt: 1, updatedAt: 1 }]),
    );
    TestBed.inject(ActiveWorld).set('w1');
    const fixture = render();

    const settings = q(fixture, 'nav-world-settings') as HTMLAnchorElement;
    expect(settings?.getAttribute('href')).toBe('/w/w1');
  });

  it('hides World Settings from a caller who lacks the manage right (ADR-0041)', () => {
    signIn();
    const worlds = TestBed.inject(WorldsClient) as unknown as MockWorldsClient;
    worlds.list.mockReturnValue(
      of([{ id: 'w1', name: 'Aldermoor', owners: ['u2'], rights: ['read'], createdAt: 1, updatedAt: 1 }]),
    );
    TestBed.inject(ActiveWorld).set('w1');
    const fixture = render();

    expect(q(fixture, 'nav-world-settings')).toBeNull();
    // Library still shows — reading the World is enough.
    expect(q(fixture, 'nav-entities')).not.toBeNull();
  });

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
    // Pin the active World (link href) and sit at its URL (routerLinkActive match).
    TestBed.inject(ActiveWorld).set('w1');
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

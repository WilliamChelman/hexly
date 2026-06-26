import { BreakpointObserver, BreakpointState } from '@angular/cdk/layout';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { BehaviorSubject, Observable, map } from 'rxjs';
import { AuthStore } from '../auth/auth.store';
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
  let http: HttpTestingController;
  let viewport: FakeBreakpointObserver;

  beforeEach(async () => {
    localStorage.clear();
    viewport = new FakeBreakpointObserver();
    await TestBed.configureTestingModule({
      imports: [NavRail, provideTranslocoTesting()],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([
          { path: 'entities', component: Blank },
          { path: 'styleguide', component: Blank },
        ]),
        { provide: BreakpointObserver, useValue: viewport },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => localStorage.clear());
  afterEach(() => http.verify());
  afterEach(() => {
    document
      .querySelectorAll('.cdk-overlay-container')
      .forEach((el) => el.remove());
  });

  function signIn(displayName = 'Ada Lovelace'): void {
    TestBed.inject(AuthStore).login('ada@hexly.test', 'pw').subscribe();
    http
      .expectOne('/auth/login')
      .flush({ id: 'u1', email: 'ada@hexly.test', displayName });
  }

  function render() {
    const fixture = TestBed.createComponent(NavRail);
    fixture.detectChanges();
    return fixture;
  }

  function q(fixture: ReturnType<typeof render>, testid: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testid}"]`);
  }

  it('shows the brand and the primary destinations to a signed-in user', () => {
    signIn();
    const fixture = render();

    const brand = q(fixture, 'brand') as HTMLAnchorElement;
    expect(brand?.getAttribute('href')).toBe('/');

    const library = q(fixture, 'nav-entities') as HTMLAnchorElement;
    expect(library?.getAttribute('href')).toBe('/entities');
    expect(library?.textContent).toContain('Library');

    const styleguide = q(fixture, 'nav-styleguide') as HTMLAnchorElement;
    expect(styleguide?.getAttribute('href')).toBe('/styleguide');
    expect(styleguide?.textContent).toContain('Styleguide');
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
    const fixture = render();

    await TestBed.inject(Router).navigateByUrl('/entities');
    fixture.detectChanges();

    expect(q(fixture, 'nav-entities')?.getAttribute('aria-current')).toBe('page');
    expect(q(fixture, 'nav-styleguide')?.getAttribute('aria-current')).toBeNull();
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
      fixture.nativeElement.querySelectorAll(`[data-testid="${testid}"]`).length;
    // The overlay is open; the docked strip behind it must not re-render the body.
    expect(q(fixture, 'nav-rail-overlay')).not.toBeNull();
    expect(all('brand')).toBe(1);
    expect(all('rail-toggle')).toBe(1);
    // The lone toggle's ARIA tracks its visibly-open state, not a stale source.
    expect(q(fixture, 'rail-toggle')?.getAttribute('aria-expanded')).toBe('true');
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

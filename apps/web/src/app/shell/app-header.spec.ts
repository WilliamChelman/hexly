import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AuthStore } from '../auth/auth.store';
import { ThemeService } from '../core/theme.service';
import { AppHeader } from './app-header';
import { HeaderService } from './header.service';

describe('AppHeader', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppHeader],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /** Spy on navigation so a sign-out can assert where it sends the user. */
  function spyNavigate(): ReturnType<typeof vi.spyOn> {
    return vi
      .spyOn(TestBed.inject(Router), 'navigateByUrl')
      .mockResolvedValue(true);
  }

  /** Establish a signed-in user the header can display. */
  function signIn(displayName = 'Ada Lovelace'): void {
    TestBed.inject(AuthStore).login('ada@hexly.test', 'pw').subscribe();
    http.expectOne('/auth/login').flush({
      id: 'u1',
      email: 'ada@hexly.test',
      displayName,
    });
  }

  it('shows the Hexly brand on every page', () => {
    const fixture = TestBed.createComponent(AppHeader);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Hexly');
  });

  it('links the brand to the app root', () => {
    const fixture = TestBed.createComponent(AppHeader);
    fixture.detectChanges();

    const brand = fixture.nativeElement.querySelector(
      '.brand',
    ) as HTMLAnchorElement;
    expect(brand.tagName).toBe('A');
    expect(brand.getAttribute('href')).toBe('/');
  });

  it('toggles the theme from the consolidated header', () => {
    const theme = TestBed.inject(ThemeService);
    const fixture = TestBed.createComponent(AppHeader);
    fixture.detectChanges();

    const before = theme.theme();
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid=theme-toggle]',
    ) as HTMLButtonElement;
    toggle.click();

    expect(theme.theme()).not.toBe(before);
  });

  it('shows the signed-in user', () => {
    signIn();
    const fixture = TestBed.createComponent(AppHeader);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Ada Lovelace');
  });

  it('ends the session and returns to login on sign out', () => {
    signIn();
    const navigate = spyNavigate();
    const fixture = TestBed.createComponent(AppHeader);
    fixture.detectChanges();

    const signOut = fixture.nativeElement.querySelector(
      '[data-testid=sign-out]',
    ) as HTMLButtonElement;
    signOut.click();

    http.expectOne('/auth/logout').flush(null);

    expect(navigate).toHaveBeenCalledWith('/login');
  });

  it('returns to login even when the logout request fails', () => {
    signIn();
    const navigate = spyNavigate();
    const fixture = TestBed.createComponent(AppHeader);
    fixture.detectChanges();

    const signOut = fixture.nativeElement.querySelector(
      '[data-testid=sign-out]',
    ) as HTMLButtonElement;
    signOut.click();

    http
      .expectOne('/auth/logout')
      .flush(null, { status: 500, statusText: 'Server Error' });

    // The user is never stranded signed-in: navigation fires regardless.
    expect(navigate).toHaveBeenCalledWith('/login');
  });

  it('shows no user identity or Sign out when signed out', () => {
    const fixture = TestBed.createComponent(AppHeader);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('[data-testid=sign-out]'),
    ).toBeNull();
  });

  it('renders the declarative eyebrow and title a page sets', () => {
    TestBed.inject(HeaderService).set({
      eyebrow: 'Library',
      title: 'Your maps',
    });
    const fixture = TestBed.createComponent(AppHeader);
    fixture.detectChanges();

    const headline = fixture.nativeElement.querySelector(
      '[data-testid=header-headline]',
    ) as HTMLElement;
    expect(headline.textContent).toContain('Library');
    expect(headline.textContent).toContain('Your maps');
  });

  it('renders the declarative title as a heading', () => {
    // The page's title is its heading, wherever it is drawn — assistive tech and
    // the e2e suite both find it by role.
    TestBed.inject(HeaderService).set({ title: 'Your maps' });
    const fixture = TestBed.createComponent(AppHeader);
    fixture.detectChanges();

    const heading = fixture.nativeElement.querySelector('h1');
    expect(heading?.textContent).toContain('Your maps');
  });

  it('hosts a named header outlet for a route to project rich content into', () => {
    const fixture = TestBed.createComponent(AppHeader);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('router-outlet[name=header]'),
    ).not.toBeNull();
  });
});

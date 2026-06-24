import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { DestroyRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslocoTesting } from '../core/i18n/transloco-testing';
import { AppHeader } from './app-header';
import { HeaderService } from './header.service';

/** A DestroyRef that never fires — these tests assert what a set() renders. */
const noopDestroyRef = {
  destroyed: false,
  onDestroy: () => () => undefined,
} as DestroyRef;

describe('AppHeader', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [AppHeader, provideTranslocoTesting()],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();
  });

  afterEach(() => localStorage.clear());

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

  it('hosts the user menu', () => {
    const fixture = TestBed.createComponent(AppHeader);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('button[aria-label="Open user menu"]'),
    ).not.toBeNull();
  });

  it('renders the declarative eyebrow and title a page sets', () => {
    TestBed.inject(HeaderService).set(
      {
        eyebrow: 'Library',
        title: 'Your maps',
      },
      noopDestroyRef,
    );
    const fixture = TestBed.createComponent(AppHeader);
    fixture.detectChanges();

    const headline = fixture.nativeElement.querySelector(
      '[data-testid=header-headline]',
    ) as HTMLElement;
    expect(headline.textContent).toContain('Library');
    expect(headline.textContent).toContain('Your maps');
  });

  it('renders the declarative title as chrome, not a document heading', () => {
    // The visible title in the bar is contextual chrome; the page's real <h1>
    // lives in <main> (sr-only). The banner must not own the document heading.
    TestBed.inject(HeaderService).set({ title: 'Your maps' }, noopDestroyRef);
    const fixture = TestBed.createComponent(AppHeader);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Your maps');
    expect(fixture.nativeElement.querySelector('h1')).toBeNull();
  });

  it('marks itself as the banner landmark', () => {
    const fixture = TestBed.createComponent(AppHeader);
    fixture.detectChanges();

    expect(fixture.nativeElement.getAttribute('role')).toBe('banner');
  });

  it('hosts a named header outlet for a route to project rich content into', () => {
    const fixture = TestBed.createComponent(AppHeader);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('router-outlet[name=header]'),
    ).not.toBeNull();
  });
});

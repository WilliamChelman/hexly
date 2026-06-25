import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { AuthStore } from '../auth/auth.store';
import { LocaleService } from '../core/i18n/locale.service';
import { provideTranslocoTesting } from '../core/i18n/transloco-testing';
import { ThemeService } from '../core/theme.service';
import { UserMenu } from './user-menu';

describe('UserMenu', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [UserMenu, provideTranslocoTesting()],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
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

  /** Spy on navigation so a sign-out can assert where it sends the user. */
  function spyNavigate(): ReturnType<typeof vi.spyOn> {
    return vi
      .spyOn(TestBed.inject(Router), 'navigateByUrl')
      .mockResolvedValue(true);
  }

  /** Establish a signed-in user the menu can reflect. */
  function signIn(displayName = 'Ada Lovelace'): void {
    TestBed.inject(AuthStore).login('ada@hexly.test', 'pw').subscribe();
    http.expectOne('/auth/login').flush({
      id: 'u1',
      email: 'ada@hexly.test',
      displayName,
    });
  }

  type Fixture = ReturnType<typeof TestBed.createComponent>;

  /** The trigger, found by its accessible name rather than a test hook. */
  function trigger(fixture: Fixture): HTMLButtonElement {
    return fixture.nativeElement.querySelector(
      'button[aria-label="Open user menu"]',
    ) as HTMLButtonElement;
  }

  /** Open the menu and return the `role=menu` panel from the overlay. */
  function openMenu(fixture: Fixture): HTMLElement {
    trigger(fixture).click();
    fixture.detectChanges();
    return document.querySelector('[role=menu]') as HTMLElement;
  }

  /** A menu command (menuitem / menuitemradio) addressed by its accessible name. */
  function item(menu: HTMLElement, name: RegExp): HTMLElement {
    const items = Array.from(
      menu.querySelectorAll('[role=menuitem],[role=menuitemradio]'),
    ) as HTMLElement[];
    const match = items.find((el) =>
      name.test(el.getAttribute('aria-label') ?? el.textContent ?? ''),
    );
    if (!match) throw new Error(`No menu item matching ${name}`);
    return match;
  }

  it('exposes a trigger by its accessible name', () => {
    const fixture = TestBed.createComponent(UserMenu);
    fixture.detectChanges();

    expect(trigger(fixture)).not.toBeNull();
  });

  it('opens a menu with theme and language commands', () => {
    const fixture = TestBed.createComponent(UserMenu);
    fixture.detectChanges();

    const menu = openMenu(fixture);

    expect(menu.getAttribute('role')).toBe('menu');
    expect(menu.querySelectorAll('[role=menuitemradio]').length).toBe(2);
    expect(item(menu, /theme/i)).toBeTruthy();
  });

  it('toggles the theme from the menu', () => {
    const theme = TestBed.inject(ThemeService);
    const fixture = TestBed.createComponent(UserMenu);
    fixture.detectChanges();

    const before = theme.theme();
    item(openMenu(fixture), /theme/i).click();

    expect(theme.theme()).not.toBe(before);
  });

  it('marks the active language and flips it live', () => {
    const locale = TestBed.inject(LocaleService);
    const transloco = TestBed.inject(TranslocoService);
    const fixture = TestBed.createComponent(UserMenu);
    fixture.detectChanges();

    const menu = openMenu(fixture);
    expect(item(menu, /english/i).getAttribute('aria-checked')).toBe('true');

    item(menu, /français/i).click();
    fixture.detectChanges();

    expect(locale.lang()).toBe('fr');
    expect(transloco.getActiveLang()).toBe('fr');
    expect(localStorage.getItem('hexly-locale')).toBe('fr');
  });

  it('reflects the signed-in user in the menu', () => {
    signIn();
    const fixture = TestBed.createComponent(UserMenu);
    fixture.detectChanges();

    expect(openMenu(fixture).textContent).toContain('Ada Lovelace');
  });

  it('signs out and returns to login', () => {
    signIn();
    const navigate = spyNavigate();
    const fixture = TestBed.createComponent(UserMenu);
    fixture.detectChanges();

    item(openMenu(fixture), /sign out/i).click();
    http.expectOne('/auth/logout').flush(null);

    expect(navigate).toHaveBeenCalledWith('/login');
  });

  it('returns to login even when the logout request fails', () => {
    signIn();
    const navigate = spyNavigate();
    const fixture = TestBed.createComponent(UserMenu);
    fixture.detectChanges();

    item(openMenu(fixture), /sign out/i).click();
    http
      .expectOne('/auth/logout')
      .flush(null, { status: 500, statusText: 'Server Error' });

    // The user is never stranded signed-in: navigation fires regardless.
    expect(navigate).toHaveBeenCalledWith('/login');
  });

  it('offers Login instead of Sign out when signed out', () => {
    const fixture = TestBed.createComponent(UserMenu);
    fixture.detectChanges();

    const menu = openMenu(fixture);
    expect(() => item(menu, /sign out/i)).toThrow();

    const login = item(menu, /login/i) as HTMLAnchorElement;
    expect(login.getAttribute('href')).toBe('/login');
  });
});

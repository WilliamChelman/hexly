import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { AuthClient } from '../core/services/auth.client';
import { MockAuthClient } from '../core/testing/auth-client.mock';
import { LocaleService } from '../core/i18n/locale.service';
import { provideTranslocoTesting } from '../core/i18n/transloco-testing';
import { ThemeService } from '../core/services/theme.service';
import { UserMenu } from './user-menu';

describe('UserMenu', () => {
  let auth: MockAuthClient;

  beforeEach(async () => {
    localStorage.clear();
    auth = new MockAuthClient();
    await TestBed.configureTestingModule({
      imports: [UserMenu, provideTranslocoTesting()],
      providers: [
        provideRouter([]),
        { provide: AuthClient, useValue: auth },
      ],
    }).compileComponents();
  });

  afterEach(() => localStorage.clear());
  afterEach(() => {
    document
      .querySelectorAll('.cdk-overlay-container')
      .forEach((el) => el.remove());
  });

  /** Establish a signed-in user the menu can reflect. */
  function signIn(displayName = 'Ada Lovelace'): void {
    auth.setUser({ id: 'u1', email: 'ada@hexly.test', displayName });
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
    expect(localStorage.getItem('hexly-u:hexly-locale')).toBe('fr');
  });

  it('reflects the signed-in user in the menu', () => {
    signIn();
    const fixture = TestBed.createComponent(UserMenu);
    fixture.detectChanges();

    expect(openMenu(fixture).textContent).toContain('Ada Lovelace');
  });

  it('calls auth.signOut() when the sign-out item is clicked', () => {
    signIn();
    const signOut = vi.spyOn(auth, 'signOut');
    const fixture = TestBed.createComponent(UserMenu);
    fixture.detectChanges();

    item(openMenu(fixture), /sign out/i).click();

    expect(signOut).toHaveBeenCalled();
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

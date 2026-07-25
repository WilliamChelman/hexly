import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { DeploymentProfile } from '@hexly/domain';
import { AuthClient, ClientConfigStore, LocaleService, ThemeService } from '@hexly/web-core';
import { MockAuthClient, mockClientConfigStore } from '@hexly/web-core/testing';
import { UserMenuComponent } from './user-menu.component';

describe('UserMenu', () => {
  let auth: MockAuthClient;
  /** Flipped by a spec before rendering; the menu re-reads it, so no re-configuration is needed. */
  let profile: ReturnType<typeof signal<DeploymentProfile>>;

  beforeEach(async () => {
    localStorage.clear();
    auth = new MockAuthClient();
    profile = signal<DeploymentProfile>('server');
    await TestBed.configureTestingModule({
      imports: [UserMenuComponent, provideTranslocoTesting()],
      providers: [
        provideRouter([]),
        { provide: AuthClient, useValue: auth },
        { provide: ClientConfigStore, useValue: mockClientConfigStore({ profile }) },
      ],
    }).compileComponents();
  });

  afterEach(() => localStorage.clear());
  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
  });

  function signIn(displayName = 'Ada Lovelace'): void {
    auth.setUser({
      id: 'u1',
      email: 'ada@hexly.test',
      displayName,
      preferences: {},
      roles: ['create-worlds'],
      isSuperadmin: false,
    });
  }

  type Fixture = ReturnType<typeof TestBed.createComponent>;

  /** The trigger, found by its accessible name rather than a test hook. */
  function trigger(fixture: Fixture): HTMLButtonElement {
    return fixture.nativeElement.querySelector('button[aria-label="Open user menu"]') as HTMLButtonElement;
  }

  function openMenu(fixture: Fixture): HTMLElement {
    trigger(fixture).click();
    fixture.detectChanges();
    return document.querySelector('[role=menu]') as HTMLElement;
  }

  /** A menu command (menuitem / menuitemradio) addressed by its accessible name. */
  function item(menu: HTMLElement, name: RegExp): HTMLElement {
    const items = Array.from(menu.querySelectorAll('[role=menuitem],[role=menuitemradio]')) as HTMLElement[];
    const match = items.find((el) => name.test(el.getAttribute('aria-label') ?? el.textContent ?? ''));
    if (!match) throw new Error(`No menu item matching ${name}`);
    return match;
  }

  it('exposes a trigger by its accessible name', () => {
    const fixture = TestBed.createComponent(UserMenuComponent);
    fixture.detectChanges();

    expect(trigger(fixture)).not.toBeNull();
  });

  it('opens a menu with theme and language commands', () => {
    const fixture = TestBed.createComponent(UserMenuComponent);
    fixture.detectChanges();

    const menu = openMenu(fixture);

    expect(menu.getAttribute('role')).toBe('menu');
    expect(menu.querySelectorAll('[role=menuitemradio]').length).toBe(2);
    expect(item(menu, /theme/i)).toBeTruthy();
  });

  it('toggles the theme from the menu', () => {
    const theme = TestBed.inject(ThemeService);
    const fixture = TestBed.createComponent(UserMenuComponent);
    fixture.detectChanges();

    const before = theme.theme();
    item(openMenu(fixture), /theme/i).click();

    expect(theme.theme()).not.toBe(before);
  });

  it('marks the active language and flips it live', () => {
    const locale = TestBed.inject(LocaleService);
    const transloco = TestBed.inject(TranslocoService);
    const fixture = TestBed.createComponent(UserMenuComponent);
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
    const fixture = TestBed.createComponent(UserMenuComponent);
    fixture.detectChanges();

    expect(openMenu(fixture).textContent).toContain('Ada Lovelace');
  });

  it('links to the User Settings page when signed in (ADR-0038)', () => {
    signIn();
    const fixture = TestBed.createComponent(UserMenuComponent);
    fixture.detectChanges();

    const settings = item(openMenu(fixture), /settings|paramètres/i);
    expect(settings.getAttribute('href')).toBe('/settings');
  });

  it('offers no Settings link to anonymous viewers — there is no account to edit', () => {
    const fixture = TestBed.createComponent(UserMenuComponent);
    fixture.detectChanges();

    expect(() => item(openMenu(fixture), /settings|paramètres/i)).toThrow();
  });

  it('calls auth.signOut() when the sign-out item is clicked', () => {
    signIn();
    const signOut = vi.spyOn(auth, 'signOut');
    const fixture = TestBed.createComponent(UserMenuComponent);
    fixture.detectChanges();

    item(openMenu(fixture), /sign out/i).click();

    expect(signOut).toHaveBeenCalled();
  });

  it('offers Login instead of Sign out when signed out', () => {
    const fixture = TestBed.createComponent(UserMenuComponent);
    fixture.detectChanges();

    const menu = openMenu(fixture);
    expect(() => item(menu, /sign out/i)).toThrow();

    const login = item(menu, /login/i) as HTMLAnchorElement;
    expect(login.getAttribute('href')).toBe('/login');
  });

  describe('desktop profile (ADR-0071)', () => {
    beforeEach(() => profile.set('desktop'));

    it('offers neither Sign out nor Login — there is no session to manage', () => {
      signIn();
      const fixture = TestBed.createComponent(UserMenuComponent);
      fixture.detectChanges();

      const menu = openMenu(fixture);
      expect(() => item(menu, /sign out/i)).toThrow();
      expect(() => item(menu, /login/i)).toThrow();
    });

    it('keeps the account-independent preferences: theme and language', () => {
      signIn();
      const theme = TestBed.inject(ThemeService);
      const locale = TestBed.inject(LocaleService);
      const fixture = TestBed.createComponent(UserMenuComponent);
      fixture.detectChanges();

      const before = theme.theme();
      item(openMenu(fixture), /theme/i).click();
      expect(theme.theme()).not.toBe(before);

      // Re-opened: triggering a menu item closes the panel, as it does in the server profile.
      item(openMenu(fixture), /français/i).click();
      expect(locale.lang()).toBe('fr');
    });

    it('keeps the Settings link — Preferences live there and survive the cut', () => {
      signIn();
      const fixture = TestBed.createComponent(UserMenuComponent);
      fixture.detectChanges();

      expect(item(openMenu(fixture), /settings|paramètres/i).getAttribute('href')).toBe('/settings');
    });

    it('renders a non-identity trigger: no initials, no name, in the trigger or the panel', () => {
      signIn();
      const fixture = TestBed.createComponent(UserMenuComponent);
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('[data-testid="user-initials"]')).toBeNull();
      expect(trigger(fixture).textContent).not.toContain('Ada');
      expect(openMenu(fixture).textContent).not.toContain('Ada');
    });
  });
});

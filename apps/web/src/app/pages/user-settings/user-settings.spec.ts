import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { provideTranslocoTesting, MockAuthClient } from '@hexly/web-core/testing';
import { LocaleService, ThemeService, AuthClient } from '@hexly/web-core';
import { UserSettings } from './user-settings';

describe('Settings page (ADR-0038)', () => {
  let auth: MockAuthClient;

  function render() {
    auth = new MockAuthClient();
    auth.setUser({
      id: 'u1',
      email: 'ada@hexly.test',
      displayName: 'Ada',
      preferences: {},
      roles: ['create-worlds'],
      isSuperadmin: false,
    });
    TestBed.configureTestingModule({
      imports: [provideTranslocoTesting()],
      providers: [{ provide: AuthClient, useValue: auth }],
    });
    const fixture = TestBed.createComponent(UserSettings);
    fixture.detectChanges();
    return fixture;
  }

  function el<T extends HTMLElement>(
    fixture: { nativeElement: HTMLElement },
    testid: string,
  ): T {
    const found = fixture.nativeElement.querySelector(
      `[data-testid="${testid}"]`,
    );
    if (!found) throw new Error(`missing [data-testid="${testid}"]`);
    return found as T;
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('shows the email read-only and prefills the display name', () => {
    const fixture = render();

    // Email is the login identity: rendered, never an input (ADR-0038).
    expect(fixture.nativeElement.textContent).toContain('ada@hexly.test');
    expect(
      fixture.nativeElement.querySelector('input[value="ada@hexly.test"]'),
    ).toBeNull();

    expect(el<HTMLInputElement>(fixture, 'display-name').value).toBe('Ada');
  });

  it('writes the Format Locale through the shared LocaleService signal, with a live preview', () => {
    const fixture = render();
    const select = el<HTMLSelectElement>(fixture, 'format-locale');

    // Options are named by Intl.DisplayNames (no per-tag copy) and carry a
    // preview of today's date in that locale.
    const gb = Array.from(select.options).find((o) => o.value === 'en-GB');
    expect(gb?.textContent).toContain('United Kingdom');
    expect(gb?.textContent).toContain(new Date().toLocaleDateString('en-GB'));

    select.value = 'en-GB';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(TestBed.inject(LocaleService).formatLocale()).toBe('en-GB');
  });

  it('writes theme and language through the same signals the user menu uses', () => {
    const fixture = render();

    el<HTMLElement>(fixture, 'theme-dark').click();
    fixture.detectChanges();
    expect(TestBed.inject(ThemeService).theme()).toBe('dark');

    const language = el<HTMLSelectElement>(fixture, 'language');
    language.value = 'fr';
    language.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(TestBed.inject(LocaleService).lang()).toBe('fr');
  });

  it('saves the display name through AuthClient', () => {
    const fixture = render();
    auth.updateProfile.mockReturnValue(
      of({
        id: 'u1',
        email: 'ada@hexly.test',
        displayName: 'Ada Lovelace',
        preferences: {},
        roles: ['create-worlds'],
        isSuperadmin: false,
      }),
    );

    const input = el<HTMLInputElement>(fixture, 'display-name');
    input.value = 'Ada Lovelace';
    input.dispatchEvent(new Event('input'));
    el<HTMLButtonElement>(fixture, 'save-profile').click();

    expect(auth.updateProfile).toHaveBeenCalledWith('Ada Lovelace');
  });

  it('submits a password change and surfaces a wrong-current-password failure', () => {
    const fixture = render();
    auth.changePassword.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 401 })),
    );

    const current = el<HTMLInputElement>(fixture, 'current-password');
    current.value = 'not it';
    current.dispatchEvent(new Event('input'));
    const next = el<HTMLInputElement>(fixture, 'new-password');
    next.value = 'battery staple';
    next.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    el<HTMLButtonElement>(fixture, 'change-password').click();
    fixture.detectChanges();

    expect(auth.changePassword).toHaveBeenCalledWith(
      'not it',
      'battery staple',
    );
    // The failure reads in the form, near the field it concerns.
    expect(fixture.nativeElement.textContent).toContain('current password');
  });

  it('refuses a too-short new password client-side, without a round-trip', () => {
    const fixture = render();

    const current = el<HTMLInputElement>(fixture, 'current-password');
    current.value = 'correct horse';
    current.dispatchEvent(new Event('input'));
    const next = el<HTMLInputElement>(fixture, 'new-password');
    next.value = 'short';
    next.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    el<HTMLButtonElement>(fixture, 'change-password').click();
    fixture.detectChanges();

    // The guard message renders; nothing left the browser.
    expect(fixture.nativeElement.textContent).toContain(
      'at least 8 characters',
    );

    expect(auth.changePassword).not.toHaveBeenCalled();
  });
});

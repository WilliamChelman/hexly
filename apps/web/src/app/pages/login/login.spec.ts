import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { provideTranslocoTesting } from '../../core/i18n/transloco-testing';
import { AuthClient } from '../../core/services/auth.client';
import { MockAuthClient } from '../../core/testing/auth-client.mock';
import { Login } from './login';

describe('Login', () => {
  let auth: MockAuthClient;
  let navigate: ReturnType<typeof vi.fn>;
  let queryParams: Record<string, string>;

  beforeEach(async () => {
    auth = new MockAuthClient();
    navigate = vi.fn().mockResolvedValue(true);
    queryParams = {};
    await TestBed.configureTestingModule({
      imports: [Login, provideTranslocoTesting()],
      providers: [
        { provide: AuthClient, useValue: auth },
        { provide: Router, useValue: { navigateByUrl: navigate } },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              get queryParamMap() {
                return convertToParamMap(queryParams);
              },
            },
          },
        },
      ],
    }).compileComponents();
  });

  function typeInto(el: HTMLElement, selector: string, value: string) {
    const input = el.querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  it('owns its page heading in the standalone screen', () => {
    const fixture = TestBed.createComponent(Login);
    fixture.detectChanges();

    // Login renders with no rail/header chrome (ADR-0022); the sr-only <h1> is
    // the document's only heading.
    const heading = fixture.nativeElement.querySelector('h1');
    expect(heading?.textContent).toContain('Sign in');
  });

  it('submits the typed credentials and enters the app on success', () => {
    auth.login.mockReturnValue(
      of({ id: 'u1', email: 'ada@hexly.test', displayName: 'Ada' }),
    );
    const fixture = TestBed.createComponent(Login);
    const el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();

    typeInto(el, 'input[type=email]', 'ada@hexly.test');
    typeInto(el, 'input[type=password]', 'correct horse');
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(auth.login).toHaveBeenCalledWith('ada@hexly.test', 'correct horse');
    expect(navigate).toHaveBeenCalledWith('/');
    // The button must not be stuck on "Signing in…" — pending is reset on
    // success too, so a cancelled navigation can't strand the UI.
    const button = el.querySelector('button[type=submit]') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.textContent).toContain('Sign in');
    expect(button.textContent).not.toContain('Signing in');
  });

  it('trims the typed email before sending it', () => {
    auth.login.mockReturnValue(
      of({ id: 'u1', email: 'ada@hexly.test', displayName: 'Ada' }),
    );
    const fixture = TestBed.createComponent(Login);
    const el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();

    typeInto(el, 'input[type=email]', '  ada@hexly.test  ');
    typeInto(el, 'input[type=password]', 'correct horse');
    el.querySelector('form')!.dispatchEvent(new Event('submit'));

    expect(auth.login).toHaveBeenCalledWith('ada@hexly.test', 'correct horse');
  });

  it('navigates to returnUrl when one is present', () => {
    auth.login.mockReturnValue(
      of({ id: 'u1', email: 'ada@hexly.test', displayName: 'Ada' }),
    );
    queryParams = { returnUrl: '/atlas/42' };
    const fixture = TestBed.createComponent(Login);
    const el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();

    typeInto(el, 'input[type=email]', 'ada@hexly.test');
    typeInto(el, 'input[type=password]', 'correct horse');
    el.querySelector('form')!.dispatchEvent(new Event('submit'));

    expect(navigate).toHaveBeenCalledWith('/atlas/42');
  });

  it('renders the whole screen in French when French is the active language', () => {
    const fixture = TestBed.createComponent(Login);
    const el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();

    // No reload: flipping the active language re-renders the live component.
    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();

    expect(el.querySelector('h1')?.textContent).toContain('Se connecter');
    expect(el.textContent).toContain('E-mail');
    expect(el.textContent).toContain('Mot de passe');
    const button = el.querySelector('button[type=submit]') as HTMLButtonElement;
    expect(button.textContent).toContain('Se connecter');
    expect(button.textContent).not.toContain('Sign in');
  });

  it('shows the rejection error translated when French is active', () => {
    auth.login.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 401 })),
    );
    const fixture = TestBed.createComponent(Login);
    const el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();

    typeInto(el, 'input[type=email]', 'ada@hexly.test');
    typeInto(el, 'input[type=password]', 'wrong');
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(el.textContent).toContain('E-mail ou mot de passe incorrect');
  });

  it('shows an error and stays put when the credentials are rejected', () => {
    auth.login.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 401 })),
    );
    const fixture = TestBed.createComponent(Login);
    const el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();

    typeInto(el, 'input[type=email]', 'ada@hexly.test');
    typeInto(el, 'input[type=password]', 'wrong');
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(navigate).not.toHaveBeenCalled();
    expect(el.textContent).toContain('Incorrect email or password');
  });
});

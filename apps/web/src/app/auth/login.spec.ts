import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Login } from './login';

describe('Login', () => {
  let http: HttpTestingController;
  let navigate: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    navigate = vi.fn().mockResolvedValue(true);
    await TestBed.configureTestingModule({
      imports: [Login],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Router, useValue: { navigateByUrl: navigate } },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function typeInto(el: HTMLElement, selector: string, value: string) {
    const input = el.querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  it('submits the typed credentials and enters the app on success', () => {
    const fixture = TestBed.createComponent(Login);
    const el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();

    typeInto(el, 'input[type=email]', 'ada@hexly.test');
    typeInto(el, 'input[type=password]', 'correct horse');
    el.querySelector('form')!.dispatchEvent(new Event('submit'));

    const req = http.expectOne('/auth/login');
    expect(req.request.body).toEqual({
      email: 'ada@hexly.test',
      password: 'correct horse',
    });
    req.flush({ id: 'u1', email: 'ada@hexly.test', displayName: 'Ada' });

    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('shows an error and stays put when the credentials are rejected', () => {
    const fixture = TestBed.createComponent(Login);
    const el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();

    typeInto(el, 'input[type=email]', 'ada@hexly.test');
    typeInto(el, 'input[type=password]', 'wrong');
    el.querySelector('form')!.dispatchEvent(new Event('submit'));

    http
      .expectOne('/auth/login')
      .flush(null, { status: 401, statusText: 'Unauthorized' });
    fixture.detectChanges();

    expect(navigate).not.toHaveBeenCalled();
    expect(el.textContent).toContain('Incorrect email or password');
  });
});

import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AuthStore } from '../auth/auth.store';
import { EditorHeader } from './editor-header';

describe('EditorHeader', () => {
  let http: HttpTestingController;
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EditorHeader],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    navigate = vi
      .spyOn(TestBed.inject(Router), 'navigateByUrl')
      .mockResolvedValue(true);

    // Establish a signed-in user the header can display.
    TestBed.inject(AuthStore).login('ada@hexly.test', 'pw').subscribe();
    http.expectOne('/auth/login').flush({
      id: 'u1',
      email: 'ada@hexly.test',
      displayName: 'Ada Lovelace',
    });
  });

  afterEach(() => http.verify());

  it('shows the signed-in user', () => {
    const fixture = TestBed.createComponent(EditorHeader);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Ada Lovelace');
  });

  it('ends the session and returns to login on sign out', () => {
    const fixture = TestBed.createComponent(EditorHeader);
    fixture.detectChanges();

    const signOut = fixture.nativeElement.querySelector(
      '[data-testid=sign-out]',
    ) as HTMLButtonElement;
    signOut.click();

    http.expectOne('/auth/logout').flush(null);

    expect(navigate).toHaveBeenCalledWith('/login');
  });

  it('returns to login even when the logout request fails', () => {
    const fixture = TestBed.createComponent(EditorHeader);
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
});

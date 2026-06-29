import { Component } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AuthClient } from './auth.client';

@Component({ template: '', standalone: true })
class TestHost {}

/** Drain the microtask queue — rxResource defers its status update via queueMicrotask. */
const tick = () => new Promise((r) => queueMicrotask(r as () => void));

describe('AuthClient.sessionLoading', () => {
  let client: AuthClient;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TestHost],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    client = TestBed.inject(AuthClient);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.match('/api/auth/me');
    http.verify();
  });

  it('is true from the moment the service is constructed (rxResource pre-loads)', () => {
    // rxResource starts in "loading" state before any CD — guards must wait for
    // sessionLoading to settle, not assume it starts false.
    expect(client.sessionLoading()).toBe(true);
  });

  it('is true while the boot check is in flight', async () => {
    TestBed.createComponent(TestHost).detectChanges();
    expect(client.sessionLoading()).toBe(true);
    http.expectOne('/api/auth/me').flush(null, { status: 401, statusText: 'Unauthorized' });
    await tick(); // rxResource defers status → resolved via queueMicrotask
    expect(client.sessionLoading()).toBe(false);
  });

  it('is false once the boot check resolves to a user', async () => {
    TestBed.createComponent(TestHost).detectChanges();
    http.expectOne('/api/auth/me').flush({ id: 'u1', email: 'ada@hexly.test', displayName: 'Ada' });
    await tick();
    expect(client.sessionLoading()).toBe(false);
  });

  it('resolves to null when the boot check returns 401', async () => {
    TestBed.createComponent(TestHost).detectChanges();
    http.expectOne('/api/auth/me').flush(null, { status: 401, statusText: 'Unauthorized' });
    await tick();
    expect(client.currentUser()).toBeNull();
    expect(client.isAuthenticated()).toBe(false);
  });
});

describe('AuthClient', () => {
  let client: AuthClient;
  let http: HttpTestingController;

  const ada = { id: 'u1', email: 'ada@hexly.test', displayName: 'Ada' };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
    client = TestBed.inject(AuthClient);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('records the current user after a successful login', () => {
    client.login('ada@hexly.test', 'correct horse').subscribe();

    const req = http.expectOne('/api/auth/login');
    expect(req.request.body).toEqual({
      email: 'ada@hexly.test',
      password: 'correct horse',
    });
    req.flush(ada);

    expect(client.currentUser()).toEqual(ada);
    expect(client.isAuthenticated()).toBe(true);
  });

  it('clears the current user on logout', () => {
    client.login('ada@hexly.test', 'correct horse').subscribe();
    http.expectOne('/api/auth/login').flush(ada);

    client.logout().subscribe();
    http.expectOne('/api/auth/logout').flush(null);

    expect(client.currentUser()).toBeNull();
    expect(client.isAuthenticated()).toBe(false);
  });

  it('clears the current user even when logout fails', () => {
    client.login('ada@hexly.test', 'correct horse').subscribe();
    http.expectOne('/api/auth/login').flush(ada);

    let completed = false;
    client.logout().subscribe({
      error: () => undefined,
      complete: () => (completed = true),
    });
    http
      .expectOne('/api/auth/logout')
      .flush(null, { status: 500, statusText: 'Server Error' });

    expect(client.currentUser()).toBeNull();
    expect(client.isAuthenticated()).toBe(false);
    expect(completed).toBe(true);
  });

  it('navigates to /login on sign-out regardless of whether logout succeeds', () => {
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigateByUrl')
      .mockResolvedValue(true);

    client.signOut();
    http
      .expectOne('/api/auth/logout')
      .flush(null, { status: 500, statusText: 'Server Error' });

    expect(navigate).toHaveBeenCalledWith('/login');
  });
});

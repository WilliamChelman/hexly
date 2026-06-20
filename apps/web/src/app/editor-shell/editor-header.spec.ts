import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { MapDetail } from '@hexly/domain';
import { AuthStore } from '../auth/auth.store';
import { EditorSession } from './editor-session';
import { EditorHeader } from './editor-header';

describe('EditorHeader', () => {
  let http: HttpTestingController;
  let navigate: ReturnType<typeof vi.spyOn>;

  const aldermoor: MapDetail = {
    id: 'm1',
    ownerId: 'u1',
    title: 'The Reach of Aldermoor',
    visibility: 'private',
    version: 3,
    createdAt: 1,
    updatedAt: 1,
    document: { hexes: {}, regions: [] },
  };

  /** Open a map through the real session so the header has one to show/save. */
  function openMap(detail: MapDetail): void {
    TestBed.inject(EditorSession).open(detail.id).subscribe();
    http.expectOne(`/maps/${detail.id}`).flush(detail);
  }

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

  it('shows the open map title', () => {
    openMap({ ...aldermoor, title: 'The Whisperwood' });

    const fixture = TestBed.createComponent(EditorHeader);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('The Whisperwood');
  });

  it('renames the open map when the title is edited', () => {
    openMap(aldermoor);
    const fixture = TestBed.createComponent(EditorHeader);
    fixture.detectChanges();

    // Click the title to start editing, then type a new name and commit on blur.
    (
      fixture.nativeElement.querySelector('[data-testid=title]') as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector(
      '[data-testid=title-input]',
    ) as HTMLInputElement;
    input.value = 'The Whisperwood';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));

    const req = http.expectOne('/maps/m1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ title: 'The Whisperwood' });
    req.flush({ ...aldermoor, title: 'The Whisperwood' });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('The Whisperwood');
  });

  it('does not call the API when the title is left unchanged', () => {
    openMap(aldermoor);
    const fixture = TestBed.createComponent(EditorHeader);
    fixture.detectChanges();

    (
      fixture.nativeElement.querySelector('[data-testid=title]') as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    // Blur without changing anything — a no-op edit must not hit the server.
    (
      fixture.nativeElement.querySelector('[data-testid=title-input]') as HTMLInputElement
    ).dispatchEvent(new Event('blur'));

    http.expectNone('/maps/m1');
  });

  it('disables Save until a map is open', () => {
    // No openMap() here: with no open map, Save must be disabled so a click can't
    // flip the session into a stuck "Saving…" state with nothing to save.
    const fixture = TestBed.createComponent(EditorHeader);
    fixture.detectChanges();

    const save = fixture.nativeElement.querySelector(
      '[data-testid=save]',
    ) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it('saves the open map under its base version when Save is clicked', () => {
    openMap(aldermoor);
    const fixture = TestBed.createComponent(EditorHeader);
    fixture.detectChanges();

    const save = fixture.nativeElement.querySelector(
      '[data-testid=save]',
    ) as HTMLButtonElement;
    save.click();

    const req = http.expectOne('/maps/m1');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body.version).toBe(3);
    req.flush({ ...aldermoor, version: 4 });
  });

  it('surfaces a save conflict and re-pulls when the user reloads', () => {
    openMap(aldermoor);
    const fixture = TestBed.createComponent(EditorHeader);
    fixture.detectChanges();

    // A save is rejected as stale...
    (
      fixture.nativeElement.querySelector('[data-testid=save]') as HTMLButtonElement
    ).click();
    http
      .expectOne('/maps/m1')
      .flush({ ...aldermoor, version: 9 }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();

    // ...so the header surfaces the conflict to the user...
    expect(fixture.nativeElement.querySelector('[data-testid=conflict]')).not.toBeNull();

    // ...and offers a re-pull that resolves it.
    (
      fixture.nativeElement.querySelector(
        '[data-testid=conflict-reload]',
      ) as HTMLButtonElement
    ).click();
    http.expectOne('/maps/m1').flush({ ...aldermoor, version: 9 });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid=conflict]')).toBeNull();
  });
});

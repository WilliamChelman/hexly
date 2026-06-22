import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { MapDetail } from '@hexly/domain';
import { provideTranslocoTesting } from '../core/i18n/transloco-testing';
import { EditorSession } from './editor-session';
import { EditorHeader } from './editor-header';

describe('EditorHeader', () => {
  let http: HttpTestingController;

  const aldermoor: MapDetail = {
    id: 'm1',
    ownerId: 'u1',
    title: 'The Reach of Aldermoor',
    visibility: 'private',
    version: 3,
    createdAt: 1,
    updatedAt: 1,
    document: { hexes: {}, regions: [], labels: [] },
  };

  /** Open a map through the real session so the header has one to show/save. */
  function openMap(detail: MapDetail): void {
    TestBed.inject(EditorSession).open(detail.id).subscribe();
    http.expectOne(`/maps/${detail.id}`).flush(detail);
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EditorHeader, provideTranslocoTesting()],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

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

  it('renders its chrome and actions in French when French is the active language', () => {
    openMap(aldermoor);
    const fixture = TestBed.createComponent(EditorHeader);
    fixture.detectChanges();

    // No reload: flipping the active language re-renders the live component.
    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    // The Editing chip and the map-scoped actions translate; the map title stays
    // the user's words (asserted separately below).
    expect(el.textContent).toContain('Édition');
    expect(el.textContent).toContain('Partager');
    expect(el.textContent).not.toContain('Editing');
    const save = el.querySelector('[data-testid=save]') as HTMLButtonElement;
    expect(save.textContent).toContain('Enregistrer');
    expect(save.textContent).not.toContain('Save');
  });

  it('keeps the user’s map title verbatim — never translated — under French', () => {
    openMap({ ...aldermoor, title: 'Save' }); // collides with a UI action label
    const fixture = TestBed.createComponent(EditorHeader);
    fixture.detectChanges();

    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();

    const title = fixture.nativeElement.querySelector(
      '[data-testid=title]',
    ) as HTMLButtonElement;
    expect(title.textContent?.trim()).toBe('Save');
  });

  it('surfaces a 409 save conflict as a translated message', () => {
    openMap(aldermoor);
    const fixture = TestBed.createComponent(EditorHeader);
    fixture.detectChanges();

    // English (the default lang): the conflict chip resolves its key to the
    // English copy, proving the 409 maps to editorShell.save.conflict.
    (
      fixture.nativeElement.querySelector('[data-testid=save]') as HTMLButtonElement
    ).click();
    http
      .expectOne('/maps/m1')
      .flush({ ...aldermoor, version: 9 }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();

    const conflict = () =>
      fixture.nativeElement.querySelector('[data-testid=conflict]') as HTMLElement;
    expect(conflict().textContent).toContain('Newer version on server');

    // ...and it reflows to French live on a language switch.
    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();
    expect(conflict().textContent).toContain('Version plus récente sur le serveur');
    expect(conflict().textContent).not.toContain('Newer version on server');
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

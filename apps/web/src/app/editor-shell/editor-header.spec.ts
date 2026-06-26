import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { emptyContent, EntityDetail } from '@hexly/domain';
import { provideTranslocoTesting } from '../core/i18n/transloco-testing';
import { EntitySession } from './entity-session';
import { EditorHeader } from './editor-header';

describe('EditorHeader', () => {
  let http: HttpTestingController;

  const aldermoor: EntityDetail = {
    id: 'm1',
    ownerId: 'u1',
    name: 'The Reach of Aldermoor',
    type: 'hexmap',
    tags: [],
    visibility: 'private',
    version: 3,
    createdAt: 1,
    updatedAt: 1,
    document: { type: 'hexmap', content: emptyContent(), hexes: {}, regions: [], labels: [] },
  };

  /** Open an entity through the real session so the header has one to show/save. */
  function openMap(detail: EntityDetail): void {
    TestBed.inject(EntitySession).open(detail.id).subscribe();
    http.expectOne(`/entities/${detail.id}`).flush(detail);
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EditorHeader, provideTranslocoTesting()],
      providers: [
        EntitySession,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('shows the open entity name', () => {
    openMap({ ...aldermoor, name: 'The Whisperwood' });

    const fixture = TestBed.createComponent(EditorHeader);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('The Whisperwood');
  });

  it('mounts the tag editor for the open map', () => {
    openMap(aldermoor);

    const fixture = TestBed.createComponent(EditorHeader);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('[data-testid=entity-tags]'),
    ).not.toBeNull();
  });

  it('renames the open entity when the title is edited', () => {
    openMap(aldermoor);
    const fixture = TestBed.createComponent(EditorHeader);
    fixture.detectChanges();

    // Edit the title in place (contenteditable), then commit on blur.
    const title = fixture.nativeElement.querySelector(
      '[data-testid=title]',
    ) as HTMLElement;
    title.textContent = 'The Whisperwood';
    title.dispatchEvent(new Event('blur'));

    const req = http.expectOne('/entities/m1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ name: 'The Whisperwood' });
    req.flush({ ...aldermoor, name: 'The Whisperwood' });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('The Whisperwood');
  });

  it('does not call the API when the title is left unchanged', () => {
    openMap(aldermoor);
    const fixture = TestBed.createComponent(EditorHeader);
    fixture.detectChanges();

    (
      fixture.nativeElement.querySelector('[data-testid=title]') as HTMLElement
    ).dispatchEvent(new Event('blur'));

    http.expectNone('/entities/m1');
  });

  it('disables Save until an entity is open', () => {
    // No openMap() here: with none open, Save must be disabled so a click can't
    // flip the session into a stuck "Saving…" state with nothing to save.
    const fixture = TestBed.createComponent(EditorHeader);
    fixture.detectChanges();

    const save = fixture.nativeElement.querySelector(
      '[data-testid=save]',
    ) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it('saves the open entity under its base version when Save is clicked', () => {
    openMap(aldermoor);
    const fixture = TestBed.createComponent(EditorHeader);
    fixture.detectChanges();

    const save = fixture.nativeElement.querySelector(
      '[data-testid=save]',
    ) as HTMLButtonElement;
    save.click();

    const req = http.expectOne('/entities/m1');
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
    // Name stays verbatim — asserted in the next test.
    expect(el.textContent).toContain('Édition');
    expect(el.textContent).toContain('Partager');
    expect(el.textContent).not.toContain('Editing');
    const save = el.querySelector('[data-testid=save]') as HTMLButtonElement;
    expect(save.textContent).toContain('Enregistrer');
    expect(save.textContent).not.toContain('Save');
  });

  it('keeps the user’s entity name verbatim — never translated — under French', () => {
    openMap({ ...aldermoor, name: 'Save' }); // collides with a UI action label
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

    // English first: confirms the 409 maps to editorShell.save.conflict.
    (
      fixture.nativeElement.querySelector('[data-testid=save]') as HTMLButtonElement
    ).click();
    http
      .expectOne('/entities/m1')
      .flush({ ...aldermoor, version: 9 }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();

    const conflict = () =>
      fixture.nativeElement.querySelector('[data-testid=conflict]') as HTMLElement;
    expect(conflict().textContent).toContain('Newer version on server');

    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();
    expect(conflict().textContent).toContain('Version plus récente sur le serveur');
    expect(conflict().textContent).not.toContain('Newer version on server');
  });

  it('surfaces a save conflict and re-pulls when the user reloads', () => {
    openMap(aldermoor);
    const fixture = TestBed.createComponent(EditorHeader);
    fixture.detectChanges();

    (
      fixture.nativeElement.querySelector('[data-testid=save]') as HTMLButtonElement
    ).click();
    http
      .expectOne('/entities/m1')
      .flush({ ...aldermoor, version: 9 }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid=conflict]')).not.toBeNull();

    (
      fixture.nativeElement.querySelector(
        '[data-testid=conflict-reload]',
      ) as HTMLButtonElement
    ).click();
    http.expectOne('/entities/m1').flush({ ...aldermoor, version: 9 });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid=conflict]')).toBeNull();
  });
});

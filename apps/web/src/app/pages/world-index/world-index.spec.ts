import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { WorldSummary } from '@hexly/domain';
import { AuthClient } from '../../core/services/auth.client';
import { ToasterService } from '../../core/services/toaster.service';
import { provideTranslocoTesting } from '../../core/i18n/transloco-testing';
import { WorldIndex } from './world-index';

function world(id: string, name = id, ownerId = 'u1'): WorldSummary {
  return { id, name, ownerId, createdAt: 1, updatedAt: 1 };
}

describe('WorldIndex', () => {
  let http: HttpTestingController;
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WorldIndex, provideTranslocoTesting()],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);

    // The caller (u1) — used to tell owned Worlds from member Worlds.
    TestBed.inject(AuthClient).login('ada@hexly.test', 'pw').subscribe();
    http.expectOne('/api/auth/login').flush({
      id: 'u1',
      email: 'ada@hexly.test',
      displayName: 'Ada',
    });
  });

  afterEach(() => http.verify());

  /** Render the Index and resolve its world list. */
  function render(worlds: WorldSummary[]) {
    const fixture = TestBed.createComponent(WorldIndex);
    fixture.detectChanges(); // load() -> GET /worlds
    http.expectOne('/api/worlds').flush(worlds);
    fixture.detectChanges();
    return fixture;
  }

  const $ = (el: HTMLElement, sel: string) => el.querySelector(sel);

  it('lists every reachable World by name', () => {
    const el = render([
      world('w1', 'Aldermoor'),
      world('w2', 'Whisperwood', 'someone-else'),
    ]).nativeElement as HTMLElement;

    const names = Array.from(
      el.querySelectorAll('[data-testid^=world-]'),
    ).map((n) => (n as HTMLElement).textContent ?? '');
    expect(names.join(' ')).toContain('Aldermoor');
    expect(names.join(' ')).toContain('Whisperwood');
  });

  it('distinguishes owned Worlds from member Worlds', () => {
    const el = render([
      world('w1', 'Aldermoor'), // ownerId u1 = the caller → owned
      world('w2', 'Whisperwood', 'someone-else'), // → member
    ]).nativeElement as HTMLElement;

    expect($(el, '[data-testid=owned-w1]')).not.toBeNull();
    expect($(el, '[data-testid=member-w1]')).toBeNull();
    expect($(el, '[data-testid=member-w2]')).not.toBeNull();
    expect($(el, '[data-testid=owned-w2]')).toBeNull();
  });

  it('enters a World’s browser when its card is activated', () => {
    const el = render([world('w1', 'Aldermoor')]).nativeElement as HTMLElement;

    ($(el, '[data-testid=world-w1]') as HTMLButtonElement).click();

    expect(navigate).toHaveBeenCalledWith(['/w', 'w1', 'entities']);
  });

  it('shows an empty state with a create affordance when there are no Worlds', () => {
    const el = render([]).nativeElement as HTMLElement;

    expect($(el, '[data-testid=worlds-empty]')).not.toBeNull();
    expect($(el, '[data-testid=create-world]')).not.toBeNull();
  });

  it('creating a World opens its Home Entity', () => {
    const el = render([]).nativeElement as HTMLElement;

    ($(el, '[data-testid=create-world]') as HTMLButtonElement).click();

    const req = http.expectOne('/api/worlds');
    expect(req.request.method).toBe('POST');
    req.flush({ ...world('w9', 'Untitled world'), homeEntityId: 'home9' });

    expect(navigate).toHaveBeenCalledWith([
      '/w',
      'w9',
      'entities',
      'home9',
    ]);
  });

  it('renders its empty state in French when French is the active language', () => {
    const fixture = render([]);
    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement).textContent,
    ).toContain("Aucun monde pour l'instant.");
  });

  it('shows an error state (not the empty state) when the World list fails to load', () => {
    const fixture = TestBed.createComponent(WorldIndex);
    fixture.detectChanges(); // load() → GET /worlds
    http
      .expectOne('/api/worlds')
      .flush(null, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect($(el, '[data-testid=load-error]')).not.toBeNull();
    expect($(el, '[data-testid=worlds-empty]')).toBeNull();
  });

  it('surfaces an error toast when creating a World fails', () => {
    const el = render([]).nativeElement as HTMLElement;

    ($(el, '[data-testid=create-world]') as HTMLButtonElement).click();
    http
      .expectOne('/api/worlds')
      .flush(null, { status: 500, statusText: 'Server Error' });

    expect(TestBed.inject(ToasterService).toasts().map((t) => t.tone)).toEqual([
      'error',
    ]);
  });
});

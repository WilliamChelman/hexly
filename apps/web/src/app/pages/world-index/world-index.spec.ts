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
import { MockAuthClient } from '../../core/testing/mock-auth-client';
import { ToasterService } from '../../core/services/toaster.service';
import { provideTranslocoTesting } from '../../core/i18n/transloco-testing';
import { WorldIndex } from './world-index';

function world(id: string, name = id, ownerId = 'u1'): WorldSummary {
  return { id, name, ownerId, createdAt: 1, updatedAt: 1 };
}

describe('WorldIndex', () => {
  let http: HttpTestingController;
  let navigate: ReturnType<typeof vi.spyOn>;
  let auth: MockAuthClient;

  beforeEach(async () => {
    auth = new MockAuthClient();
    await TestBed.configureTestingModule({
      imports: [WorldIndex, provideTranslocoTesting()],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AuthClient, useValue: auth },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);

    // The caller (u1) — used to tell owned Worlds from member Worlds.
    auth.setUser({ id: 'u1', email: 'ada@hexly.test', displayName: 'Ada' });
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

  it('links a World’s card to its Entity browser', () => {
    const el = render([world('w1', 'Aldermoor')]).nativeElement as HTMLElement;

    // The whole card is a routerLink anchor (stretched-link inset), so assert the
    // resolved href rather than a navigate() call.
    expect(
      ($(el, '[data-testid=world-w1]') as HTMLAnchorElement).getAttribute(
        'href',
      ),
    ).toBe('/w/w1/entities');
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

  it('offers rename + delete on owned Worlds only, not on member Worlds', () => {
    const el = render([
      world('w1', 'Aldermoor'), // owned by the caller (u1)
      world('w2', 'Whisperwood', 'someone-else'), // member
    ]).nativeElement as HTMLElement;

    expect($(el, '[data-testid=rename-world-w1]')).not.toBeNull();
    expect($(el, '[data-testid=delete-world-w1]')).not.toBeNull();
    expect($(el, '[data-testid=rename-world-w2]')).toBeNull();
    expect($(el, '[data-testid=delete-world-w2]')).toBeNull();
  });

  it('renames an owned World from the Index, updating the list', () => {
    const fixture = render([world('w1', 'Aldermoor')]);
    const el = fixture.nativeElement as HTMLElement;

    ($(el, '[data-testid=rename-world-w1]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const input = $(el, '[data-testid=rename-world-input-w1]') as HTMLInputElement;
    input.value = 'The Reach of Aldermoor';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    const req = http.expectOne('/api/worlds/w1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ name: 'The Reach of Aldermoor' });
    req.flush({
      ...world('w1', 'The Reach of Aldermoor'),
      homeEntityId: 'home1',
      entityCount: 1,
    });
    fixture.detectChanges();

    expect($(el, '[data-testid=world-w1]')?.textContent).toContain(
      'The Reach of Aldermoor',
    );
  });

  it('opens a delete modal that shows the count of Entities to be destroyed', () => {
    const fixture = render([world('w1', 'Aldermoor')]);
    const el = fixture.nativeElement as HTMLElement;

    ($(el, '[data-testid=delete-world-w1]') as HTMLButtonElement).click();
    fixture.detectChanges();

    // The modal fetches the World's Detail for its entity count (#120).
    const req = http.expectOne('/api/worlds/w1');
    expect(req.request.method).toBe('GET');
    req.flush({
      ...world('w1', 'Aldermoor'),
      homeEntityId: 'home1',
      entityCount: 3,
    });
    fixture.detectChanges();

    expect($(el, '[data-testid=delete-modal]')).not.toBeNull();
    expect($(el, '[data-testid=delete-count]')?.textContent).toContain('3');
  });

  /** Open the delete modal for w1 and resolve its entity count. */
  function openDeleteModal(name: string, count = 2) {
    const fixture = render([world('w1', name)]);
    const el = fixture.nativeElement as HTMLElement;
    ($(el, '[data-testid=delete-world-w1]') as HTMLButtonElement).click();
    fixture.detectChanges();
    http.expectOne('/api/worlds/w1').flush({
      ...world('w1', name),
      homeEntityId: 'home1',
      entityCount: count,
    });
    fixture.detectChanges();
    return fixture;
  }

  it('enables Delete only once the typed name matches the World exactly', () => {
    const fixture = openDeleteModal('Aldermoor');
    const el = fixture.nativeElement as HTMLElement;
    // aria-disabled, not the native attribute, so the gated button stays focusable.
    const armed = () =>
      ($(el, '[data-testid=confirm-delete]') as HTMLButtonElement).getAttribute(
        'aria-disabled',
      ) === null;
    const input = $(el, '[data-testid=delete-confirm-input]') as HTMLInputElement;

    expect(armed()).toBe(false);

    input.value = 'Aldermor'; // typo → still locked
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(armed()).toBe(false);

    input.value = 'Aldermoor'; // exact match → armed
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(armed()).toBe(true);
  });

  it('deletes the World on confirm, removing it from the Index', () => {
    const fixture = openDeleteModal('Aldermoor');
    const el = fixture.nativeElement as HTMLElement;

    const input = $(el, '[data-testid=delete-confirm-input]') as HTMLInputElement;
    input.value = 'Aldermoor';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    ($(el, '[data-testid=confirm-delete]') as HTMLButtonElement).click();
    const req = http.expectOne('/api/worlds/w1');
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
    fixture.detectChanges();

    expect($(el, '[data-testid=world-w1]')).toBeNull();
    expect($(el, '[data-testid=delete-modal]')).toBeNull();
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

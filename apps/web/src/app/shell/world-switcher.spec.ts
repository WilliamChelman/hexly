import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { WorldSummary } from '@hexly/domain';
import { ToasterService } from '../core/services/toaster.service';
import { provideTranslocoTesting } from '../core/i18n/transloco-testing';
import { WorldSwitcher } from './world-switcher';

function world(id: string, name = id): WorldSummary {
  return { id, name, ownerId: 'u1', createdAt: 1, updatedAt: 1 };
}

describe('WorldSwitcher', () => {
  let http: HttpTestingController;
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [WorldSwitcher, provideTranslocoTesting()],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  /** Create the switcher and resolve its world list. */
  function render(worlds: WorldSummary[]) {
    const fixture = TestBed.createComponent(WorldSwitcher);
    fixture.detectChanges(); // load() -> GET /worlds
    http.expectOne('/api/worlds').flush(worlds);
    fixture.detectChanges();
    return fixture;
  }

  const select = (el: HTMLElement) =>
    el.querySelector('[data-testid=world-switcher]') as HTMLSelectElement;

  it('renders the caller’s worlds as options', () => {
    const el = render([world('w1', 'Aldermoor'), world('w2', 'Whisperwood')])
      .nativeElement as HTMLElement;

    const labels = Array.from(select(el).options).map((o) => o.textContent?.trim());
    expect(labels).toEqual(['Aldermoor', 'Whisperwood']);
  });

  it('navigates to the chosen World by URL (ADR-0028)', () => {
    const fixture = render([world('w1'), world('w2')]);

    const sel = select(fixture.nativeElement);
    sel.value = 'w2';
    sel.dispatchEvent(new Event('change'));

    expect(navigate).toHaveBeenCalledWith(['/w', 'w2', 'entities']);
  });

  it('creates a new world and navigates to its Home Entity', () => {
    const fixture = render([world('w1')]);

    (
      fixture.nativeElement.querySelector('[data-testid=new-world]') as HTMLButtonElement
    ).click();

    const req = http.expectOne('/api/worlds');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ name: 'Untitled world' });
    req.flush({ ...world('w2', 'Untitled world'), homeEntityId: 'home2' });

    expect(navigate).toHaveBeenCalledWith(['/w', 'w2', 'entities', 'home2']);
  });

  it('surfaces an error toast when world creation fails', () => {
    const fixture = render([world('w1')]);

    (
      fixture.nativeElement.querySelector('[data-testid=new-world]') as HTMLButtonElement
    ).click();
    http
      .expectOne('/api/worlds')
      .flush(null, { status: 500, statusText: 'Server Error' });

    expect(TestBed.inject(ToasterService).toasts().map((t) => t.tone)).toEqual([
      'error',
    ]);
  });
});

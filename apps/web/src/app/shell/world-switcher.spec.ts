import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { WorldSummary } from '@hexly/domain';
import { ActiveWorld } from '../core/services/active-world';
import { provideTranslocoTesting } from '../core/i18n/transloco-testing';
import { WorldSwitcher } from './world-switcher';

function world(id: string, name = id): WorldSummary {
  return { id, name, ownerId: 'u1', createdAt: 1, updatedAt: 1 };
}

describe('WorldSwitcher', () => {
  let http: HttpTestingController;
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WorldSwitcher, provideTranslocoTesting()],
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
  });

  afterEach(() => {
    http.verify();
    document
      .querySelectorAll('.cdk-overlay-container')
      .forEach((el) => el.remove());
  });

  /** Mount the switcher with the active World pinned and its world list resolved. */
  function render(
    worlds: WorldSummary[],
    activeId: string | null = null,
    expanded = true,
  ) {
    TestBed.inject(ActiveWorld).set(activeId);
    const fixture = TestBed.createComponent(WorldSwitcher);
    fixture.componentRef.setInput('expanded', expanded);
    fixture.detectChanges(); // load() -> GET /worlds
    http.expectOne('/api/worlds').flush(worlds);
    fixture.detectChanges();
    return fixture;
  }

  const trigger = (el: HTMLElement) =>
    el.querySelector('[data-testid=world-switcher]') as HTMLButtonElement;

  /** The CDK menu opens into the overlay container appended to <body>. */
  function open(fixture: ReturnType<typeof render>) {
    trigger(fixture.nativeElement).click();
    fixture.detectChanges();
  }
  const item = (testid: string) =>
    document.querySelector(`[data-testid="${testid}"]`) as HTMLElement;

  it('shows the active World’s name on the trigger', () => {
    const el = render(
      [world('w1', 'Aldermoor'), world('w2', 'Whisperwood')],
      'w2',
    ).nativeElement as HTMLElement;

    expect(trigger(el).textContent).toContain('Whisperwood');
  });

  it('navigates to a chosen World by URL (ADR-0028)', () => {
    const fixture = render(
      [world('w1', 'Aldermoor'), world('w2', 'Whisperwood')],
      'w1',
    );

    open(fixture);
    item('world-option-w2').click();

    expect(navigate).toHaveBeenCalledWith(['/w', 'w2', 'entities']);
  });

  it('offers a path to the World Index', () => {
    const fixture = render([world('w1', 'Aldermoor')], 'w1');

    open(fixture);

    expect(item('world-index-link').getAttribute('href')).toBe('/');
  });

  it('shows an initial chip when collapsed, with the full name for assistive tech', () => {
    const fixture = render([world('w1', 'Aldermoor')], 'w1', false);

    const chip = fixture.nativeElement.querySelector(
      '[data-testid=world-initial]',
    ) as HTMLElement;
    expect(chip.textContent?.trim()).toBe('A');
    expect(trigger(fixture.nativeElement).getAttribute('title')).toBe(
      'Aldermoor',
    );
  });

  it('falls back to a neutral label when no World is active (the Index)', () => {
    const el = render([world('w1', 'Aldermoor')], null)
      .nativeElement as HTMLElement;

    expect(trigger(el).textContent).toContain('Worlds');
  });
});

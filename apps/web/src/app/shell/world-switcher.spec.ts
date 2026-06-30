import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { WorldSummary } from '@hexly/domain';
import { ActiveWorld } from '../core/services/active-world';
import { AuthClient } from '../core/services/auth.client';
import { MockAuthClient } from '../core/testing/auth-client.mock';
import { WorldsClient } from '../core/services/worlds.client';
import { MockWorldsClient } from '../core/testing/worlds-client.mock';
import { provideTranslocoTesting } from '../core/i18n/transloco-testing';
import { WorldSwitcher } from './world-switcher';

function world(id: string, name = id): WorldSummary {
  return { id, name, ownerId: 'u1', createdAt: 1, updatedAt: 1 };
}

describe('WorldSwitcher', () => {
  let worldsClient: MockWorldsClient;
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    worldsClient = new MockWorldsClient();
    await TestBed.configureTestingModule({
      imports: [WorldSwitcher, provideTranslocoTesting()],
      providers: [
        provideRouter([]),
        { provide: AuthClient, useValue: new MockAuthClient() },
        { provide: WorldsClient, useValue: worldsClient },
      ],
    }).compileComponents();
    navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
  });

  afterEach(() => {
    document
      .querySelectorAll('.cdk-overlay-container')
      .forEach((el) => el.remove());
  });

  /**
   * Mount the switcher with the active World pinned and its world list resolved.
   * The list resolves via a Subject (not `of`) so the emission lands AFTER the
   * first detectChanges: WorldStore's user-change effect runs for the first time
   * on that tick and unconditionally resets its state, which would otherwise wipe
   * a synchronously-emitted load() result before it's ever rendered.
   */
  function render(
    worlds: WorldSummary[],
    activeId: string | null = null,
    expanded = true,
  ) {
    TestBed.inject(ActiveWorld).set(activeId);
    const list$ = new Subject<WorldSummary[]>();
    worldsClient.list.mockReturnValue(list$);
    const fixture = TestBed.createComponent(WorldSwitcher);
    fixture.componentRef.setInput('expanded', expanded);
    fixture.detectChanges(); // load() -> WorldStore.load()
    list$.next(worlds);
    list$.complete();
    fixture.detectChanges();
    return fixture;
  }

  const trigger = (el: HTMLElement) =>
    el.querySelector('[data-testid=switcher]') as HTMLButtonElement;

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
    item('switcher-option-w2').click();

    expect(navigate).toHaveBeenCalledWith(['/w', 'w2', 'entities']);
  });

  it('offers a path to the World Index', () => {
    const fixture = render([world('w1', 'Aldermoor')], 'w1');

    open(fixture);

    expect(item('switcher-index-link').getAttribute('href')).toBe('/');
  });

  it('shows an initial chip when collapsed, with the full name for assistive tech', () => {
    const fixture = render([world('w1', 'Aldermoor')], 'w1', false);

    const chip = fixture.nativeElement.querySelector(
      '[data-testid=switcher-initial]',
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

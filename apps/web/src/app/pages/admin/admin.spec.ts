import { provideTranslocoTesting } from '../../../testing/transloco-testing';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { ReindexJob } from '@hexly/domain';
import { AdminClient, ToasterService } from '@hexly/web-core';
import { MockAdminClient, reindexJob } from '@hexly/web-core/testing';
import { Admin } from './admin';

/** Matches the panel's own poll interval; one `tick` of it advances the walk by one poll. */
const POLL_MS = 1000;

/**
 * The Superadmin repair surface (ADR-0046): the Reindex. The route gates it to a Superadmin,
 * so the panel itself just drives the walk — it starts one, follows it by polling (the walk
 * outlives the request), and reports how it landed. These specs own the clock: `advance(POLL_MS)`
 * is one poll.
 */
describe('Admin panel (Reindex)', () => {
  let admin: MockAdminClient;
  let toaster: ToasterService;

  beforeEach(async () => {
    admin = new MockAdminClient();
    await TestBed.configureTestingModule({
      imports: [Admin, provideTranslocoTesting()],
      providers: [{ provide: AdminClient, useValue: admin }],
    }).compileComponents();
    toaster = TestBed.inject(ToasterService);
    vi.useFakeTimers();
  });

  afterEach(() => vi.useRealTimers());

  function render() {
    const fixture = TestBed.createComponent(Admin);
    fixture.detectChanges();
    return fixture;
  }

  const $ = (el: HTMLElement, sel: string) => el.querySelector(sel) as HTMLElement | null;

  /** Fire the next poll; the mocked response lands synchronously with it. */
  const advance = (ms: number) => vi.advanceTimersByTime(ms);

  const reindexButton = (el: HTMLElement) => $(el, '[data-testid="reindex"]') as HTMLButtonElement;

  /**
   * Script the job reads for a panel that loads with nothing running: the panel reads the job
   * once on load (idle, so the button is live), then `jobs` answer the polls in order. Without
   * that idle read the panel would rejoin a walk on load and refuse the click under test.
   */
  function loadsIdleThenPolls(...jobs: ReindexJob[]) {
    admin.reindexStatus.mockReturnValueOnce(of(reindexJob()));
    for (const job of jobs) admin.reindexStatus.mockReturnValueOnce(of(job));
  }

  it('offers the Reindex action', () => {
    const { nativeElement: el } = render();
    expect(reindexButton(el)).not.toBeNull();
  });

  /**
   * The count is the point: a Superadmin presses this to repair an instance, and the only
   * evidence it did anything is how many Entities it walked. The walk outlives its request, so
   * the count arrives on a poll rather than in the response that started it.
   */
  it('reindexes through the client and reports how many Entities were walked', () => {
    admin.reindex.mockReturnValue(of(reindexJob({ status: 'running', total: 412 })));
    loadsIdleThenPolls(
      reindexJob({
        status: 'succeeded',
        total: 412,
        walked: 412,
        reindexed: 412,
      }),
    );
    const { nativeElement: el } = render();

    reindexButton(el).click();
    advance(POLL_MS);

    expect(admin.reindex).toHaveBeenCalled();
    expect(toaster.toasts().some((t) => t.tone === 'success' && t.message.includes('412'))).toBe(true);
  });

  /** The button reports the walk's progress, and refuses a second press while it runs. */
  it('shows progress and stays disabled while the walk is running', () => {
    admin.reindex.mockReturnValue(of(reindexJob({ status: 'running', total: 412 })));
    loadsIdleThenPolls(reindexJob({ status: 'running', total: 412, walked: 200 }));
    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;

    reindexButton(el).click();
    advance(POLL_MS);
    fixture.detectChanges();

    expect(reindexButton(el).disabled).toBe(true);
    expect(reindexButton(el).textContent).toContain('200');
    expect(reindexButton(el).textContent).toContain('412');

    reindexButton(el).click(); // A second press while it walks is a no-op, not a second job.
    expect(admin.reindex).toHaveBeenCalledTimes(1);
  });

  /**
   * A document this build cannot parse is skipped, not fatal — so the toast has to say *both*
   * that the repair happened and that something in the instance still needs a human.
   */
  it('names the skipped Entities when the walk could not read every document', () => {
    admin.reindex.mockReturnValue(of(reindexJob({ status: 'running', total: 3 })));
    loadsIdleThenPolls(
      reindexJob({
        status: 'succeeded',
        total: 3,
        walked: 3,
        reindexed: 2,
        failures: [{ entityId: 'broken', worldId: 'w1', reason: 'Unexpected token' }],
      }),
    );
    const { nativeElement: el } = render();

    reindexButton(el).click();
    advance(POLL_MS);

    const toast = toaster.toasts().at(-1);
    expect(toast?.tone).toBe('error');
    expect(toast?.message).toContain('2'); // reindexed
    expect(toast?.message).toContain('1'); // skipped
  });

  /**
   * The API forgot the job — it restarted mid-walk, and job state does not survive that. The
   * chunks that committed stay committed, so this is "press again to resume", never "done".
   */
  it('does not read a forgotten job as a successful walk', () => {
    admin.reindex.mockReturnValue(of(reindexJob({ status: 'running', total: 9 })));
    loadsIdleThenPolls(reindexJob({ status: 'idle' }));
    const { nativeElement: el } = render();

    reindexButton(el).click();
    advance(POLL_MS);

    expect(toaster.toasts().at(-1)?.tone).toBe('error');
    expect(toaster.toasts().some((t) => t.tone === 'success')).toBe(false);
  });

  /** A walk that aborted mid-flight says so, and re-arms the button. */
  it('reports a walk that aborted, and frees the button', () => {
    admin.reindex.mockReturnValue(of(reindexJob({ status: 'running', total: 3 })));
    loadsIdleThenPolls(reindexJob({ status: 'failed', error: 'database is locked' }));
    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;

    reindexButton(el).click();
    advance(POLL_MS);
    fixture.detectChanges();

    expect(toaster.toasts().at(-1)?.tone).toBe('error');
    expect(reindexButton(el).disabled).toBe(false);
  });

  /**
   * The job lives on the server, not in this page. A Superadmin who opens the panel while a walk
   * is already running rejoins it — rather than being offered a button that would 409.
   */
  it('rejoins a walk that was already running when the panel loaded', () => {
    admin.reindexStatus.mockReturnValueOnce(of(reindexJob({ status: 'running', total: 9, walked: 4 }))).mockReturnValue(
      of(
        reindexJob({
          status: 'succeeded',
          total: 9,
          walked: 9,
          reindexed: 9,
        }),
      ),
    );
    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;

    fixture.detectChanges();
    expect(reindexButton(el).disabled).toBe(true);
    expect(admin.reindex).not.toHaveBeenCalled(); // It rejoined; it did not start one.

    advance(POLL_MS);
    expect(toaster.toasts().some((t) => t.tone === 'success' && t.message.includes('9'))).toBe(true);
  });

  /** Two operators, one instance: the server refuses the second walk, and the panel says why. */
  it('surfaces the structured refusal when a reindex is already running', () => {
    admin.reindex.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { code: 'reindex-running' },
          }),
      ),
    );
    const { nativeElement: el } = render();

    reindexButton(el).click();

    const toast = toaster.toasts().at(-1);
    expect(toast?.tone).toBe('error');
    expect(toast?.message).toContain('already running');
  });
});

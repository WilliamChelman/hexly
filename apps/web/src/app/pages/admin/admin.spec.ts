import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { AdminUser, ReindexJob } from '@hexly/domain';
import { AdminClient, AuthClient, ToasterService } from '@hexly/web-core';
import {
  MockAdminClient,
  MockAuthClient,
  provideTranslocoTesting,
  reindexJob,
} from '@hexly/web-core/testing';
import { Admin } from './admin';

/** Matches the panel's own poll interval; one `tick` of it advances the walk by one poll. */
const POLL_MS = 1000;

/**
 * The Instance Admin panel (ADR-0037, #163): asserts the observable behaviour — the
 * accounts render with their tier badges, the Superadmin-only control shows only for a
 * Superadmin, the mutations call the client and reload, and a server refusal (409) leaves
 * an error toast. The server stays the source of truth; this covers the panel's wiring.
 */
describe('Admin panel', () => {
  let admin: MockAdminClient;
  let auth: MockAuthClient;
  let toaster: ToasterService;

  const bob: AdminUser = {
    id: 'u2',
    email: 'bob@hexly.test',
    displayName: 'Bob',
    isAdmin: false,
    isSuperadmin: false,
    canCreateWorlds: true,
    disabledAt: null,
  };

  beforeEach(async () => {
    admin = new MockAdminClient();
    auth = new MockAuthClient();
    await TestBed.configureTestingModule({
      imports: [Admin, provideTranslocoTesting()],
      providers: [
        { provide: AdminClient, useValue: admin },
        { provide: AuthClient, useValue: auth },
      ],
    }).compileComponents();
    toaster = TestBed.inject(ToasterService);
    // The caller is an Instance Admin (not a Superadmin) unless a test says otherwise.
    auth.setUser({ id: 'u1', email: 'ada@hexly.test', displayName: 'Ada', preferences: {}, isAdmin: true, isSuperadmin: false, canCreateWorlds: true });
  });

  function render(users: AdminUser[]) {
    admin.list.mockReturnValue(of(users));
    const fixture = TestBed.createComponent(Admin);
    fixture.detectChanges();
    return fixture;
  }

  const $ = (el: HTMLElement, sel: string) => el.querySelector(sel) as HTMLElement | null;

  /** Re-seat the caller as the operator's in-app self, who alone sees the repair tier. */
  function asSuperadmin() {
    auth.setUser({ id: 'u1', email: 'root@hexly.test', displayName: 'Root', preferences: {}, isAdmin: false, isSuperadmin: true, canCreateWorlds: true });
  }

  it('lists each account with its email, capability state, and status', () => {
    const { nativeElement: el } = render([
      { ...bob, isAdmin: true, disabledAt: 123 },
    ]);
    const row = $(el, '[data-testid="user-u2"]');
    expect(row?.textContent).toContain('Bob');
    expect(row?.textContent).toContain('bob@hexly.test');
    // The Admin capability toggle reads as pressed; the row shows the Disabled status.
    expect($(el, '[data-testid="admin-u2"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(row?.textContent).toContain('Disabled');
  });

  it('filters the roster by name or email', () => {
    const fixture = render([
      bob,
      { ...bob, id: 'u3', displayName: 'Carol', email: 'carol@hexly.test' },
    ]);
    const el = fixture.nativeElement as HTMLElement;
    const search = $(el, '[data-testid="filter"]') as HTMLInputElement;
    search.value = 'carol';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect($(el, '[data-testid="user-u3"]')).not.toBeNull();
    expect($(el, '[data-testid="user-u2"]')).toBeNull();
  });

  it('hides the Superadmin toggle from a plain Instance Admin', () => {
    const { nativeElement: el } = render([bob]);
    expect($(el, '[data-testid="superadmin-u2"]')).toBeNull();
  });

  it('shows the Superadmin toggle to a Superadmin', () => {
    auth.setUser({ id: 'u1', email: 'root@hexly.test', displayName: 'Root', preferences: {}, isAdmin: false, isSuperadmin: true, canCreateWorlds: true });
    const { nativeElement: el } = render([bob]);
    expect($(el, '[data-testid="superadmin-u2"]')).not.toBeNull();
  });

  /**
   * Reindex is a repair action on content (ADR-0046), so it belongs to the Superadmin — the
   * tier outside the collaboration model — and not to the Instance Admin, whose powers stop at
   * accounts. The server refuses an Admin with a 403; the panel does not offer them the button.
   *
   * The walk outlives the request that starts it, so the panel follows it by polling. These specs
   * own the clock: `advance(POLL_MS)` is one poll.
   */
  describe('Reindex (ADR-0046)', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    /** Fire the next poll; the mocked response lands synchronously with it. */
    const advance = (ms: number) => vi.advanceTimersByTime(ms);

    const reindexButton = (el: HTMLElement) =>
      $(el, '[data-testid="reindex"]') as HTMLButtonElement;

    /**
     * Script the job reads for a panel that loads with nothing running: the panel reads the job
     * once on load (idle, so the button is live), then `jobs` answer the polls in order. Without
     * that idle read the panel would rejoin a walk on load and refuse the click under test.
     */
    function loadsIdleThenPolls(...jobs: ReindexJob[]) {
      admin.reindexStatus.mockReturnValueOnce(of(reindexJob()));
      for (const job of jobs) admin.reindexStatus.mockReturnValueOnce(of(job));
    }

    it('hides the Reindex action from a plain Instance Admin', () => {
      const { nativeElement: el } = render([bob]);
      expect($(el, '[data-testid="reindex"]')).toBeNull();
    });

    it('offers the Reindex action to a Superadmin', () => {
      asSuperadmin();
      const { nativeElement: el } = render([bob]);
      expect($(el, '[data-testid="reindex"]')).not.toBeNull();
    });

    /**
     * The count is the point: a Superadmin presses this to repair an instance, and the only
     * evidence it did anything is how many Entities it walked. The walk outlives its request, so
     * the count arrives on a poll rather than in the response that started it.
     */
    it('reindexes through the client and reports how many Entities were walked', () => {
      asSuperadmin();
      admin.reindex.mockReturnValue(of(reindexJob({ status: 'running', total: 412 })));
      loadsIdleThenPolls(
        reindexJob({ status: 'succeeded', total: 412, walked: 412, reindexed: 412 }),
      );
      const { nativeElement: el } = render([bob]);

      reindexButton(el).click();
      advance(POLL_MS);

      expect(admin.reindex).toHaveBeenCalled();
      expect(toaster.toasts().some((t) => t.tone === 'success' && t.message.includes('412'))).toBe(
        true,
      );
    });

    /** The button reports the walk's progress, and refuses a second press while it runs. */
    it('shows progress and stays disabled while the walk is running', () => {
      asSuperadmin();
      admin.reindex.mockReturnValue(of(reindexJob({ status: 'running', total: 412 })));
      loadsIdleThenPolls(reindexJob({ status: 'running', total: 412, walked: 200 }));
      const fixture = render([bob]);
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
      asSuperadmin();
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
      const { nativeElement: el } = render([bob]);

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
      asSuperadmin();
      admin.reindex.mockReturnValue(of(reindexJob({ status: 'running', total: 9 })));
      loadsIdleThenPolls(reindexJob({ status: 'idle' }));
      const { nativeElement: el } = render([bob]);

      reindexButton(el).click();
      advance(POLL_MS);

      expect(toaster.toasts().at(-1)?.tone).toBe('error');
      expect(toaster.toasts().some((t) => t.tone === 'success')).toBe(false);
    });

    /** A walk that aborted mid-flight says so, and re-arms the button. */
    it('reports a walk that aborted, and frees the button', () => {
      asSuperadmin();
      admin.reindex.mockReturnValue(of(reindexJob({ status: 'running', total: 3 })));
      loadsIdleThenPolls(reindexJob({ status: 'failed', error: 'database is locked' }));
      const fixture = render([bob]);
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
      asSuperadmin();
      admin.reindexStatus
        .mockReturnValueOnce(of(reindexJob({ status: 'running', total: 9, walked: 4 })))
        .mockReturnValue(
          of(reindexJob({ status: 'succeeded', total: 9, walked: 9, reindexed: 9 })),
        );
      const fixture = render([bob]);
      const el = fixture.nativeElement as HTMLElement;

      fixture.detectChanges();
      expect(reindexButton(el).disabled).toBe(true);
      expect(admin.reindex).not.toHaveBeenCalled(); // It rejoined; it did not start one.

      advance(POLL_MS);
      expect(toaster.toasts().some((t) => t.tone === 'success' && t.message.includes('9'))).toBe(
        true,
      );
    });

    /** Two operators, one instance: the server refuses the second walk, and the panel says why. */
    it('surfaces the structured refusal when a reindex is already running', () => {
      asSuperadmin();
      admin.reindex.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'reindex-running' } })),
      );
      const { nativeElement: el } = render([bob]);

      reindexButton(el).click();

      const toast = toaster.toasts().at(-1);
      expect(toast?.tone).toBe('error');
      expect(toast?.message).toContain('already running');
    });
  });

  it('creates a user and reloads the list', () => {
    const fixture = render([]);
    const el = fixture.nativeElement as HTMLElement;
    const set = (sel: string, value: string) => {
      const input = $(el, sel) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    set('[data-testid="new-name"]', 'Bob');
    set('[data-testid="new-email"]', 'bob@hexly.test');
    set('[data-testid="new-password"]', 'a strong secret');
    fixture.detectChanges();

    ($(el, '[data-testid="create-user"]') as HTMLButtonElement).click();

    expect(admin.createUser).toHaveBeenCalledWith({
      displayName: 'Bob',
      email: 'bob@hexly.test',
      password: 'a strong secret',
    });
    // Initial load + reload after create.
    expect(admin.list).toHaveBeenCalledTimes(2);
  });

  it('toggles the World Creation capability through the client (ADR-0040)', () => {
    // Bob already holds it, so the toggle revokes.
    const { nativeElement: el } = render([bob]);
    ($(el, '[data-testid="world-creation-u2"]') as HTMLButtonElement).click();
    expect(admin.setCanCreateWorlds).toHaveBeenCalledWith('u2', false);
  });

  it('deletes a user through the client', () => {
    // Suppress the confirm() gate for the test.
    vi.stubGlobal('confirm', () => true);
    const { nativeElement: el } = render([bob]);
    ($(el, '[data-testid="delete-u2"]') as HTMLButtonElement).click();
    expect(admin.deleteUser).toHaveBeenCalledWith('u2');
    vi.unstubAllGlobals();
  });

  it('surfaces a server refusal (409) as an error toast, leaving the list', () => {
    vi.stubGlobal('confirm', () => true);
    admin.deleteUser.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 409 })),
    );
    const { nativeElement: el } = render([bob]);
    ($(el, '[data-testid="delete-u2"]') as HTMLButtonElement).click();
    expect(toaster.toasts().some((t) => t.tone === 'error')).toBe(true);
    vi.unstubAllGlobals();
  });
});

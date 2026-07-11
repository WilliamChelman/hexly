import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { UserAccount } from '@hexly/domain';
import { UsersClient, AuthClient, ToasterService } from '@hexly/web-core';
import { MockUsersClient, MockAuthClient, provideTranslocoTesting } from '@hexly/web-core/testing';
import { Users } from './users';

/**
 * The user-management panel (ADR-0047): asserts the observable behaviour — the accounts
 * render with their role state, the Superadmin-only control shows only for a Superadmin, the
 * mutations call the client and reload, and a server refusal (409) leaves an error toast. The
 * server stays the source of truth; this covers the panel's wiring.
 */
describe('Users panel', () => {
  let users: MockUsersClient;
  let auth: MockAuthClient;
  let toaster: ToasterService;

  const bob: UserAccount = {
    id: 'u2',
    email: 'bob@hexly.test',
    displayName: 'Bob',
    roles: ['create-worlds'],
    isSuperadmin: false,
    disabledAt: null,
  };

  beforeEach(async () => {
    users = new MockUsersClient();
    auth = new MockAuthClient();
    await TestBed.configureTestingModule({
      imports: [Users, provideTranslocoTesting()],
      providers: [
        { provide: UsersClient, useValue: users },
        { provide: AuthClient, useValue: auth },
      ],
    }).compileComponents();
    toaster = TestBed.inject(ToasterService);
    // The caller holds manage-users (not Superadmin) unless a test says otherwise.
    auth.setUser({
      id: 'u1',
      email: 'ada@hexly.test',
      displayName: 'Ada',
      preferences: {},
      roles: ['manage-users'],
      isSuperadmin: false,
    });
  });

  function render(accounts: UserAccount[]) {
    users.list.mockReturnValue(of(accounts));
    const fixture = TestBed.createComponent(Users);
    fixture.detectChanges();
    return fixture;
  }

  const $ = (el: HTMLElement, sel: string) => el.querySelector(sel) as HTMLElement | null;

  /** Re-seat the caller as the operator's in-app self, who alone sees the Superadmin controls. */
  function asSuperadmin() {
    auth.setUser({
      id: 'u1',
      email: 'root@hexly.test',
      displayName: 'Root',
      preferences: {},
      roles: [],
      isSuperadmin: true,
    });
  }

  it('lists each account with its email, role state, and status', () => {
    const { nativeElement: el } = render([{ ...bob, roles: ['manage-users', 'create-worlds'], disabledAt: 123 }]);
    const row = $(el, '[data-testid="user-u2"]');
    expect(row?.textContent).toContain('Bob');
    expect(row?.textContent).toContain('bob@hexly.test');
    // The manage-users role toggle reads as pressed; the row shows the Disabled status.
    expect($(el, '[data-testid="role-manage-users-u2"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(row?.textContent).toContain('Disabled');
  });

  it('filters the roster by name or email', () => {
    const fixture = render([bob, { ...bob, id: 'u3', displayName: 'Carol', email: 'carol@hexly.test' }]);
    const el = fixture.nativeElement as HTMLElement;
    const search = $(el, '[data-testid="filter"]') as HTMLInputElement;
    search.value = 'carol';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect($(el, '[data-testid="user-u3"]')).not.toBeNull();
    expect($(el, '[data-testid="user-u2"]')).toBeNull();
  });

  it('hides the Superadmin toggle from a plain user manager', () => {
    const { nativeElement: el } = render([bob]);
    expect($(el, '[data-testid="superadmin-u2"]')).toBeNull();
  });

  it('shows the Superadmin toggle to a Superadmin', () => {
    asSuperadmin();
    const { nativeElement: el } = render([bob]);
    expect($(el, '[data-testid="superadmin-u2"]')).not.toBeNull();
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

    expect(users.createUser).toHaveBeenCalledWith({
      displayName: 'Bob',
      email: 'bob@hexly.test',
      password: 'a strong secret',
    });
    // Initial load + reload after create.
    expect(users.list).toHaveBeenCalledTimes(2);
  });

  it('grants the manage-users role by adding it to the account’s set (ADR-0047)', () => {
    // Bob holds only create-worlds, so the toggle grants manage-users alongside it.
    const { nativeElement: el } = render([bob]);
    ($(el, '[data-testid="role-manage-users-u2"]') as HTMLButtonElement).click();
    expect(users.setRoles).toHaveBeenCalledWith('u2', ['create-worlds', 'manage-users']);
  });

  it('revokes the create-worlds role by removing it from the set (ADR-0047)', () => {
    // Bob already holds create-worlds, so the toggle revokes it, leaving an empty set.
    const { nativeElement: el } = render([bob]);
    ($(el, '[data-testid="role-create-worlds-u2"]') as HTMLButtonElement).click();
    expect(users.setRoles).toHaveBeenCalledWith('u2', []);
  });

  it('deletes a user through the client', () => {
    // Suppress the confirm() gate for the test.
    vi.stubGlobal('confirm', () => true);
    const { nativeElement: el } = render([bob]);
    ($(el, '[data-testid="delete-u2"]') as HTMLButtonElement).click();
    expect(users.deleteUser).toHaveBeenCalledWith('u2');
    vi.unstubAllGlobals();
  });

  it('surfaces a server refusal (409) as an error toast, leaving the list', () => {
    vi.stubGlobal('confirm', () => true);
    users.deleteUser.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409 })));
    const { nativeElement: el } = render([bob]);
    ($(el, '[data-testid="delete-u2"]') as HTMLButtonElement).click();
    expect(toaster.toasts().some((t) => t.tone === 'error')).toBe(true);
    vi.unstubAllGlobals();
  });
});

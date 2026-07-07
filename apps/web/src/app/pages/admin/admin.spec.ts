import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { AdminUser } from '@hexly/domain';
import { AdminClient, AuthClient, ToasterService } from '@hexly/web-core';
import { MockAdminClient, MockAuthClient, provideTranslocoTesting } from '@hexly/web-core/testing';
import { Admin } from './admin';

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

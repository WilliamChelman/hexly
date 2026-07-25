import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { INSTANCE_ROLES, InstanceRole } from '@hexly/domain';
import { AuthClient, ClientConfigStore } from '@hexly/web-core';
import { MockAuthClient, mockClientConfigStore } from '@hexly/web-core/testing';
import { CommandDirectory } from '@hexly/command-palette-web';
import { GO_TO_WORLDS, NavCommands } from './nav-commands';

describe('NavCommands', () => {
  let provider: NavCommands;
  let auth: MockAuthClient;
  let collaboration: ReturnType<typeof signal<boolean>>;

  beforeEach(() => {
    auth = new MockAuthClient();
    collaboration = signal(true);
    TestBed.configureTestingModule({
      imports: [provideTranslocoTesting()],
      providers: [
        provideRouter([]),
        { provide: AuthClient, useValue: auth },
        { provide: ClientConfigStore, useValue: mockClientConfigStore({ collaboration }) },
      ],
    });
    provider = TestBed.inject(NavCommands);
  });

  function signIn(roles: InstanceRole[], isSuperadmin = false): void {
    auth.setUser({
      id: 'u1',
      email: 'a@hexly.test',
      displayName: 'Ada',
      preferences: {},
      roles,
      isSuperadmin,
    });
  }

  it('answers the > (Show Commands) prefix', () => {
    expect(provider.prefix).toBe('>');
  });

  it('offers Go to Users and Go to Styleguide to a user manager', async () => {
    signIn(['manage-users']);
    const commands = await firstValueFrom(provider.search(''));
    expect(commands.map((c) => c.id)).toEqual(['go-worlds', 'go-users', 'go-styleguide']);
  });

  it('offers Go to Admin only to a Superadmin', async () => {
    signIn([], true);
    const commands = await firstValueFrom(provider.search(''));
    // A Superadmin can manage users too, so Users comes along with the repair surface.
    expect(commands.map((c) => c.id)).toEqual(['go-worlds', 'go-users', 'go-admin', 'go-styleguide']);
  });

  it('hides the instance destinations from a caller with neither power', async () => {
    signIn([]);
    const commands = await firstValueFrom(provider.search(''));
    // Worlds and the Styleguide need no power at all; the instance destinations do.
    expect(commands.map((c) => c.id)).toEqual(['go-worlds', 'go-styleguide']);
  });

  it('drops Go to Users once Collaboration is off, keeping the repair surface', async () => {
    // The Sole User's shape (ADR-0071): Superadmin and every Instance Role, so both role checks read
    // true. Only the flag can cut Users — and it must not cut the Reindex with it.
    signIn([...INSTANCE_ROLES], true);
    collaboration.set(false);
    const commands = await firstValueFrom(provider.search(''));
    expect(commands.map((c) => c.id)).toEqual(['go-worlds', 'go-admin', 'go-styleguide']);
  });

  it('carries the route so the row is an openable anchor', async () => {
    signIn(['manage-users']);
    const [users] = await firstValueFrom(provider.search('users'));
    expect(users.route).toEqual(['/users']);
  });

  it("offers Worlds by id too, so the native menu runs the Palette's own Command", async () => {
    signIn([]);
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const [worlds] = await firstValueFrom(provider.search('worlds'));

    // The same object the Palette lists, reached the way a menu click reaches it (ADR-0070).
    expect(TestBed.inject(CommandDirectory).invoke(GO_TO_WORLDS)).toBe(true);
    expect(nav).toHaveBeenCalledWith(['/worlds']);
    expect(worlds.id).toBe(GO_TO_WORLDS);
  });

  it("re-resolves a held Command's label after a language switch", async () => {
    // Worlds is built once and held for the Directory (ADR-0070), so a frozen label would both read in the
    // old language and stop matching what the user types.
    signIn([]);
    TestBed.inject(TranslocoService).setActiveLang('fr');

    const commands = await firstValueFrom(provider.search('mondes'));

    expect(commands.map((c) => c.id)).toEqual([GO_TO_WORLDS]);
    expect(commands[0].label).toBe('Aller aux mondes');
  });

  it('navigates when a command runs', async () => {
    signIn(['manage-users']);
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const [users] = await firstValueFrom(provider.search('users'));
    users.run();
    expect(nav).toHaveBeenCalledWith(['/users']);
  });
});

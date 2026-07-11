import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { InstanceRole } from '@hexly/domain';
import { AuthClient } from '@hexly/web-core';
import { MockAuthClient, provideTranslocoTesting } from '@hexly/web-core/testing';
import { NavCommands } from './nav-commands';

describe('NavCommands', () => {
  let provider: NavCommands;
  let auth: MockAuthClient;

  beforeEach(() => {
    auth = new MockAuthClient();
    TestBed.configureTestingModule({
      imports: [provideTranslocoTesting()],
      providers: [provideRouter([]), { provide: AuthClient, useValue: auth }],
    });
    provider = TestBed.inject(NavCommands);
  });

  function signIn(roles: InstanceRole[], isSuperadmin = false): void {
    auth.setUser({
      id: 'u1', email: 'a@hexly.test', displayName: 'Ada', preferences: {},
      roles, isSuperadmin,
    });
  }

  it('answers the > (Show Commands) prefix', () => {
    expect(provider.prefix).toBe('>');
  });

  it('offers Go to Users and Go to Styleguide to a user manager', async () => {
    signIn(['manage-users']);
    const commands = await firstValueFrom(provider.search(''));
    expect(commands.map((c) => c.id)).toEqual(['go-users', 'go-styleguide']);
  });

  it('offers Go to Admin only to a Superadmin', async () => {
    signIn([], true);
    const commands = await firstValueFrom(provider.search(''));
    // A Superadmin can manage users too, so Users comes along with the repair surface.
    expect(commands.map((c) => c.id)).toEqual(['go-users', 'go-admin', 'go-styleguide']);
  });

  it('hides the instance destinations from a caller with neither power', async () => {
    signIn([]);
    const commands = await firstValueFrom(provider.search(''));
    expect(commands.map((c) => c.id)).toEqual(['go-styleguide']);
  });

  it('carries the route so the row is an openable anchor', async () => {
    signIn(['manage-users']);
    const [users] = await firstValueFrom(provider.search('users'));
    expect(users.route).toEqual(['/users']);
  });

  it('navigates when a command runs', async () => {
    signIn(['manage-users']);
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const [users] = await firstValueFrom(provider.search('users'));
    users.run();
    expect(nav).toHaveBeenCalledWith(['/users']);
  });
});

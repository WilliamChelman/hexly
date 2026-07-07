import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
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

  function signIn(admin: boolean): void {
    auth.setUser({
      id: 'u1', email: 'a@hexly.test', displayName: 'Ada', preferences: {},
      isAdmin: admin, isSuperadmin: false, canCreateWorlds: true,
    });
  }

  it('answers the > (Show Commands) prefix', () => {
    expect(provider.prefix).toBe('>');
  });

  it('offers Go to Admin and Go to Styleguide to an admin', async () => {
    signIn(true);
    const commands = await firstValueFrom(provider.search(''));
    expect(commands.map((c) => c.id)).toEqual(['go-admin', 'go-styleguide']);
  });

  it('hides Go to Admin from a caller who cannot administer', async () => {
    signIn(false);
    const commands = await firstValueFrom(provider.search(''));
    expect(commands.map((c) => c.id)).toEqual(['go-styleguide']);
  });

  it('carries the route so the row is an openable anchor', async () => {
    signIn(true);
    const [admin] = await firstValueFrom(provider.search('admin'));
    expect(admin.route).toEqual(['/admin']);
  });

  it('navigates when a command runs', async () => {
    signIn(true);
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const [admin] = await firstValueFrom(provider.search('admin'));
    admin.run();
    expect(nav).toHaveBeenCalledWith(['/admin']);
  });
});

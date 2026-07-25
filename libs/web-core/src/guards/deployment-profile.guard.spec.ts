import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, CanActivateFn, RouterStateSnapshot, UrlTree } from '@angular/router';
import { DeploymentProfile } from '@hexly/domain';
import { desktopProfileGuard, serverProfileGuard } from './deployment-profile.guard';
import { ClientConfigStore } from '../services/client-config.store';
import { mockClientConfigStore } from '../testing/client-config-store.mock';

function run(guard: CanActivateFn, profile: DeploymentProfile, url: string) {
  TestBed.configureTestingModule({
    providers: [{ provide: ClientConfigStore, useValue: mockClientConfigStore({ profile: signal(profile) }) }],
  });
  return TestBed.runInInjectionContext(() => guard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot));
}

describe('serverProfileGuard', () => {
  it('lets /login through in the server profile', () => {
    expect(run(serverProfileGuard, 'server', '/login')).toBe(true);
  });

  it('bounces to the root in the desktop profile, where there is no password to type', () => {
    const value = run(serverProfileGuard, 'desktop', '/login');
    expect(value).toBeInstanceOf(UrlTree);
    expect((value as UrlTree).toString()).toBe('/');
  });
});

describe('desktopProfileGuard', () => {
  it('lets the unrecoverable-session page through in the desktop profile', () => {
    expect(run(desktopProfileGuard, 'desktop', '/session-error')).toBe(true);
  });

  it('bounces to the root in the server profile, which has a login page instead', () => {
    const value = run(desktopProfileGuard, 'server', '/session-error');
    expect(value).toBeInstanceOf(UrlTree);
    expect((value as UrlTree).toString()).toBe('/');
  });
});

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree } from '@angular/router';
import { collaborationGuard } from './collaboration.guard';
import { ClientConfigStore } from '../services/client-config.store';
import { mockClientConfigStore } from '../testing/client-config-store.mock';

describe('collaborationGuard', () => {
  function guard(collaboration: boolean) {
    TestBed.configureTestingModule({
      providers: [
        { provide: ClientConfigStore, useValue: mockClientConfigStore({ collaboration: signal(collaboration) }) },
      ],
    });
    return TestBed.runInInjectionContext(() =>
      collaborationGuard({} as ActivatedRouteSnapshot, { url: '/users' } as RouterStateSnapshot),
    );
  }

  it('lets a route through while Collaboration is on', () => {
    expect(guard(true)).toBe(true);
  });

  it('bounces to the root once Collaboration is off', () => {
    const value = guard(false);
    expect(value).toBeInstanceOf(UrlTree);
    expect((value as UrlTree).toString()).toBe('/');
  });
});

import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { WorldsClient } from '../../core/services/worlds.client';
import { MockWorldsClient } from '../../core/testing/worlds-client.mock';
import { EntitiesClient } from '../../core/services/entities.client';
import { MockEntitiesClient } from '../../core/testing/entities-client.mock';
import { UsersClient } from '../../core/services/users.client';
import { MockUsersClient } from '../../core/testing/users-client.mock';
import { AuthClient } from '../../core/services/auth.client';
import { MockAuthClient } from '../../core/testing/auth-client.mock';
import { ActiveWorld } from '../../core/services/active-world';
import { provideTranslocoTesting } from '../../core/i18n/transloco-testing';
import { OwnerSet } from '../../ui/owner-set';
import { WorldSettings } from './world-settings';

describe('WorldSettings', () => {
  let worlds: MockWorldsClient;

  beforeEach(async () => {
    worlds = new MockWorldsClient();
    worlds.owners.mockReturnValue(of([]));
    await TestBed.configureTestingModule({
      imports: [WorldSettings, provideTranslocoTesting()],
      providers: [
        provideRouter([]),
        { provide: WorldsClient, useValue: worlds },
        { provide: EntitiesClient, useValue: new MockEntitiesClient() },
        { provide: UsersClient, useValue: new MockUsersClient() },
        { provide: AuthClient, useValue: new MockAuthClient() },
      ],
    }).compileComponents();
    TestBed.inject(ActiveWorld).set('w1');
  });

  it('renders the World owner set for the active World', () => {
    const fixture = TestBed.createComponent(WorldSettings);
    fixture.detectChanges();

    const set = fixture.debugElement.query(By.directive(OwnerSet)).componentInstance as OwnerSet;
    expect(set.kind()).toBe('world');
    expect(set.id()).toBe('w1');
  });

  it('leaves for the World Index once the user resigns', () => {
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    const fixture = TestBed.createComponent(WorldSettings);
    fixture.detectChanges();

    const set = fixture.debugElement.query(By.directive(OwnerSet)).componentInstance as OwnerSet;
    set.resigned.emit();

    expect(navigate).toHaveBeenCalledWith(['/']);
  });
});

import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { WorldsClient, EntitiesClient, UserDirectoryClient, AuthClient, ActiveWorld } from '@hexly/web-core';
import {
  MockWorldsClient,
  MockEntitiesClient,
  MockUserDirectoryClient,
  MockAuthClient,
  provideTranslocoTesting,
} from '@hexly/web-core/testing';
import { OwnerSet } from '@hexly/web-ui';
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
        {
          provide: UserDirectoryClient,
          useValue: new MockUserDirectoryClient(),
        },
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
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(WorldSettings);
    fixture.detectChanges();

    const set = fixture.debugElement.query(By.directive(OwnerSet)).componentInstance as OwnerSet;
    set.resigned.emit();

    expect(navigate).toHaveBeenCalledWith(['/']);
  });
});

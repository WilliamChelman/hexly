import { provideTranslocoTesting } from '../../../../../testing/transloco-testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import {
  WorldsClient,
  EntitiesClient,
  UserDirectoryClient,
  AuthClient,
  ActiveWorld,
  ClientConfigStore,
} from '@hexly/web-core';
import {
  MockWorldsClient,
  MockEntitiesClient,
  MockUserDirectoryClient,
  MockAuthClient,
  mockClientConfigStore,
} from '@hexly/web-core/testing';
import { OwnerSetComponent, MemberSetComponent, PublicLinkComponent } from '@hexly/web-entity';
import { WorldSettingsPage } from './world-settings.page';

describe('WorldSettings', () => {
  let worlds: MockWorldsClient;
  let collaboration: ReturnType<typeof signal<boolean>>;

  beforeEach(async () => {
    worlds = new MockWorldsClient();
    worlds.owners.mockReturnValue(of([]));
    collaboration = signal(true);
    await TestBed.configureTestingModule({
      imports: [WorldSettingsPage, provideTranslocoTesting()],
      providers: [
        provideRouter([]),
        { provide: WorldsClient, useValue: worlds },
        { provide: EntitiesClient, useValue: new MockEntitiesClient() },
        {
          provide: UserDirectoryClient,
          useValue: new MockUserDirectoryClient(),
        },
        { provide: AuthClient, useValue: new MockAuthClient() },
        { provide: ClientConfigStore, useValue: mockClientConfigStore({ collaboration }) },
      ],
    }).compileComponents();
    TestBed.inject(ActiveWorld).set('w1');
  });

  it('renders the World owner set for the active World', () => {
    const fixture = TestBed.createComponent(WorldSettingsPage);
    fixture.detectChanges();

    const set = fixture.debugElement.query(By.directive(OwnerSetComponent)).componentInstance as OwnerSetComponent;
    expect(set.kind()).toBe('world');
    expect(set.id()).toBe('w1');
  });

  it('with Collaboration off carries no owner set, member set or World Public Link', () => {
    collaboration.set(false);
    const fixture = TestBed.createComponent(WorldSettingsPage);
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.directive(OwnerSetComponent))).toBeNull();
    expect(fixture.debugElement.query(By.directive(MemberSetComponent))).toBeNull();
    expect(fixture.debugElement.query(By.directive(PublicLinkComponent))).toBeNull();
  });

  it('with Collaboration off offers only the schema and imports sections, opening on schema', () => {
    collaboration.set(false);
    const fixture = TestBed.createComponent(WorldSettingsPage);
    fixture.detectChanges();

    const sections = [...fixture.nativeElement.querySelectorAll('[data-testid^="settings-nav-"]')].map(
      (el) => (el as HTMLElement).dataset['testid'],
    );
    expect(sections).toEqual(['settings-nav-schema', 'settings-nav-imports']);
    // The cut sections cannot stay selected, so the page opens on the first one that survives.
    expect(fixture.nativeElement.querySelector('app-world-types')).not.toBeNull();
  });

  it('leaves for the World Index once the user resigns', () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(WorldSettingsPage);
    fixture.detectChanges();

    const set = fixture.debugElement.query(By.directive(OwnerSetComponent)).componentInstance as OwnerSetComponent;
    set.resigned.emit();

    expect(navigate).toHaveBeenCalledWith(['/']);
  });
});

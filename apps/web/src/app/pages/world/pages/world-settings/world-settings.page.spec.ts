import { provideTranslocoTesting } from '../../../../../testing/transloco-testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { WorldDetail, WorldVerb } from '@hexly/domain';
import {
  WorldsClient,
  EntitiesClient,
  UserDirectoryClient,
  AuthClient,
  ActiveWorld,
  ClientConfigStore,
  TitleService,
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

  /** Pin a World detail carrying `rights` — the only thing the Theme section is gated on. */
  function pin(rights: WorldVerb[]): void {
    TestBed.inject(ActiveWorld).set({
      id: 'w1',
      name: 'Aldermoor',
      pinnedEntityIds: [],
      seq: 1,
      updatedAt: 1,
      rights,
    } as unknown as WorldDetail);
  }

  it('offers the Theme editor to a caller who may manage the World, and to no one else', () => {
    pin(['manage']);
    const fixture = TestBed.createComponent(WorldSettingsPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="settings-nav-theme"]')).not.toBeNull();

    // A Contributor writes Entities; a World Theme is identity, which is a manage right (ADR-0039).
    pin(['read', 'create-entity']);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="settings-nav-theme"]')).toBeNull();
  });

  it('offers the Mounts pane to a caller who may manage the World, and to no one else', () => {
    pin(['manage']);
    const fixture = TestBed.createComponent(WorldSettingsPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="settings-nav-mounts"]')).not.toBeNull();

    // Declaring what this World draws from is the Owner's alone (ADR-0080), like the Theme beside it.
    pin(['read', 'create-entity']);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="settings-nav-mounts"]')).toBeNull();
  });

  it('opens the Mounts pane on the active World, with Collaboration off as with it on', async () => {
    collaboration.set(false);
    pin(['manage']);
    await TestBed.inject(Router).navigate([], { queryParams: { section: 'mounts' } });
    const fixture = TestBed.createComponent(WorldSettingsPage);
    fixture.detectChanges();

    // Mounting is not a sharing concept: a Sole User on the Desktop App declares one too (ADR-0071).
    expect(fixture.componentInstance.active()).toBe('mounts');
    expect(fixture.nativeElement.querySelector('app-world-mounts')).not.toBeNull();
  });

  it('keeps the open section through a World refresh, so saving a Theme does not close the pane', async () => {
    pin(['manage']);
    const fixture = TestBed.createComponent(WorldSettingsPage);
    fixture.detectChanges();
    await TestBed.inject(Router).navigate([], { queryParams: { section: 'theme' } });
    fixture.detectChanges();

    // Saving a Theme re-pins the World, which re-derives the rail from it.
    pin(['manage']);
    fixture.detectChanges();

    expect(fixture.componentInstance.active()).toBe('theme');
    expect(fixture.nativeElement.querySelector('app-world-theme')).not.toBeNull();
  });

  it('opens the section the URL names, and puts the section picked from the rail into the URL', async () => {
    pin(['manage']);
    const router = TestBed.inject(Router);
    await router.navigate([], { queryParams: { section: 'sharing' } });
    const fixture = TestBed.createComponent(WorldSettingsPage);
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.directive(PublicLinkComponent))).not.toBeNull();

    fixture.nativeElement.querySelector('[data-testid="settings-nav-theme"]').click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(router.url).toContain('section=theme');
    expect(fixture.nativeElement.querySelector('app-world-theme')).not.toBeNull();
  });

  it('falls back to the first section when the URL names one the rail does not carry', async () => {
    collaboration.set(false);
    await TestBed.inject(Router).navigate([], { queryParams: { section: 'sharing' } });
    const fixture = TestBed.createComponent(WorldSettingsPage);
    fixture.detectChanges();

    expect(fixture.componentInstance.active()).toBe('schema');
    expect(fixture.nativeElement.querySelector('app-world-types')).not.toBeNull();
  });

  it('names the tab after the open section, and clears it on the way out', async () => {
    pin(['manage']);
    const titles = TestBed.inject(TitleService);
    const named = vi.spyOn(titles, 'setDocumentName');
    const fixture = TestBed.createComponent(WorldSettingsPage);
    fixture.detectChanges();
    expect(named).toHaveBeenLastCalledWith('Members');

    await TestBed.inject(Router).navigate([], { queryParams: { section: 'theme' } });
    fixture.detectChanges();
    expect(named).toHaveBeenLastCalledWith('World theme');

    fixture.destroy();
    expect(named).toHaveBeenLastCalledWith(null);
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

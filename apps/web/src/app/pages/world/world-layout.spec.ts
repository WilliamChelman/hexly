import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ActiveWorld } from '@hexly/web-core';
import { WorldDetail, WorldVerb } from '@hexly/domain';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { NavRailStore } from '../../shell/nav-rail.store';
import { WorldLayout } from './world-layout';

function world(rights: WorldVerb[]): WorldDetail {
  return {
    id: 'w1',
    name: 'Aldermoor',
    owners: ['u1'],
    rights,
    entityCount: 0,
    pinnedEntityIds: [],
    seq: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('WorldLayout', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WorldLayout, provideTranslocoTesting()],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  /** Pin the World, mount the layout (running its effect), return the filled rail slot. */
  function railFor(detail: WorldDetail) {
    TestBed.inject(ActiveWorld).set(detail);
    TestBed.createComponent(WorldLayout).detectChanges();
    return TestBed.inject(NavRailStore).entries();
  }

  it('fills the rail with the Library link from the active World (ADR-0041)', () => {
    expect(railFor(world(['read'])).map((e) => e.testid)).toEqual(['nav-entities']);
  });

  it('adds World Settings only when the caller may manage the World (ADR-0039)', () => {
    expect(railFor(world(['read', 'manage'])).map((e) => e.testid)).toEqual([
      'nav-entities',
      'nav-world-settings',
    ]);
  });

  it('clears the rail slot when the World scope is left', () => {
    TestBed.inject(ActiveWorld).set(world(['manage']));
    const fixture = TestBed.createComponent(WorldLayout);
    fixture.detectChanges();
    expect(TestBed.inject(NavRailStore).entries().length).toBeGreaterThan(0);

    fixture.destroy();
    expect(TestBed.inject(NavRailStore).entries()).toEqual([]);
  });
});

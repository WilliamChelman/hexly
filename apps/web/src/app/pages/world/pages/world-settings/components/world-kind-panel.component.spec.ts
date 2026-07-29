import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { WorldDetail, WorldKind } from '@hexly/domain';
import { ActiveWorld, ToasterService, WorldsClient } from '@hexly/web-core';
import { MockWorldsClient } from '@hexly/web-core/testing';
import { provideTranslocoTesting } from '../../../../../../testing/transloco-testing';
import { WorldKindPanelComponent } from './world-kind-panel.component';

/** Campaign-or-Shelf in World Settings (ADR-0080, #409): what a pick writes, and what it shows. */
describe('WorldKindPanel', () => {
  let worlds: MockWorldsClient;

  function mount(kind: WorldKind): ComponentFixture<WorldKindPanelComponent> {
    TestBed.configureTestingModule({
      imports: [WorldKindPanelComponent, provideTranslocoTesting()],
      providers: [{ provide: WorldsClient, useValue: worlds }],
    });
    TestBed.inject(ActiveWorld).set({ id: 'w1', name: 'Aldermoor', kind } as WorldDetail, 'w1');
    const fixture = TestBed.createComponent(WorldKindPanelComponent);
    fixture.componentRef.setInput('id', 'w1');
    fixture.detectChanges();
    return fixture;
  }

  const at = (fixture: ComponentFixture<WorldKindPanelComponent>, testid: string): HTMLInputElement =>
    fixture.nativeElement.querySelector(`[data-testid="${testid}"]`);

  function pick(fixture: ComponentFixture<WorldKindPanelComponent>, kind: WorldKind): void {
    at(fixture, `world-kind-${kind}`).click();
    fixture.detectChanges();
  }

  beforeEach(() => {
    worlds = new MockWorldsClient();
    worlds.setKind.mockImplementation((id, kind) => of({ id, name: 'Aldermoor', kind } as WorldDetail));
  });

  it('offers both, checking the one the World wears', () => {
    const fixture = mount('campaign');

    expect(at(fixture, 'world-kind-campaign').checked).toBe(true);
    expect(at(fixture, 'world-kind-shelf').checked).toBe(false);
  });

  it('writes the pick and re-pins the returned World, so the label persists', () => {
    const fixture = mount('campaign');

    pick(fixture, 'shelf');

    expect(worlds.setKind).toHaveBeenCalledWith('w1', 'shelf');
    expect(TestBed.inject(ActiveWorld).world()?.kind).toBe('shelf');
    expect(at(fixture, 'world-kind-shelf').checked).toBe(true);
  });

  it('takes a Shelf back to a campaign — the label is a curation, not a one-way door', () => {
    const fixture = mount('shelf');

    pick(fixture, 'campaign');

    expect(worlds.setKind).toHaveBeenCalledWith('w1', 'campaign');
  });

  it('writes nothing when the label it already wears is picked again', () => {
    const fixture = mount('shelf');

    pick(fixture, 'shelf');

    expect(worlds.setKind).not.toHaveBeenCalled();
  });

  it('falls back to the stored label and toasts when the write fails', () => {
    // A Subject, not `throwError`: the failure has to land on its own tick, as a round trip does,
    // or the optimistic pick and its rollback collapse into one and the radio is never re-rendered.
    const pending = new Subject<WorldDetail>();
    worlds.setKind.mockReturnValue(pending);
    const fixture = mount('campaign');

    pick(fixture, 'shelf');
    expect(at(fixture, 'world-kind-shelf').checked).toBe(true);

    pending.error(new Error('server error'));
    fixture.detectChanges();

    expect(
      TestBed.inject(ToasterService)
        .toasts()
        .map((t) => t.tone),
    ).toEqual(['error']);
    expect(at(fixture, 'world-kind-campaign').checked).toBe(true);
  });
});

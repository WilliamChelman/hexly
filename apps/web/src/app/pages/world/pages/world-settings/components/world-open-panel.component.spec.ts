import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { WorldDetail } from '@hexly/domain';
import { ActiveWorld, ToasterService, WorldsClient } from '@hexly/web-core';
import { MockWorldsClient } from '@hexly/web-core/testing';
import { provideTranslocoTesting } from '../../../../../../testing/transloco-testing';
import { WorldOpenPanelComponent } from './world-open-panel.component';

/** The Open-World toggle in World Settings (ADR-0084, #434): what a pick writes, and what it shows. */
describe('WorldOpenPanel', () => {
  let worlds: MockWorldsClient;

  function mount(open: boolean): ComponentFixture<WorldOpenPanelComponent> {
    TestBed.configureTestingModule({
      imports: [WorldOpenPanelComponent, provideTranslocoTesting()],
      providers: [{ provide: WorldsClient, useValue: worlds }],
    });
    TestBed.inject(ActiveWorld).set({ id: 'w1', name: 'Aldermoor', open } as WorldDetail, 'w1');
    const fixture = TestBed.createComponent(WorldOpenPanelComponent);
    fixture.componentRef.setInput('id', 'w1');
    fixture.detectChanges();
    return fixture;
  }

  const at = (fixture: ComponentFixture<WorldOpenPanelComponent>, testid: string): HTMLInputElement =>
    fixture.nativeElement.querySelector(`[data-testid="${testid}"]`);

  function pick(fixture: ComponentFixture<WorldOpenPanelComponent>, key: 'closed' | 'open'): void {
    at(fixture, `world-open-${key}`).click();
    fixture.detectChanges();
  }

  beforeEach(() => {
    worlds = new MockWorldsClient();
    worlds.setOpen.mockImplementation((id, open) => of({ id, name: 'Aldermoor', open } as WorldDetail));
  });

  it('offers both, checking the state the World wears', () => {
    const fixture = mount(false);

    expect(at(fixture, 'world-open-closed').checked).toBe(true);
    expect(at(fixture, 'world-open-open').checked).toBe(false);
  });

  it('opens the World and re-pins the returned detail, so the flag persists', () => {
    const fixture = mount(false);

    pick(fixture, 'open');

    expect(worlds.setOpen).toHaveBeenCalledWith('w1', true);
    expect(TestBed.inject(ActiveWorld).world()?.open).toBe(true);
    expect(at(fixture, 'world-open-open').checked).toBe(true);
  });

  it('closes an Open World again — the flag is a toggle, not a one-way door', () => {
    const fixture = mount(true);

    pick(fixture, 'closed');

    expect(worlds.setOpen).toHaveBeenCalledWith('w1', false);
  });

  it('writes nothing when the state it already wears is picked again', () => {
    const fixture = mount(true);

    pick(fixture, 'open');

    expect(worlds.setOpen).not.toHaveBeenCalled();
  });

  it('falls back to the stored flag and toasts when the write fails', () => {
    // A Subject, not `throwError`: the failure has to land on its own tick, as a round trip does,
    // or the optimistic pick and its rollback collapse into one and the radio is never re-rendered.
    const pending = new Subject<WorldDetail>();
    worlds.setOpen.mockReturnValue(pending);
    const fixture = mount(false);

    pick(fixture, 'open');
    expect(at(fixture, 'world-open-open').checked).toBe(true);

    pending.error(new Error('server error'));
    fixture.detectChanges();

    expect(
      TestBed.inject(ToasterService)
        .toasts()
        .map((t) => t.tone),
    ).toEqual(['error']);
    expect(at(fixture, 'world-open-closed').checked).toBe(true);
  });
});

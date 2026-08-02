import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { of, throwError } from 'rxjs';
import { Mount } from '@hexly/domain';
import { ToasterService, WorldsClient } from '@hexly/web-core';
import { MockWorldsClient } from '@hexly/web-core/testing';
import { provideTranslocoTesting } from '../../../../../../testing/transloco-testing';
import { WorldMountsPanelComponent } from './world-mounts-panel.component';

/**
 * The World Settings Mounts pane (#408, ADR-0080): the ordered list of what this World draws from, the
 * add control over what the caller may mount, reorder and unmount. Driven through the
 * {@link MockWorldsClient} — the Own-only rule is the server's answer, so what these specs pin is that
 * the panel offers exactly what it was given and never re-derives it.
 */
describe('WorldMountsPanel', () => {
  let worlds: MockWorldsClient;
  let toaster: ToasterService;
  let fixture: ComponentFixture<WorldMountsPanelComponent>;

  const shelf: Mount = { containerId: 'c-shelf', name: 'The Art Shelf', kind: 'world' };
  const pack: Mount = { containerId: 'c-pack', name: 'Draw Steel: Monsters', kind: 'compendium' };

  beforeEach(async () => {
    worlds = new MockWorldsClient();
    await TestBed.configureTestingModule({
      imports: [WorldMountsPanelComponent, provideTranslocoTesting()],
      providers: [{ provide: WorldsClient, useValue: worlds }],
    }).compileComponents();
    toaster = TestBed.inject(ToasterService);
  });

  function render(): void {
    fixture = TestBed.createComponent(WorldMountsPanelComponent);
    fixture.componentRef.setInput('id', 'w1');
    fixture.detectChanges();
  }

  function el(testid: string): HTMLElement {
    return fixture.debugElement.query(By.css(`[data-testid="${testid}"]`)).nativeElement as HTMLElement;
  }

  function has(testid: string): boolean {
    return fixture.debugElement.query(By.css(`[data-testid="${testid}"]`)) !== null;
  }

  function click(testid: string): void {
    el(testid).click();
    fixture.detectChanges();
  }

  it('lists what the World draws from, in order, each naming its Container and kind', () => {
    worlds.mounts.mockReturnValue(of([shelf, pack]));
    render();

    const names = fixture.debugElement.queryAll(By.css('[data-testid^="mount-c-"] .mount-name'));
    expect(names.map((n) => (n.nativeElement as HTMLElement).textContent)).toEqual([
      'The Art Shelf',
      'Draw Steel: Monsters',
    ]);
    // Which kind it is, in words rather than an id the reader has to decode.
    expect(el('mount-kind-c-shelf').textContent).toContain('World');
    expect(el('mount-kind-c-pack').textContent).toContain('Compendium');
  });

  it('says so plainly when the World draws on nothing — the ordinary case', () => {
    render();

    expect(fixture.nativeElement.textContent).toContain('draws on nothing yet');
  });

  it('offers exactly what the server says is mountable, and mounts the picked one', () => {
    const candidates: Mount[] = [pack, shelf];
    worlds.mountCandidates.mockReturnValue(of(candidates));
    worlds.addMount.mockReturnValue(of([shelf]));
    render();

    const options = Array.from((el('mount-add-select') as HTMLSelectElement).options, (o) => o.value);
    // The placeholder, then the offer verbatim: the Own-only rule is an authorisation answer, so this
    // panel filters nothing of its own (ADR-0080).
    expect(options).toEqual(['', 'c-pack', 'c-shelf']);

    (el('mount-add-select') as HTMLSelectElement).value = 'c-shelf';
    el('mount-add-select').dispatchEvent(new Event('change'));
    fixture.detectChanges();
    click('mount-add');

    expect(worlds.addMount).toHaveBeenCalledWith('w1', 'c-shelf');
    expect(has('mount-c-shelf')).toBe(true);
    // What is now mounted is no longer on offer, so the offer is re-read through the write.
    expect(worlds.mountCandidates).toHaveBeenCalledTimes(2);
  });

  it('reorders by sending the whole new order, one request per move', () => {
    worlds.mounts.mockReturnValue(of([shelf, pack]));
    worlds.reorderMounts.mockReturnValue(of([pack, shelf]));
    render();

    // The ends are the affordance: the first row cannot move up, the last cannot move down.
    expect((el('mount-up-c-shelf') as HTMLButtonElement).disabled).toBe(true);
    expect((el('mount-down-c-pack') as HTMLButtonElement).disabled).toBe(true);

    click('mount-down-c-shelf');

    expect(worlds.reorderMounts).toHaveBeenCalledWith('w1', ['c-pack', 'c-shelf']);
    const rows = fixture.debugElement.queryAll(By.css('[data-testid^="mount-c-"]'));
    expect(rows.map((r) => (r.nativeElement as HTMLElement).dataset['testid'])).toEqual([
      'mount-c-pack',
      'mount-c-shelf',
    ]);
  });

  it('states how many links point into a Container before unmounting it, then unmounts', () => {
    worlds.mounts.mockReturnValue(of([shelf, pack]));
    worlds.mountInboundLinks.mockReturnValue(of({ links: 4, worlds: 1 }));
    worlds.removeMount.mockReturnValue(of([pack]));
    render();

    click('mount-remove-c-shelf');

    // The count is read for *this* act (ADR-0080, #414) — nothing is unmounted by asking.
    expect(worlds.mountInboundLinks).toHaveBeenCalledWith('w1', 'c-shelf');
    expect(worlds.removeMount).not.toHaveBeenCalled();
    expect(el('unmount-count').textContent).toContain('4');
    // Worth wording carefully: the links keep working for the Owner and stop for everyone else.
    expect(el('unmount-count').textContent).toContain('keep working for you');

    click('confirm-unmount');

    expect(worlds.removeMount).toHaveBeenCalledWith('w1', 'c-shelf');
    expect(has('mount-c-shelf')).toBe(false);
    expect(has('mount-c-pack')).toBe(true);
    expect(has('unmount-modal')).toBe(false);
  });

  it('says nothing points into a Container rather than showing it a bare zero', () => {
    worlds.mounts.mockReturnValue(of([shelf]));
    worlds.mountInboundLinks.mockReturnValue(of({ links: 0, worlds: 0 }));
    render();

    click('mount-remove-c-shelf');

    expect(el('unmount-count').textContent).toContain('Nothing in this world points into it');
    expect(el('unmount-count').textContent).not.toContain('0');
  });

  it('unmounts whatever the count says, and unmounts even when the count would not load', () => {
    worlds.mounts.mockReturnValue(of([shelf]));
    worlds.mountInboundLinks.mockReturnValue(throwError(() => new Error('boom')));
    worlds.removeMount.mockReturnValue(of([]));
    render();

    click('mount-remove-c-shelf');

    // A blast radius is advice, never a gate: a count that failed to load degrades to a confirm
    // without one rather than to a refusal (ADR-0080 rejects the veto by name).
    expect(el('unmount-count').textContent).toContain("Couldn't count");
    click('confirm-unmount');
    expect(worlds.removeMount).toHaveBeenCalledWith('w1', 'c-shelf');
  });

  it('backs out of the unmount without touching the Mount', () => {
    worlds.mounts.mockReturnValue(of([shelf]));
    render();

    click('mount-remove-c-shelf');
    click('cancel-unmount');

    expect(worlds.removeMount).not.toHaveBeenCalled();
    expect(has('mount-c-shelf')).toBe(true);
  });

  it('leaves the list as the server last said it was when a write is refused', () => {
    worlds.mounts.mockReturnValue(of([shelf]));
    worlds.removeMount.mockReturnValue(throwError(() => new Error('boom')));
    render();

    click('mount-remove-c-shelf');
    click('confirm-unmount');

    expect(toaster.toasts().at(-1)?.tone).toBe('error');
    expect(has('mount-c-shelf')).toBe(true);
  });

  it('toasts when what the World draws from cannot be loaded', () => {
    worlds.mounts.mockReturnValue(throwError(() => new Error('boom')));
    render();

    expect(toaster.toasts().at(-1)?.tone).toBe('error');
  });
});

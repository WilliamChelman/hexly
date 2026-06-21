import { TestBed } from '@angular/core/testing';
import { EditorStore } from './editor-store';
import { Inspector } from './inspector';

describe('Inspector label editing', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Inspector] }).compileComponents();
  });

  /** Create the inspector with a label already selected, and return both. */
  function withSelectedLabel(text = 'The Whisperwood') {
    const store = TestBed.inject(EditorStore);
    const id = store.addLabel(text, { x: 40, y: -20 });
    store.selectLabel(id);
    const fixture = TestBed.createComponent(Inspector);
    fixture.detectChanges();
    return { store, id, fixture };
  }

  function field(fixture: ReturnType<typeof TestBed.createComponent>, testid: string) {
    return fixture.nativeElement.querySelector(`[data-testid=${testid}]`) as HTMLInputElement;
  }

  it('shows the selected label\'s text', () => {
    const { fixture } = withSelectedLabel('Open Sea');

    expect(field(fixture, 'label-text').value).toBe('Open Sea');
  });

  it('edits the label text when the text field changes', () => {
    const { store, id, fixture } = withSelectedLabel();

    const input = field(fixture, 'label-text');
    input.value = 'The Drowned Coast';
    input.dispatchEvent(new Event('change'));

    expect(store.document().labels.find((l) => l.id === id)?.text).toBe('The Drowned Coast');
  });

  it('resizes the label when the size field changes', () => {
    const { store, id, fixture } = withSelectedLabel();

    const input = field(fixture, 'label-size');
    input.value = '48';
    input.dispatchEvent(new Event('change'));

    expect(store.document().labels.find((l) => l.id === id)?.size).toBe(48);
  });

  it('rotates the label when the rotation field changes', () => {
    const { store, id, fixture } = withSelectedLabel();

    const input = field(fixture, 'label-rotation');
    input.value = '45';
    input.dispatchEvent(new Event('change'));

    expect(store.document().labels.find((l) => l.id === id)?.rotation).toBe(45);
  });

  it('moves the label when an X position field changes', () => {
    const { store, id, fixture } = withSelectedLabel();

    const input = field(fixture, 'label-x');
    input.value = '300';
    input.dispatchEvent(new Event('change'));

    expect(store.document().labels.find((l) => l.id === id)?.position.x).toBe(300);
  });

  it('deletes the selected label when Delete is clicked', () => {
    const { store, id, fixture } = withSelectedLabel();

    (
      fixture.nativeElement.querySelector('[data-testid=label-delete]') as HTMLButtonElement
    ).click();

    expect(store.document().labels.find((l) => l.id === id)).toBeUndefined();
  });

  it('shows no label editor when nothing is selected', () => {
    const fixture = TestBed.createComponent(Inspector);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid=label-text]')).toBeNull();
  });
});

describe('Inspector hex and feature selection', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Inspector] }).compileComponents();
  });

  function render() {
    const fixture = TestBed.createComponent(Inspector);
    fixture.detectChanges();
    return fixture;
  }

  it('shows a selected Hex\'s coordinate and terrain, with no label editor', () => {
    const store = TestBed.inject(EditorStore);
    store.paintAt({ q: 2, r: -1 }, 'ocean');
    store.select({ q: 2, r: -1 }, null);

    const el = render().nativeElement;

    // Assert q and r land in their own fields, so a q/r transposition fails too.
    const coord = el.querySelector('[data-testid=entity-coord]').textContent;
    expect(coord).toContain('q 2');
    expect(coord).toContain('r -1');
    expect(el.querySelector('[data-testid=entity-detail]').textContent).toContain('Ocean');
    expect(el.querySelector('[data-testid=label-text]')).toBeNull();
  });

  it('deletes a selected Hex when its Delete action is clicked, clearing the selection', () => {
    const store = TestBed.inject(EditorStore);
    store.paintAt({ q: 0, r: 0 }, 'grass');
    store.select({ q: 0, r: 0 }, null);

    const del = render().nativeElement.querySelector(
      '[data-testid=entity-delete]',
    ) as HTMLButtonElement;
    // The affordance must be live, not the disabled placeholder it used to render
    // — a programmatic click fires even on a disabled button, so assert it first.
    expect(del.disabled).toBe(false);
    del.click();

    expect('0,0' in store.document().hexes).toBe(false);
    expect(store.selection()).toBeNull();
  });

  it('deletes a selected Feature by clearing only its feature when Delete is clicked', () => {
    const store = TestBed.inject(EditorStore);
    store.paintAt({ q: 1, r: 1 }, 'forest');
    store.placeFeatureAt({ q: 1, r: 1 }, 'settlement');
    store.select({ q: 1, r: 1 }, null); // the Feature

    (
      render().nativeElement.querySelector(
        '[data-testid=entity-delete]',
      ) as HTMLButtonElement
    ).click();

    expect(store.document().hexes['1,1']).toEqual({ terrain: 'forest' });
    expect(store.selection()).toBeNull();
  });

  it('shows a selected Feature\'s identity, labelled as a feature', () => {
    const store = TestBed.inject(EditorStore);
    store.paintAt({ q: 1, r: 1 }, 'grass');
    store.placeFeatureAt({ q: 1, r: 1 }, 'settlement');
    store.select({ q: 1, r: 1 }, null);

    const el = render().nativeElement;

    expect(el.querySelector('header').textContent).toContain('feature');
    expect(el.querySelector('[data-testid=entity-detail]').textContent).toContain(
      'Settlement',
    );
    expect(el.querySelector('[data-testid=entity-delete]').textContent).toContain(
      'feature',
    );
  });
});

describe('Inspector region editing', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Inspector] }).compileComponents();
  });

  /** Create the inspector with a Region selected, and return both. The member is a
   * Void coordinate so the Region is the only selection candidate there. */
  function withSelectedRegion(name = 'Region 3', color = '#b08a4e') {
    const store = TestBed.inject(EditorStore);
    const id = store.createRegion(name, color);
    store.addHexToRegion(id, { q: 0, r: 0 });
    store.select({ q: 0, r: 0 }, null);
    const fixture = TestBed.createComponent(Inspector);
    fixture.detectChanges();
    return { store, id, fixture };
  }

  function field(fixture: ReturnType<typeof TestBed.createComponent>, testid: string) {
    return fixture.nativeElement.querySelector(`[data-testid=${testid}]`) as HTMLInputElement;
  }

  it('renders the region editor for a selected Region, with no hex/label panels', () => {
    const { fixture } = withSelectedRegion('The Whisperwood');

    expect(field(fixture, 'region-name').value).toBe('The Whisperwood');
    expect(fixture.nativeElement.querySelector('[data-testid=label-text]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid=entity-coord]')).toBeNull();
  });

  it('renames the region when the name field changes (e.g. "Region 3" → "The Whisperwood")', () => {
    const { store, id, fixture } = withSelectedRegion('Region 3');

    const input = field(fixture, 'region-name');
    input.value = 'The Whisperwood';
    input.dispatchEvent(new Event('change'));

    expect(store.document().regions[0].name).toBe('The Whisperwood');
    // The edit is reflected live through the same selection the inspector binds to.
    expect(store.selectedRegion()?.name).toBe('The Whisperwood');
    expect(id).toBe(store.document().regions[0].id);
  });

  it('recolors the region when the color field changes, updating its border color', () => {
    const { store, fixture } = withSelectedRegion('Avalon', '#b08a4e');

    const input = field(fixture, 'region-color');
    input.value = '#6f7fae';
    input.dispatchEvent(new Event('change'));

    expect(store.document().regions[0].color).toBe('#6f7fae');
    expect(store.selectedRegion()?.color).toBe('#6f7fae');
  });

  it('deletes the region when its Delete button is clicked, clearing the selection', () => {
    const { store, fixture } = withSelectedRegion();

    const del = field(fixture, 'region-delete') as unknown as HTMLButtonElement;
    // A programmatic click fires even on a disabled button, so assert it is live.
    expect(del.disabled).toBe(false);
    del.click();

    expect(store.document().regions).toEqual([]);
    expect(store.selection()).toBeNull();
  });
});

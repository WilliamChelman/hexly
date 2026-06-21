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

    expect(el.querySelector('[data-testid=entity-coord]').textContent).toContain('2');
    expect(el.querySelector('[data-testid=entity-coord]').textContent).toContain('-1');
    expect(el.querySelector('[data-testid=entity-detail]').textContent).toContain('Ocean');
    expect(el.querySelector('[data-testid=label-text]')).toBeNull();
  });

  it('renders a Delete affordance for a selected Hex, disabled until wiring lands', () => {
    const store = TestBed.inject(EditorStore);
    store.paintAt({ q: 0, r: 0 }, 'grass');
    store.select({ q: 0, r: 0 }, null);

    const del = render().nativeElement.querySelector(
      '[data-testid=entity-delete]',
    ) as HTMLButtonElement;

    expect(del).not.toBeNull();
    expect(del.disabled).toBe(true);
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

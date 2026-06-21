import { TestBed } from '@angular/core/testing';
import { EditorStore } from './editor-store';
import { ToolPalette } from './tool-palette';

describe('ToolPalette feature group', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ToolPalette] }).compileComponents();
  });

  function click(fixture: ReturnType<typeof TestBed.createComponent>, testid: string): void {
    fixture.detectChanges();
    (
      fixture.nativeElement.querySelector(`[data-testid=${testid}]`) as HTMLButtonElement
    ).click();
  }

  it('arms a feature tool from the built-in library when a feature is picked', () => {
    const fixture = TestBed.createComponent(ToolPalette);

    click(fixture, 'feature-settlement');

    expect(TestBed.inject(EditorStore).tool()).toEqual({
      kind: 'feature',
      id: 'settlement',
    });
  });

  it('arms the clear-feature tool when Clear feature is picked', () => {
    const fixture = TestBed.createComponent(ToolPalette);

    click(fixture, 'clear-feature');

    expect(TestBed.inject(EditorStore).tool()).toEqual({ kind: 'clear-feature' });
  });

  it('arms the label tool when Label is picked', () => {
    const fixture = TestBed.createComponent(ToolPalette);

    click(fixture, 'tool-label');

    expect(TestBed.inject(EditorStore).tool()).toEqual({ kind: 'label' });
  });
});

describe('ToolPalette regions', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ToolPalette] }).compileComponents();
  });

  it('creates a region and arms it for painting when New region is clicked', () => {
    const fixture = TestBed.createComponent(ToolPalette);
    const store = TestBed.inject(EditorStore);
    fixture.detectChanges();

    (
      fixture.nativeElement.querySelector('[data-testid=new-region]') as HTMLButtonElement
    ).click();

    const regions = store.document().regions;
    expect(regions).toHaveLength(1);
    expect(store.tool()).toEqual({ kind: 'region', id: regions[0].id, mode: 'add' });
  });

  it('lists each region in the document by name', () => {
    const store = TestBed.inject(EditorStore);
    store.createRegion('The Whisperwood', '#7c9b86');
    const fixture = TestBed.createComponent(ToolPalette);
    fixture.detectChanges();

    const id = store.document().regions[0].id;
    const nameInput = fixture.nativeElement.querySelector(
      `[data-testid=region-name-${id}]`,
    ) as HTMLInputElement;
    expect(nameInput.value).toBe('The Whisperwood');
  });

  it('arms the erase brush for a region when its Erase is clicked', () => {
    const store = TestBed.inject(EditorStore);
    const id = store.createRegion('Avalon', '#b08a4e');
    const fixture = TestBed.createComponent(ToolPalette);
    fixture.detectChanges();

    (
      fixture.nativeElement.querySelector(
        `[data-testid=region-erase-${id}]`,
      ) as HTMLButtonElement
    ).click();

    expect(store.tool()).toEqual({ kind: 'region', id, mode: 'remove' });
  });

  it('renames a region when its name field changes', () => {
    const store = TestBed.inject(EditorStore);
    const id = store.createRegion('Avalon', '#b08a4e');
    const fixture = TestBed.createComponent(ToolPalette);
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector(
      `[data-testid=region-name-${id}]`,
    ) as HTMLInputElement;
    input.value = 'The Kingdom of Avalon';
    input.dispatchEvent(new Event('change'));

    expect(store.document().regions[0].name).toBe('The Kingdom of Avalon');
  });

  it('recolors a region when its color field changes', () => {
    const store = TestBed.inject(EditorStore);
    const id = store.createRegion('Avalon', '#b08a4e');
    const fixture = TestBed.createComponent(ToolPalette);
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector(
      `[data-testid=region-color-${id}]`,
    ) as HTMLInputElement;
    input.value = '#6f7fae';
    input.dispatchEvent(new Event('change'));

    expect(store.document().regions[0].color).toBe('#6f7fae');
  });

  it('deletes a region when its delete control is clicked', () => {
    const store = TestBed.inject(EditorStore);
    const id = store.createRegion('Avalon', '#b08a4e');
    const fixture = TestBed.createComponent(ToolPalette);
    fixture.detectChanges();

    (
      fixture.nativeElement.querySelector(
        `[data-testid=region-delete-${id}]`,
      ) as HTMLButtonElement
    ).click();

    expect(store.document().regions).toEqual([]);
  });
});

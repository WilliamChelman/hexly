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
});

import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Editor } from '@tiptap/core';
import { CONTENT_EXTENSIONS } from './content-extensions';
import { TiptapDirective } from './tiptap.directive';

@Component({
  imports: [TiptapDirective],
  template: `<div class="host" [appTiptap]="editor()"></div>`,
})
class Host {
  readonly editor = signal<Editor>(undefined!);
}

function editorWith(text: string): Editor {
  const editor = new Editor({ extensions: CONTENT_EXTENSIONS });
  editor.commands.setContent({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });
  return editor;
}

describe('TiptapDirective', () => {
  it('relocates the editor’s editable surface into the host', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.editor.set(editorWith('Lady Mara'));
    fixture.detectChanges();

    const host = fixture.nativeElement.querySelector('.host') as HTMLElement;
    expect(host.querySelector('.ProseMirror')).not.toBeNull();
    expect(host.textContent).toContain('Lady Mara');
  });

  it('swaps to the new editor when the instance changes', () => {
    const fixture = TestBed.createComponent(Host);
    const first = editorWith('Lady Mara');
    fixture.componentInstance.editor.set(first);
    fixture.detectChanges();

    const second = editorWith('Lord Brand');
    fixture.componentInstance.editor.set(second);
    fixture.detectChanges();

    const host = fixture.nativeElement.querySelector('.host') as HTMLElement;
    expect(host.textContent).toContain('Lord Brand');
    expect(host.textContent).not.toContain('Lady Mara');
    // Exactly one editable surface — the old one was relocated out, not left behind.
    expect(host.querySelectorAll('.ProseMirror')).toHaveLength(1);

    first.destroy();
    second.destroy();
  });
});

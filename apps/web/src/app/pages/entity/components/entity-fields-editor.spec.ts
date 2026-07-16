import { provideTranslocoTesting } from '../../../../testing/transloco-testing';
import { TestBed } from '@angular/core/testing';
import { ComponentRef } from '@angular/core';
import { EntityFieldsEditor } from './entity-fields-editor';
import { providePluginContent } from '@hexly/plugin-content/web';
import { providePluginDnd } from '@hexly/plugin-dnd/web';

describe('EntityFieldsEditor', () => {
  let ref: ComponentRef<EntityFieldsEditor>;
  let el: HTMLElement;
  let attached: string[];
  let detached: string[];

  function render(types: string[], fields: string[], writable = true) {
    TestBed.configureTestingModule({
      imports: [EntityFieldsEditor, provideTranslocoTesting()],
      providers: [providePluginContent(), providePluginDnd()],
    });
    const fixture = TestBed.createComponent(EntityFieldsEditor);
    ref = fixture.componentRef;
    ref.setInput('types', types);
    ref.setInput('fields', fields);
    ref.setInput('writable', writable);
    attached = [];
    detached = [];
    fixture.componentInstance.attach.subscribe((id) => attached.push(id));
    fixture.componentInstance.detach.subscribe((id) => detached.push(id));
    fixture.detectChanges();
    el = fixture.nativeElement;
    return fixture;
  }

  const q = (testid: string) => el.querySelector(`[data-testid="${testid}"]`) as HTMLElement;

  it('offers a registered Field the entity’s types never named, emitting its id on attach', () => {
    render(['core.note'], []);
    const add = q('field-add') as HTMLSelectElement;
    // `dnd.size` is a plugin Field a note's type never declares — attachable, by its label.
    const option = Array.from(add.options).find((o) => o.value === 'dnd.size');
    expect(option?.textContent?.trim()).toBe('Size');

    add.value = 'dnd.size';
    add.dispatchEvent(new Event('change'));
    expect(attached).toEqual(['dnd.size']);
    // The select resets so the same Field isn't re-fired on the next change.
    expect(add.value).toBe('');
  });

  it('renders an attached Field as a chip and detaches it on ×', () => {
    render(['core.note'], ['dnd.size']);
    expect(q('field-chip-dnd.size')).not.toBeNull();
    expect(q('field-chip-dnd.size').textContent).toContain('Size');

    q('field-detach-dnd.size').click();
    expect(detached).toEqual(['dnd.size']);
  });

  it('never offers a Field the effective set already covers (a default, or an already-attached one)', () => {
    render(['core.note'], ['dnd.size']);
    const add = q('field-add') as HTMLSelectElement;
    const values = Array.from(add.options).map((o) => o.value);
    expect(values).not.toContain('core.content'); // a note default
    expect(values).not.toContain('dnd.size'); // already attached
  });

  it('shows an empty-state hint when nothing is attached', () => {
    render(['core.note'], []);
    expect(q('fields-empty')).not.toBeNull();
    expect(q('field-chip-dnd.size')).toBeNull();
  });

  it('shows no attach/detach affordances for a read-only opener, but still lists the chips', () => {
    render(['core.note'], ['dnd.size'], false);
    expect(q('field-add')).toBeNull();
    expect(q('field-detach-dnd.size')).toBeNull();
    expect(q('field-chip-dnd.size')).not.toBeNull();
  });
});

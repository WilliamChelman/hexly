import { provideTranslocoTesting } from '../../../../testing/transloco-testing';
import { TestBed } from '@angular/core/testing';
import { ComponentRef } from '@angular/core';
import { EntityFieldsEditorComponent } from './entity-fields-editor.component';
import { providePluginContent } from '@hexly/plugin-content/web';
import { providePluginDnd } from '@hexly/plugin-dnd/web';
import { providePluginHexmap } from '@hexly/plugin-hexmap/web';

describe('EntityFieldsEditor', () => {
  let ref: ComponentRef<EntityFieldsEditorComponent>;
  let el: HTMLElement;
  let attached: string[];
  let detached: string[];

  function render(types: string[], fields: string[], writable = true) {
    TestBed.configureTestingModule({
      imports: [EntityFieldsEditorComponent, provideTranslocoTesting()],
      // Hexmap composed too, so `core.grid` stays attachable to a note once the one dnd Field is on.
      providers: [providePluginContent(), providePluginDnd(), providePluginHexmap()],
    });
    const fixture = TestBed.createComponent(EntityFieldsEditorComponent);
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
    // `dnd.stat_block` is a plugin Field a note's type never declares — attachable, by its label.
    const option = Array.from(add.options).find((o) => o.value === 'dnd.stat_block');
    expect(option?.textContent?.trim()).toBe('Stat block');

    add.value = 'dnd.stat_block';
    add.dispatchEvent(new Event('change'));
    expect(attached).toEqual(['dnd.stat_block']);
    // The select resets so the same Field isn't re-fired on the next change.
    expect(add.value).toBe('');
  });

  it('renders an attached Field as a chip and detaches it on ×', () => {
    render(['core.note'], ['dnd.stat_block']);
    expect(q('field-chip-dnd.stat_block')).not.toBeNull();
    expect(q('field-chip-dnd.stat_block').textContent).toContain('Stat block');

    q('field-detach-dnd.stat_block').click();
    expect(detached).toEqual(['dnd.stat_block']);
  });

  it('never offers a Field the effective set already covers (a default, or an already-attached one)', () => {
    render(['core.note'], ['dnd.stat_block']);
    const add = q('field-add') as HTMLSelectElement;
    const values = Array.from(add.options).map((o) => o.value);
    expect(values).not.toContain('core.content'); // a note default
    expect(values).not.toContain('dnd.stat_block'); // already attached
  });

  it('shows an empty-state hint when nothing is attached', () => {
    render(['core.note'], []);
    expect(q('fields-empty')).not.toBeNull();
    expect(q('field-chip-dnd.stat_block')).toBeNull();
  });

  it('shows no attach/detach affordances for a read-only opener, but still lists the chips', () => {
    render(['core.note'], ['dnd.stat_block'], false);
    expect(q('field-add')).toBeNull();
    expect(q('field-detach-dnd.stat_block')).toBeNull();
    expect(q('field-chip-dnd.stat_block')).not.toBeNull();
  });
});

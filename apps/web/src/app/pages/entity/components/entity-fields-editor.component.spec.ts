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
      // Hexmap composed too, so `core.field.grid` stays attachable to a note once the one dnd Field is on.
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
    render(['core.type.note'], []);
    const add = q('field-add') as HTMLSelectElement;
    // `dnd.field.stat-block` is a plugin Field a note's type never declares — attachable, by its label.
    const option = Array.from(add.options).find((o) => o.value === 'dnd.field.stat-block');
    expect(option?.textContent?.trim()).toBe('Stat block');

    add.value = 'dnd.field.stat-block';
    add.dispatchEvent(new Event('change'));
    expect(attached).toEqual(['dnd.field.stat-block']);
    // The select resets so the same Field isn't re-fired on the next change.
    expect(add.value).toBe('');
  });

  it('renders an attached Field as a chip and detaches it on ×', () => {
    render(['core.type.note'], ['dnd.field.stat-block']);
    expect(q('field-chip-dnd.field.stat-block')).not.toBeNull();
    expect(q('field-chip-dnd.field.stat-block').textContent).toContain('Stat block');

    q('field-detach-dnd.field.stat-block').click();
    expect(detached).toEqual(['dnd.field.stat-block']);
  });

  it('never offers a Field the effective set already covers (a default, or an already-attached one)', () => {
    render(['core.type.note'], ['dnd.field.stat-block']);
    const add = q('field-add') as HTMLSelectElement;
    const values = Array.from(add.options).map((o) => o.value);
    expect(values).not.toContain('core.field.content'); // a note default
    expect(values).not.toContain('dnd.field.stat-block'); // already attached
  });

  it('shows an empty-state hint when nothing is attached', () => {
    render(['core.type.note'], []);
    expect(q('fields-empty')).not.toBeNull();
    expect(q('field-chip-dnd.field.stat-block')).toBeNull();
  });

  it('shows no attach/detach affordances for a read-only opener, but still lists the chips', () => {
    render(['core.type.note'], ['dnd.field.stat-block'], false);
    expect(q('field-add')).toBeNull();
    expect(q('field-detach-dnd.field.stat-block')).toBeNull();
    expect(q('field-chip-dnd.field.stat-block')).not.toBeNull();
  });
});

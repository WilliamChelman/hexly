import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Select } from './select.component';

/** A host driving the attribute-selector primitive on a native select. */
@Component({
  imports: [Select],
  template: `
    <select appSelect>
      <option value="a">Alpha</option>
      <option value="b">Beta</option>
    </select>
  `,
})
class Host {}

describe('Select', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [Host] }));

  it('keeps the host a real select and projects its options through', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;

    expect(select.tagName).toBe('SELECT');
    // The options survive projection — the native element stays fully usable.
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['a', 'b']);
    select.value = 'b';
    expect(select.value).toBe('b');
  });
});

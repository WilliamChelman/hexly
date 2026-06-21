import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { Region } from '@hexly/domain';
import { Field } from '../ui/field';
import { Input } from '../ui/input';
import { inputValue } from './dom';
import { EditorStore } from './editor-store';

/**
 * The shared name + colour editor for a single {@link Region} — the one place the
 * two field controls and their commit handlers live, so the Inspector's region
 * editor and the palette's Regions legend cannot drift (issue #36). `compact`
 * switches between the legend's inline swatch + name row and the Inspector's
 * labelled-field stack; `suffix` scopes the test ids so a legend's per-region
 * inputs (`region-name-<id>`) and the Inspector's single input (`region-name`)
 * stay addressable. The host is `display: contents`, so the fields lay out as
 * direct children of whichever container hosts the component.
 */
@Component({
  selector: 'app-region-fields',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Field, Input],
  template: `
    @let r = region();
    <!--
      One-way [value] with (change): an OnPush re-render mid-edit could re-apply
      the bound value, but any in-app action that re-renders also blurs (and thus
      commits) these fields, so that race is unreachable.
    -->
    @if (compact()) {
      <input
        type="color"
        class="color"
        [value]="r.color"
        [attr.aria-label]="r.name + ' color'"
        [attr.data-testid]="'region-color' + suffix()"
        (change)="onColor(r.id, $event)"
      />
      <input
        appInput
        class="rname"
        [value]="r.name"
        [attr.aria-label]="r.name + ' name'"
        [attr.data-testid]="'region-name' + suffix()"
        (change)="onName(r.id, $event)"
      />
    } @else {
      <div appField label="Name">
        <input
          appInput
          [value]="r.name"
          [attr.data-testid]="'region-name' + suffix()"
          (change)="onName(r.id, $event)"
        />
      </div>

      <div appField label="Color">
        <input
          type="color"
          [value]="r.color"
          [attr.data-testid]="'region-color' + suffix()"
          (change)="onColor(r.id, $event)"
        />
      </div>
    }
  `,
  styles: `
    :host {
      display: contents;
    }
    .color {
      flex: none;
      width: 18px;
      height: 18px;
      padding: 0;
      border: 1px solid var(--line-strong);
      border-radius: var(--radius-sm);
      background: none;
      cursor: pointer;
    }
    .rname {
      /* Layout only — field styling comes from appInput. */
      flex: 1;
      min-width: 0;
    }
  `,
})
export class RegionFields {
  private readonly store = inject(EditorStore);

  /** The region whose name and colour these fields edit. */
  readonly region = input.required<Region>();
  /** Inline legend layout (swatch + name) when true; labelled-field stack when false. */
  readonly compact = input(false);
  /** Appended to the field test ids so a legend's per-region inputs stay unique. */
  readonly suffix = input('');

  /** Rename the region to the text input's value (issue #36). */
  protected onName(id: string, event: Event): void {
    this.store.renameRegion(id, inputValue(event));
  }

  /** Recolour the region to the colour input's value (issue #36). */
  protected onColor(id: string, event: Event): void {
    this.store.recolorRegion(id, inputValue(event));
  }
}

import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Region } from '@hexly/domain';
import { Field } from '../../../ui/field';
import { Input } from '../../../ui/input';
import { inputValue } from '../utils/dom';
import { HexMapStore } from '../services/hexmap-store';

/**
 * The name + colour editor for a single {@link Region} — the one place the two
 * field controls and their commit handlers live, used by the Inspector's region
 * editor (issue #36). It lays the fields out as a labelled stack; the host is
 * `display: contents`, so they appear as direct children of whichever container
 * hosts the component.
 */
@Component({
  selector: 'app-region-fields',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  imports: [Field, Input, TranslocoPipe],
  template: `
    @let r = region();
    <!--
      One-way [value] with (change): an OnPush re-render mid-edit could re-apply
      the bound value, but any in-app action that re-renders also blurs (and thus
      commits) these fields, so that race is unreachable.
    -->
    <div appField [label]="'editorShell.inspector.name' | transloco">
      <input
        appInput
        [value]="r.name"
        data-testid="region-name"
        (change)="onName(r.id, $event)"
      />
    </div>

    <div appField [label]="'editorShell.inspector.color' | transloco">
      <input
        type="color"
        [value]="r.color"
        data-testid="region-color"
        (change)="onColor(r.id, $event)"
      />
    </div>
  `,
})
export class RegionFields {
  private readonly store = inject(HexMapStore);

  /** The region whose name and colour these fields edit. */
  readonly region = input.required<Region>();

  /** Rename the region to the text input's value (issue #36). */
  protected onName(id: string, event: Event): void {
    this.store.renameRegion(id, inputValue(event));
  }

  /** Recolour the region to the colour input's value (issue #36). */
  protected onColor(id: string, event: Event): void {
    this.store.recolorRegion(id, inputValue(event));
  }
}

import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Region } from '../../lib';
import { Field, Input } from '@hexly/web-ui';
import { inputValue } from '../utils/dom';
import { HexMapStore } from '../services/hexmap-store';

/**
 * Name + colour editor for a single {@link Region} (issue #36).
 * Fields laid out as a stack; host is `display: contents`.
 */
@Component({
  selector: 'app-region-fields',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  imports: [Field, Input, TranslocoPipe],
  template: `
    @let r = region();
    <div appField [label]="'map.inspector.name' | transloco">
      <input appInput [value]="r.name" data-testid="region-name" (change)="onName(r.id, $event)" />
    </div>

    <div appField [label]="'map.inspector.color' | transloco">
      <input type="color" [value]="r.color" data-testid="region-color" (change)="onColor(r.id, $event)" />
    </div>
  `,
})
export class RegionFields {
  private readonly store = inject(HexMapStore);

  readonly region = input.required<Region>();

  protected onName(id: string, event: Event): void {
    this.store.renameRegion(id, inputValue(event));
  }

  protected onColor(id: string, event: Event): void {
    this.store.recolorRegion(id, inputValue(event));
  }
}

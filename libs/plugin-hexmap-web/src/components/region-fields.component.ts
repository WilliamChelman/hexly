import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Region } from '@hexly/plugin-hexmap';
import { FieldComponent, InputComponent } from '@hexly/web-ui';
import { inputValue } from '../utils/input-value';
import { HexMapStore } from '../services/hexmap-store';

/** Name + colour editor for a single {@link Region}. */
@Component({
  selector: 'app-region-fields',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  imports: [FieldComponent, InputComponent, TranslocoPipe],
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
export class RegionFieldsComponent {
  private readonly store = inject(HexMapStore);

  readonly region = input.required<Region>();

  protected onName(id: string, event: Event): void {
    this.store.renameRegion(id, inputValue(event));
  }

  protected onColor(id: string, event: Event): void {
    this.store.recolorRegion(id, inputValue(event));
  }
}

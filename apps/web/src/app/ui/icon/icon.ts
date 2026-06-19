import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import {
  CompassIcon,
  FeatureIcon,
  FitIcon,
  LabelIcon,
  LogoIcon,
  MinusIcon,
  MoonIcon,
  OverlayIcon,
  PlusIcon,
  RegionIcon,
  SettlementIcon,
  ShareIcon,
  SunIcon,
} from './glyphs';

/** The glyphs reachable by name through {@link Icon}. */
export type IconName =
  | 'logo'
  | 'sun'
  | 'moon'
  | 'share'
  | 'settlement'
  | 'feature'
  | 'overlay'
  | 'region'
  | 'label'
  | 'compass'
  | 'plus'
  | 'minus'
  | 'fit';

/**
 * Selects a glyph component by `name`, so callers needn't import each one or
 * inline its SVG. Each `app-icon-*` it renders owns its own markup — this is a
 * dispatcher, not a sprite. See ADR-0007.
 *
 *   <app-icon name="share" [size]="16" />
 *   <app-icon [name]="tool.glyph" [size]="18" />
 */
@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LogoIcon,
    SunIcon,
    MoonIcon,
    ShareIcon,
    SettlementIcon,
    FeatureIcon,
    OverlayIcon,
    RegionIcon,
    LabelIcon,
    CompassIcon,
    PlusIcon,
    MinusIcon,
    FitIcon,
  ],
  styles: `:host { display: inline-flex; line-height: 0; }`,
  template: `
    @switch (name()) {
      @case ('logo') { <app-icon-logo [size]="size()" /> }
      @case ('sun') { <app-icon-sun [size]="size()" /> }
      @case ('moon') { <app-icon-moon [size]="size()" /> }
      @case ('share') { <app-icon-share [size]="size()" /> }
      @case ('settlement') { <app-icon-settlement [size]="size()" /> }
      @case ('feature') { <app-icon-feature [size]="size()" /> }
      @case ('overlay') { <app-icon-overlay [size]="size()" /> }
      @case ('region') { <app-icon-region [size]="size()" /> }
      @case ('label') { <app-icon-label [size]="size()" /> }
      @case ('compass') { <app-icon-compass [size]="size()" /> }
      @case ('plus') { <app-icon-plus [size]="size()" /> }
      @case ('minus') { <app-icon-minus [size]="size()" /> }
      @case ('fit') { <app-icon-fit [size]="size()" /> }
    }
  `,
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input(24);
}

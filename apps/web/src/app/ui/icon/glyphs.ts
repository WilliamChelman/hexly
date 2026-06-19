import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/*
 * One component per glyph. Each owns exactly one `<svg>` drawn in
 * `currentColor`, so colour comes from the surrounding `color` and size from
 * the `size` input. Feature templates never inline this markup — they reach a
 * glyph through `<app-icon>` (see icon.ts) or a direct `app-icon-*` selector.
 * See ADR-0007.
 *
 * Shared host style keeps the wrapper shrink-wrapped to the svg.
 */
const HOST = `:host { display: inline-flex; line-height: 0; }`;

@Component({
  selector: 'app-icon-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: HOST,
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 24 24"
      fill="none"
    >
      <path
        d="M12 2.2 20.5 7v10L12 21.8 3.5 17V7z"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linejoin="round"
      />
      <path
        d="M12 7.4 16.2 9.9v4.2L12 16.6 7.8 14.1V9.9z"
        fill="currentColor"
        opacity=".5"
      />
    </svg>
  `,
})
export class LogoIcon {
  readonly size = input(24);
}

@Component({
  selector: 'app-icon-sun',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: HOST,
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
    >
      <circle cx="12" cy="12" r="4" />
      <path
        d="M12 2.5v2M12 19.5v2M4.5 12h-2M21.5 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M18.4 5.6l1.4-1.4M4.2 19.8l1.4-1.4"
      />
    </svg>
  `,
})
export class SunIcon {
  readonly size = input(24);
}

@Component({
  selector: 'app-icon-moon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: HOST,
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 24 24"
      fill="none"
    >
      <path
        d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linejoin="round"
      />
      <circle cx="15.5" cy="7.5" r=".9" fill="currentColor" />
      <circle cx="18" cy="11" r=".6" fill="currentColor" />
    </svg>
  `,
})
export class MoonIcon {
  readonly size = input(24);
}

@Component({
  selector: 'app-icon-share',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: HOST,
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <circle cx="6" cy="12" r="2.4" />
      <circle cx="18" cy="6" r="2.4" />
      <circle cx="18" cy="18" r="2.4" />
      <path d="m8.1 10.8 7.8-3.6M8.1 13.2l7.8 3.6" />
    </svg>
  `,
})
export class ShareIcon {
  readonly size = input(24);
}

@Component({
  selector: 'app-icon-settlement',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: HOST,
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linejoin="round"
    >
      <path d="M5 19v-7l7-5 7 5v7z" />
      <path d="M10 19v-4h4v4" />
    </svg>
  `,
})
export class SettlementIcon {
  readonly size = input(24);
}

@Component({
  selector: 'app-icon-feature',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: HOST,
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linejoin="round"
    >
      <path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4z" />
    </svg>
  `,
})
export class FeatureIcon {
  readonly size = input(24);
}

@Component({
  selector: 'app-icon-overlay',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: HOST,
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
    >
      <path
        d="M3 8c3 0 3 3 6 3s3-3 6-3 3 3 6 3M3 15c3 0 3 3 6 3s3-3 6-3 3 3 6 3"
      />
    </svg>
  `,
})
export class OverlayIcon {
  readonly size = input(24);
}

@Component({
  selector: 'app-icon-region',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: HOST,
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linejoin="round"
      stroke-dasharray="3 2.5"
    >
      <path d="M5 7c4-3 9-2 12 1s2 8-2 10-11 1-12-4 2-4 2-7z" />
    </svg>
  `,
})
export class RegionIcon {
  readonly size = input(24);
}

@Component({
  selector: 'app-icon-label',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: HOST,
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
    >
      <path d="M6 6h12M12 6v12M9.5 18h5" />
    </svg>
  `,
})
export class LabelIcon {
  readonly size = input(24);
}

@Component({
  selector: 'app-icon-compass',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: HOST,
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.3"
    >
      <circle cx="12" cy="12" r="9" />
      <path
        d="m12 4 2 8 8 2-8 2-2 8-2-8-8-2 8-2z"
        fill="currentColor"
        stroke="none"
        opacity=".85"
      />
    </svg>
  `,
})
export class CompassIcon {
  readonly size = input(24);
}

@Component({
  selector: 'app-icon-plus',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: HOST,
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
    >
      <path d="M12 6v12M6 12h12" />
    </svg>
  `,
})
export class PlusIcon {
  readonly size = input(24);
}

@Component({
  selector: 'app-icon-minus',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: HOST,
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
    >
      <path d="M6 12h12" />
    </svg>
  `,
})
export class MinusIcon {
  readonly size = input(24);
}

@Component({
  selector: 'app-icon-fit',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: HOST,
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M5 9V5h4M19 9V5h-4M5 15v4h4M19 15v4h-4" />
    </svg>
  `,
})
export class FitIcon {
  readonly size = input(24);
}

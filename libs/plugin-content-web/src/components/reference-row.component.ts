import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { LinkedEntity } from '@hexly/domain';

/**
 * One row of the References panel: an Entity at the far end of a link, plus the Link Descriptor
 * characterising it. Both directions render through here.
 *
 * `entity` of `null` is the outbound dangling case — a target that is deleted, or that this viewer
 * cannot read — rendered non-navigable under the same dangling string a Content link shows. An
 * inbound row never passes `null`: its sources are access-filtered server-side.
 */
@Component({
  selector: 'app-reference-row',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TranslocoPipe],
  host: { class: 'flex items-center gap-1.5 py-1 pr-2' },
  template: `
    @if (entity(); as target) {
      <!-- A resolved Thumbnail (ADR-0066) lets the link list read visually; a row without one is
           unchanged (no glyph placeholder). Decorative — the name is the accessible label. -->
      @if (target.thumbnailUrl) {
        <img
          class="shrink-0 size-6 rounded-sm object-cover bg-surface-sunken"
          loading="lazy"
          draggable="false"
          [src]="target.thumbnailUrl"
          [attr.data-testid]="'reference-thumbnail-' + target.id"
          alt=""
        />
      }
      <a
        [routerLink]="['/entities', target.id]"
        class="min-w-0 flex-1 truncate text-sm text-ink-muted no-underline hover:text-ink"
        >{{ target.name }}</a
      >
    } @else {
      <span
        data-dangling=""
        [attr.title]="'editor.entityLink.dangling' | transloco"
        class="min-w-0 flex-1 truncate text-sm italic text-ink-muted"
        >{{ 'editor.entityLink.dangling' | transloco }}</span
      >
    }
    @if (descriptor()) {
      <span
        data-testid="link-descriptor"
        class="shrink-0 rounded-full bg-gold-soft px-1.5 text-[0.65rem] font-semibold leading-tight text-gold-strong"
        >{{ descriptor() }}</span
      >
    }
  `,
})
export class ReferenceRowComponent {
  /** The far end of the link, or `null` for a dangling outbound target. */
  readonly entity = input.required<LinkedEntity | null>();
  /** The Link Descriptor, as the author spelled it. */
  readonly descriptor = input.required<string | null>();
}

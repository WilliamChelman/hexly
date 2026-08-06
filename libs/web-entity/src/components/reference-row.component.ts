import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { LinkedEntity, NamedContainer } from '@hexly/domain';

/**
 * One row of the References Panel: an Entity at the far end of a link, plus the Link Descriptor
 * characterising it. Both directions render through here.
 *
 * `entity` of `null` is the outbound dangling case — a target that is deleted, or that this viewer
 * cannot read — rendered non-navigable under the same dangling string a Content link shows. An
 * inbound row never passes `null`: its sources are access-filtered server-side.
 *
 * A `decor` row is a **Decor Link** (ADR-0069) — presentation, not worldbuilding meaning. Outbound it
 * shows only once revealed; inbound it always shows, marked, so a mere thumbnail reads apart from a
 * prose mention.
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
        [attr.title]="'fields.entityLink.dangling' | transloco"
        class="min-w-0 flex-1 truncate text-sm italic text-ink-muted"
        >{{ 'fields.entityLink.dangling' | transloco }}</span
      >
    }
    @if (foreignContainer(); as container) {
      <!-- Usage from another Container (ADR-0080), named rather than counted: a shelf Entity's keeper
           needs to know which Worlds use it before deleting it. -->
      <span
        data-testid="reference-foreign-container"
        [attr.data-container-id]="container.id"
        [attr.title]="'fields.links.foreignContainer' | transloco: { name: container.name }"
        class="shrink-0 max-w-28 truncate rounded-full bg-surface-sunken px-1.5 text-[0.65rem] font-semibold leading-tight text-ink-faint"
        >{{ container.name }}</span
      >
    }
    @if (decor()) {
      <!-- The decor mark: what distinguishes a mere thumbnail/prose image from a semantic mention. -->
      <span
        data-testid="reference-decor-mark"
        [attr.title]="'fields.links.decorMark' | transloco"
        class="shrink-0 rounded-full bg-surface-sunken px-1.5 text-[0.65rem] font-semibold leading-tight text-ink-faint"
        >{{ 'fields.links.decor' | transloco }}</span
      >
    }
    @if (descriptor()) {
      <span
        data-testid="link-descriptor"
        class="shrink-0 rounded-full bg-accent-soft px-1.5 text-[0.65rem] font-semibold leading-tight text-accent-strong"
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
  /** A Decor Link (ADR-0069) — draws the presentation mark. Defaults off for a plain semantic row. */
  readonly decor = input<boolean>(false);
  /**
   * The **Container** this row's link was made in, when that is not the open Entity's own (ADR-0080) —
   * drawn as a named mark. Absent for everything at home, which is nearly every row.
   */
  readonly foreignContainer = input<NamedContainer | undefined>(undefined);
}

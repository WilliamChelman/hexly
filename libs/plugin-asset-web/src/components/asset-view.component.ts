import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, translateSignal } from '@jsverse/transloco';
import { EMPTY, catchError, distinctUntilChanged, map, switchMap } from 'rxjs';
import { EntityReferences } from '@hexly/domain';
import { EntitiesClient } from '@hexly/web-core';
import { ENTITY_SESSION } from '@hexly/web-entity';
import { ContentEditorComponent } from '@hexly/plugin-content/editor';
import { EyebrowComponent, IconComponent, IconName, SwatchComponent } from '@hexly/web-ui';
import { assetKind, assetValueUrl, readAssetValue } from '@hexly/plugin-asset';

/** The icon-card glyph each Asset kind falls back to when its View can't render the bytes inline (ADR-0065). */
const KIND_ICONS: Record<string, IconName> = {
  image: 'asset',
  pdf: 'asset-pdf',
  audio: 'asset-audio',
  other: 'asset-file',
};

/**
 * The `core.view.asset` renderer (ADR-0065): the Asset's one View, dispatching on mime — the image
 * renderer today, an **icon card** for any other kind, so a non-image Asset (a future PDF/audio) degrades
 * gracefully with zero new machinery. It backs both the **Asset detail page** and, through the Entity View
 * Outlet's transclusion (ADR-0062), a Board **Embed** of an Asset.
 *
 * It is the whole detail page in one View: the rendered image/icon, the mechanical **Asset Stats**, the
 * canonical **Content** prose (the very {@link ContentEditorComponent} an Entity's Content uses — so
 * authoring works identically, gated by {@link EntitySession.writable}), and the Asset's **usage** as the
 * Entities that link to it (per-viewer filtered inbound links, ADR-0046).
 *
 * The prose editor reads its Field key from the ambient `VIEW_FIELD_KEY` the Outlet provides — `null` for a
 * Type's own View placed by id — and so falls back to its canonical `core.field.content`, which is exactly
 * the Asset's prose Field (ADR-0051). `display:contents` so the scroll column positions against `<main>`.
 */
@Component({
  selector: 'app-asset-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  imports: [ContentEditorComponent, RouterLink, EyebrowComponent, IconComponent, SwatchComponent, TranslocoPipe],
  template: `
    <div class="absolute inset-0 overflow-y-auto bg-surface-sunken">
      <div class="mx-auto flex max-w-[60rem] flex-col gap-6 px-6 py-6">
        <!-- The rendered Asset (ADR-0065): the image inline when the bytes are an image and load, else the
             icon card — the same fallback a broken/deleted URL degrades to, so one missing Asset never blanks
             the page (mirrors the Board Image element). -->
        @if (showImage()) {
          <img
            class="mx-auto max-h-[60vh] max-w-full rounded-md border border-line bg-surface object-contain shadow-1"
            [src]="imageUrl()"
            [attr.alt]="name()"
            data-testid="asset-image"
            (error)="onImageError()"
          />
        } @else {
          <div
            class="mx-auto flex w-full max-w-sm flex-col items-center gap-2 rounded-md border border-line bg-surface px-6 py-10 text-ink-muted"
            data-testid="asset-icon-card"
          >
            <app-icon [name]="kindIcon()" [size]="48" />
            <span class="max-w-full truncate text-sm text-ink">{{ name() }}</span>
            @if (mime(); as m) {
              <span class="text-xs">{{ m }}</span>
            }
          </div>
        }

        <!-- Asset Stats: the mechanical, write-time facts (ADR-0065). Absent rows drop out, so a stats-less
             Asset (extraction failed, or a non-image) still shows its mime/size. -->
        <section data-testid="asset-stats">
          <span appEyebrow mark class="mb-2 block">{{ 'asset.stats.heading' | transloco }}</span>
          <dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
            @if (dimensions(); as d) {
              <dt class="text-ink-muted">{{ 'asset.stats.dimensions' | transloco }}</dt>
              <dd class="m-0 text-ink" data-testid="asset-stat-dimensions">{{ d }}</dd>
            }
            @if (orientation(); as o) {
              <dt class="text-ink-muted">{{ 'asset.stats.orientation' | transloco }}</dt>
              <dd class="m-0 text-ink">{{ 'asset.orientation.' + o | transloco }}</dd>
            }
            @if (dominantColor(); as color) {
              <dt class="text-ink-muted">{{ 'asset.stats.dominantColor' | transloco }}</dt>
              <dd class="m-0 flex items-center gap-2 text-ink">
                <span appSwatch [style.background]="color"></span>
                <span class="font-mono text-xs">{{ color }}</span>
              </dd>
            }
            @if (mime(); as m) {
              <dt class="text-ink-muted">{{ 'asset.stats.mime' | transloco }}</dt>
              <dd class="m-0 text-ink">{{ m }}</dd>
            }
            @if (size(); as s) {
              <dt class="text-ink-muted">{{ 'asset.stats.size' | transloco }}</dt>
              <dd class="m-0 text-ink">{{ s }}</dd>
            }
          </dl>
        </section>

        <!-- Canonical Content prose (ADR-0065): the same editor an Entity's Content uses, so credits/license/
             lore author identically. Field key falls to core.field.content via the Outlet's null VIEW_FIELD_KEY. -->
        <section>
          <span appEyebrow mark class="mb-2 block">{{ 'asset.prose.heading' | transloco }}</span>
          <app-content-editor [ariaLabel]="editorLabel()" />
        </section>

        <!-- Usage (ADR-0065/ADR-0046): the Entities that link here, resolved per viewer. Always shown — the
             detail page's answer to "where is this Asset used" before you touch it. -->
        <section data-testid="asset-usage">
          <span appEyebrow mark class="mb-2 block">{{ 'asset.usage.heading' | transloco }}</span>
          @for (ref of referencedBy(); track $index) {
            <a
              [routerLink]="['/entities', ref.source.id]"
              class="block truncate py-1 text-sm text-ink-muted no-underline hover:text-ink"
              data-testid="asset-usage-row"
              >{{ ref.source.name }}</a
            >
          } @empty {
            @if (usageLoaded()) {
              <p class="text-sm text-ink-muted" data-testid="asset-usage-empty">
                {{ 'asset.usage.empty' | transloco }}
              </p>
            }
          }
        </section>
      </div>
    </div>
  `,
})
export class AssetViewComponent {
  private readonly session = inject(ENTITY_SESSION);
  private readonly entities = inject(EntitiesClient);

  /** The Content editor's accessible name (ADR-0014), reusing the type's editor label copy. */
  protected readonly editorLabel = translateSignal('asset.editorLabel');

  /** The Asset Entity's name — the image's alt text and the icon card's label. */
  protected readonly name = computed(() => this.session.current()?.name ?? '');

  /** The asset-ref off the open document, or `null` for a bare/placeholder Asset (forward-only read). */
  private readonly value = computed(() => readAssetValue(this.session.doc()));

  /** A URL that failed to load — so the render degrades to the icon card rather than a broken-image glyph. */
  private readonly brokenUrl = signal<string | null>(null);

  /** The served capability URL for the bytes, or `''` when there is no ref yet (ADR-0034). */
  protected readonly imageUrl = computed(() => {
    const value = this.value();
    const worldId = this.session.current()?.worldId;
    return value && worldId ? assetValueUrl(worldId, value) : '';
  });

  protected readonly mime = computed(() => this.value()?.mime ?? '');

  /** Whether to draw the image inline: an image-kind ref whose URL resolved and has not failed to load. */
  protected readonly showImage = computed(() => {
    const url = this.imageUrl();
    return url !== '' && assetKind(this.mime()) === 'image' && this.brokenUrl() !== url;
  });

  /** The icon-card glyph for the Asset's kind — the graceful fallback for a non-image (or unloadable) Asset. */
  protected readonly kindIcon = computed<IconName>(() => KIND_ICONS[assetKind(this.mime())] ?? KIND_ICONS['other']);

  /** The pixel dimensions `W × H`, when an extractor wrote them. */
  protected readonly dimensions = computed(() => {
    const stats = this.value()?.stats;
    return stats?.width && stats?.height ? `${stats.width} × ${stats.height}` : null;
  });

  protected readonly orientation = computed(() => this.value()?.stats?.orientation ?? null);

  protected readonly dominantColor = computed(() => {
    const color = this.value()?.stats?.dominantColor;
    return typeof color === 'string' ? color : null;
  });

  /** The byte size, humanised; `null` for a bare ref (nothing minted yet). */
  protected readonly size = computed(() => {
    const value = this.value();
    return value && value.size > 0 ? formatBytes(value.size) : null;
  });

  private readonly _references = signal<{ id: string; value: EntityReferences } | null>(null);

  /** The held references, but only while they still describe the open Asset (mirrors the References panel). */
  private readonly references = computed(() => {
    const held = this._references();
    return held && held.id === this.session.current()?.id ? held.value : undefined;
  });

  /** The Entities that link here (usage), access-filtered server-side per viewer (ADR-0046). */
  protected readonly referencedBy = computed(() => this.references()?.referencedBy ?? []);

  /** False until the open Asset's usage has landed, so the empty state never flashes over an in-flight fetch. */
  protected readonly usageLoaded = computed(() => this.references() !== undefined);

  constructor() {
    // Usage is keyed on the open Asset's (id, seq) — the derived edge index the server rebuilds on a
    // committed save (ADR-0045) — so a rename or a new inbound link refetches; switchMap cancels an outrun
    // fetch so responses never land out of order, and a failed fetch keeps the last-known list.
    const target = computed(() => {
      const entity = this.session.current();
      return entity ? { id: entity.id, seq: entity.seq } : null;
    });
    toObservable(target)
      .pipe(
        distinctUntilChanged((a, b) => a?.id === b?.id && a?.seq === b?.seq),
        switchMap((t) =>
          t
            ? this.entities.references(t.id).pipe(
                map((value) => ({ id: t.id, value })),
                catchError(() => EMPTY),
              )
            : EMPTY,
        ),
        takeUntilDestroyed(),
      )
      .subscribe((held) => this._references.set(held));
  }

  /** Mark the current URL broken so the render falls back to the icon card (the original-is-fallback rule). */
  protected onImageError(): void {
    this.brokenUrl.set(this.imageUrl());
  }
}

/** Humanise a byte count for the Stats row (locale-agnostic, so the pure View needs no Intl plumbing). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

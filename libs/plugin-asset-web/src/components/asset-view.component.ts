import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TranslocoPipe, translateSignal } from '@jsverse/transloco';
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
 * Missing Bytes (#325) render ahead of the mime dispatch; Stats and prose still render, being document facts.
 *
 * It is the detail page's main content in one View: the rendered image/icon, the mechanical **Asset
 * Stats**, and the canonical **Content** prose (the very {@link ContentEditorComponent} an Entity's
 * Content uses — so authoring works identically, gated by {@link EntitySession.writable}). The Asset's
 * **usage** ("where is this used") is no longer a bespoke inline list here: the page's universal
 * References panel answers it on every View, Assets included (ADR-0067).
 *
 * The prose editor reads its Field key from the ambient `VIEW_FIELD_KEY` the Outlet provides — `null` for a
 * Type's own View placed by id — and so falls back to its canonical `core.field.content`, which is exactly
 * the Asset's prose Field (ADR-0051). `display:contents` so the scroll column positions against `<main>`.
 */
@Component({
  selector: 'app-asset-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  imports: [ContentEditorComponent, EyebrowComponent, IconComponent, SwatchComponent, TranslocoPipe],
  template: `
    <div class="absolute inset-0 overflow-y-auto bg-surface-sunken">
      <div class="mx-auto flex max-w-[60rem] flex-col gap-6 px-6 py-6">
        <!-- The rendered Asset (ADR-0065): the image inline when the bytes are an image and load, else the
             icon card — the same fallback a broken/deleted URL degrades to, so one missing Asset never blanks
             the page (mirrors the Board Image element). Missing Bytes are their own state ahead of that
             fallback, and emit no src (#325). -->
        @if (bytesMissing()) {
          <div
            class="mx-auto flex w-full max-w-sm flex-col items-center gap-2 rounded-md border border-dashed border-accent bg-surface px-6 py-10 text-center"
            role="status"
            data-testid="asset-missing"
          >
            <app-icon name="asset-missing" [size]="48" class="text-accent" />
            <span class="max-w-full truncate text-sm text-ink-strong">{{ name() }}</span>
            <span class="text-sm text-ink">{{ 'asset.missing.title' | transloco }}</span>
            <span class="text-xs text-ink-muted">{{ 'asset.missing.hint' | transloco }}</span>
          </div>
        } @else if (showImage()) {
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
      </div>
    </div>
  `,
})
export class AssetViewComponent {
  private readonly session = inject(ENTITY_SESSION);

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

  /** Distinct from the icon-card fallback, which also means "not an image" (#325). */
  protected readonly bytesMissing = computed(() => this.session.current()?.assetBytesMissing === true);

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

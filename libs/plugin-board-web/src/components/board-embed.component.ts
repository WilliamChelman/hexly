import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { DEFAULT_MAX_EMBED_DEPTH, EmbedElement } from '@hexly/plugin-board';
import { ClientConfigStore, entityRoute } from '@hexly/web-core';
import {
  DEFAULT_ENTITY_RENDER_CONTEXT,
  ENTITY_RENDER_CONTEXT,
  ENTITY_SESSION,
  ENTITY_VIEW_OUTLET,
} from '@hexly/web-entity';
import { PLUGIN_ID } from '@hexly/plugin-board';
import { BoardStore } from '../services/board-store';

/**
 * An **Embed** Board Element's face (ADR-0062, #270): another Entity rendered inline by full live
 * transclusion of a chosen **View**, through the app's Entity View Outlet — reached across the
 * `ENTITY_VIEW_OUTLET` seam, since a plugin cannot import the app (ADR-0048). The Outlet owns the
 * cycle/depth/unrenderable → card and unreadable/deleted → dangling fallbacks; this element only
 * *positions* it and threads the render context.
 *
 * **Recursion bounds** are threaded here: the Embed reads where its Board sits ({@link ENTITY_RENDER_CONTEXT},
 * absent at the page root) and advances it — appending *this* Board's Entity id to the ancestor chain and
 * incrementing depth — so a Board embedding itself (directly or through a cycle) is caught and deep nests
 * stop, at the Instance-configured `features.plugin.board.maxEmbedDepth` (default 3).
 *
 * **Arm/disarm** (CONTEXT.md → Embed): static by default — `pointer-events-none`, so surface gestures move
 * it — until a double-click arms it, when it captures the pointer for read-interaction (pan / scroll /
 * click-through into the transcluded View). A click-out disarms it back to static. An un-armed Embed's
 * **open** affordance navigates to the target Entity (editing the target means opening it, never through
 * the Embed).
 */
@Component({
  selector: 'app-board-embed',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block w-full h-full overflow-hidden relative bg-surface-sunken',
    '[class.pointer-events-none]': '!armed()',
  },
  imports: [NgComponentOutlet, TranslocoPipe],
  template: `
    @if (outlet) {
      <ng-container *ngComponentOutlet="outlet; inputs: outletInputs()" />
    }
    <!-- Open the target Entity: the un-armed Embed's click-through (editing means opening the target). Always
         pointer-interactive, so it works whether or not the Embed is armed. -->
    <button
      type="button"
      class="open-target"
      data-testid="embed-open-target"
      [attr.aria-label]="'board.embed.openTarget' | transloco"
      (pointerdown)="$event.stopPropagation()"
      (click)="openTarget($event)"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
        <path d="M14 5h5v5M19 5l-8 8M18 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
      </svg>
    </button>
  `,
  styles: `
    @reference '#app-styles.css';

    .open-target {
      @apply absolute top-1 right-1 z-[1] flex items-center justify-center w-6 h-6 rounded-md pointer-events-auto;
      @apply text-ink-muted bg-surface/80 border border-line opacity-0 transition-opacity;
      @apply hover:text-ink hover:border-gold focus-visible:opacity-100 outline-none;
    }
    :host(:hover) .open-target {
      @apply opacity-100;
    }
    .open-target svg {
      @apply w-4 h-4;
    }
  `,
})
export class BoardEmbedComponent {
  /** The Embed element this renders — its `targetEntityId` and chosen `viewInstance`, plus geometry. */
  readonly element = input.required<EmbedElement>();

  private readonly store = inject(BoardStore);
  private readonly session = inject(ENTITY_SESSION);
  private readonly clientConfig = inject(ClientConfigStore);
  private readonly router = inject(Router);
  private readonly parentContext = inject(ENTITY_RENDER_CONTEXT, { optional: true }) ?? DEFAULT_ENTITY_RENDER_CONTEXT;

  /** The app-bound Entity View Outlet host; absent only if the app never bound the seam (never in the shipped build). */
  protected readonly outlet = inject(ENTITY_VIEW_OUTLET, { optional: true });

  /** Whether this Embed is the armed element — the flip between static preview and live read-interaction. */
  protected readonly armed = computed(() => this.store.armed() === this.element().id);

  /**
   * The render context this Embed's transclusion sits at (ADR-0062): the context this Board renders at,
   * advanced by one — *this* Board's Entity id appended to the ancestor chain (so a self-embed is a cycle),
   * depth incremented, and the Instance-configured cap threaded from the client config channel.
   */
  private readonly outletContext = computed(() => {
    const boardId = this.session.current()?.id;
    const maxDepth = this.clientConfig.pluginConfig(PLUGIN_ID)?.maxEmbedDepth ?? DEFAULT_MAX_EMBED_DEPTH;
    return {
      ancestorIds: boardId ? [...this.parentContext.ancestorIds, boardId] : [...this.parentContext.ancestorIds],
      depth: this.parentContext.depth + 1,
      maxDepth,
    };
  });

  /** The inputs bound onto the outlet host: the target, the chosen View key, and the advanced render context. */
  protected readonly outletInputs = computed(() => ({
    entityId: this.element().targetEntityId,
    viewKey: this.element().viewInstance,
    renderContext: this.outletContext(),
  }));

  /** Navigate to the target Entity — the un-armed Embed's click-through (CONTEXT.md → Embed). */
  protected openTarget(event: Event): void {
    event.stopPropagation();
    const targetId = this.element().targetEntityId;
    const worldId = this.session.current()?.worldId;
    if (worldId && targetId) void this.router.navigate(entityRoute(worldId, targetId));
  }
}

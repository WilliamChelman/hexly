import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { ButtonComponent, IconComponent } from '@hexly/web-ui';
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
  imports: [NgComponentOutlet, RouterLink, ButtonComponent, IconComponent, TranslocoPipe],
  template: `
    @if (outlet) {
      <ng-container *ngComponentOutlet="outlet; inputs: outletInputs()" />
    }
    <!-- Open the target Entity: the un-armed Embed's click-through (editing means opening the target). A real
         anchor, so ctrl/cmd-click opens the target in a new tab; always pointer-interactive, so it works
         whether or not the Embed is armed. Revealed by hovering the containing element box (see styles). -->
    @if (targetLink(); as link) {
      <a
        appButton
        variant="ghost"
        size="sm"
        icon
        class="open-target"
        data-testid="embed-open-target"
        [routerLink]="link"
        [attr.aria-label]="'board.embed.openTarget' | transloco"
        (pointerdown)="$event.stopPropagation()"
        (click)="$event.stopPropagation()"
      >
        <app-icon name="external-link" [size]="16" />
      </a>
    }
  `,
  styles: `
    @reference '#app-styles.css';

    .open-target {
      @apply absolute top-1 right-1 z-[1] pointer-events-auto opacity-0 transition-opacity;
    }
    /* Reveal on the *element box's* hover, not the host's: the un-armed host is pointer-events-none, so
       it never hovers itself — the box above the canvas owns the pointer, including in a read-only
       transclusion where this link is the only chrome. Quiet on box hover, full on the link itself. */
    :host-context(.element:hover) .open-target {
      @apply opacity-60;
    }
    .open-target:hover,
    .open-target:focus-visible {
      @apply opacity-100;
    }
  `,
})
export class BoardEmbedComponent {
  /** The Embed element this renders — its `targetEntityId` and chosen `viewInstance`, plus geometry. */
  readonly element = input.required<EmbedElement>();

  private readonly store = inject(BoardStore);
  private readonly session = inject(ENTITY_SESSION);
  private readonly clientConfig = inject(ClientConfigStore);
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

  /**
   * The route to the target Entity — the un-armed Embed's click-through (CONTEXT.md → Embed), as a real
   * `routerLink` so ctrl/cmd-click opens it in a new tab. Null (affordance hidden) until both ids resolve.
   */
  protected readonly targetLink = computed(() => {
    const targetId = this.element().targetEntityId;
    const worldId = this.session.current()?.worldId;
    return worldId && targetId ? entityRoute(worldId, targetId) : null;
  });
}

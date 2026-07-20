import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  ButtonComponent,
  IconComponent,
  IconName,
  MenuItemDirective,
  MenuPanelDirective,
  MenuTriggerDirective,
} from '@hexly/web-ui';
import { entityRoute } from '@hexly/web-core';
import { ENTITY_SESSION } from '@hexly/web-entity';
import { EmbedElement, ImageElement, TextElement } from '@hexly/plugin-board';
import { BoardStore } from '../services/board-store';

/** A z-order move offered by the stacking-order menu — its store method, label, glyph, and test id. */
interface ZAction {
  readonly id: 'toFront' | 'bringForward' | 'sendBackward' | 'toBack';
  readonly labelKey: string;
  readonly icon: IconName;
  readonly testid: string;
}

/** The four stacking moves, top-of-stack first — the same set the Inspector offers, grouped into a menu. */
const Z_ACTIONS: readonly ZAction[] = [
  { id: 'toFront', labelKey: 'board.inspector.toFront', icon: 'board-to-front', testid: 'control-z-to-front' },
  { id: 'bringForward', labelKey: 'board.inspector.bringForward', icon: 'board-forward', testid: 'control-z-forward' },
  {
    id: 'sendBackward',
    labelKey: 'board.inspector.sendBackward',
    icon: 'board-backward',
    testid: 'control-z-backward',
  },
  { id: 'toBack', labelKey: 'board.inspector.toBack', icon: 'board-to-back', testid: 'control-z-to-back' },
];

/**
 * The floating control strip above a selected Image, Embed, or Text Block (CONTEXT.md → Image/Embed/Text
 * Block): a small toolbar anchored to the element's top-left in screen space, carrying the actions dragging
 * can't express. Related actions collapse into drop-down menus (`appMenuTrigger`, a trailing caret marks
 * them) so the strip stays a few glyphs wide; the menus render in a CDK overlay, so they escape the element
 * box's clipping.
 *
 * Rendered as a *sibling* of the element box in the overlay, never a child — an Image/Embed box is
 * `overflow-hidden`, which would clip a toolbar floated above its top edge. So it takes the box's screen
 * {@link left}/{@link top} as inputs and lifts itself above with a transform.
 *
 * **Embed** — the open-target link (also the un-armed Embed's own click-through, kept there for the
 * read-only transclusion that has no selection toolbar), plus the shared *resize* menu.
 *
 * **Text Block** — the shared *resize* menu (its prose scrolls on an `overflow-auto` host, so fit height
 * grows the box to show it all).
 *
 * **Embed & Text Block** share the *resize* menu: fit width / fit height / fit both, each growing the box
 * until its scrollable content stops overflowing that axis so the reader loses the scrollbar. The
 * measurement scans the content host *and every scroll container nested in it* (an Embed's View owns its own
 * `overflow:auto` scrollers, so the visible scrollbar is often on a descendant) — see {@link axisOverflow}.
 *
 * **Image** — *fit to image*, which retunes the box height to the picture's natural ratio so the
 * `object-contain` letterbox collapses, and the aspect-ratio *lock* toggle (persisted on the element via
 * {@link BoardStore.setLockRatio}), which constrains subsequent resize-handle drags.
 *
 * **Every kind** shares a *stacking-order* menu (the four z-order moves the Inspector also offers).
 */
@Component({
  selector: 'app-board-element-controls',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    ButtonComponent,
    IconComponent,
    TranslocoPipe,
    MenuTriggerDirective,
    MenuPanelDirective,
    MenuItemDirective,
  ],
  // Anchored to the element box's screen top-left; a press must not fall through to start a board gesture
  // or deselect (the strip sits above the canvas), so it swallows pointerdown and each button owns its click.
  host: {
    class: 'controls',
    '[style.left.px]': 'left()',
    '[style.top.px]': 'top()',
    '(pointerdown)': '$event.stopPropagation()',
  },
  template: `
    @let el = element();
    <!-- An Embed's open-target link: the only kind-specific direct action left of the menus. -->
    @if (el.kind === 'embed' && targetLink(); as link) {
      <a
        appButton
        variant="ghost"
        size="sm"
        icon
        data-testid="control-open-target"
        [routerLink]="link"
        [attr.aria-label]="'board.embed.openTarget' | transloco"
        (click)="$event.stopPropagation()"
      >
        <app-icon name="external-link" [size]="16" />
      </a>
    }
    @if (el.kind === 'image') {
      <button
        type="button"
        appButton
        variant="ghost"
        size="sm"
        icon
        data-testid="control-fit-image"
        [attr.aria-label]="'board.controls.fitImage' | transloco"
        (click)="fitImage()"
      >
        <app-icon name="fit" [size]="16" />
      </button>
      <button
        type="button"
        appButton
        variant="ghost"
        size="sm"
        icon
        [active]="locked()"
        [attr.aria-pressed]="locked()"
        data-testid="control-lock-ratio"
        [attr.aria-label]="'board.controls.lockRatio' | transloco"
        (click)="toggleLock()"
      >
        <app-icon [name]="locked() ? 'board-lock-ratio' : 'board-lock-ratio-open'" [size]="16" />
      </button>
    } @else {
      <!-- Embed/Text Block: a resize menu growing the box until its scrollable content stops overflowing. -->
      <button
        type="button"
        appButton
        variant="ghost"
        size="sm"
        data-testid="control-resize"
        [appMenuTrigger]="resizeMenu"
        [attr.aria-label]="'board.controls.resize' | transloco"
      >
        <app-icon name="board-resize" [size]="16" />
        <app-icon class="caret" name="chevron-down" [size]="12" />
      </button>
    }

    <!-- Stacking-order menu — shared by every kind. -->
    <button
      type="button"
      appButton
      variant="ghost"
      size="sm"
      data-testid="control-order"
      [appMenuTrigger]="orderMenu"
      [attr.aria-label]="'board.controls.order' | transloco"
    >
      <app-icon name="board-stack" [size]="16" />
      <app-icon class="caret" name="chevron-down" [size]="12" />
    </button>

    <ng-template #resizeMenu>
      <div appMenuPanel>
        <button type="button" appMenuItem data-testid="control-fit-width" (triggered)="fitWidth()">
          <span class="row"
            ><app-icon name="board-fit-width" [size]="16" /> {{ 'board.controls.fitWidth' | transloco }}</span
          >
        </button>
        <button type="button" appMenuItem data-testid="control-fit-height" (triggered)="fitHeight()">
          <span class="row"
            ><app-icon name="board-fit-height" [size]="16" /> {{ 'board.controls.fitHeight' | transloco }}</span
          >
        </button>
        <button type="button" appMenuItem data-testid="control-fit-both" (triggered)="fitBoth()">
          <span class="row"><app-icon name="fit" [size]="16" /> {{ 'board.controls.fitBoth' | transloco }}</span>
        </button>
      </div>
    </ng-template>

    <ng-template #orderMenu>
      <div appMenuPanel>
        @for (z of zActions; track z.id) {
          <button type="button" appMenuItem [attr.data-testid]="z.testid" (triggered)="onZ(z.id)">
            <span class="row"><app-icon [name]="z.icon" [size]="16" /> {{ z.labelKey | transloco }}</span>
          </button>
        }
      </div>
    </ng-template>
  `,
  styles: `
    @reference '#app-styles.css';

    :host(.controls) {
      @apply absolute z-[2] flex items-center gap-1 p-1 rounded-lg border border-line bg-surface-raised shadow-2 pointer-events-auto;
      /* Lift the strip clear of the element's top edge; the anchor is the box's top-left in screen space. */
      transform: translateY(calc(-100% - var(--spacing) * 2));
    }
    /* A menu row's glyph + label. */
    .row {
      @apply flex items-center gap-2;
    }
    /* The drop-down affordance on a menu trigger — a quiet caret trailing the group glyph. */
    .caret {
      @apply -ml-0.5 opacity-60;
    }
  `,
})
export class BoardElementControlsComponent {
  /** The single selected element this strip controls — an Image, Embed, or Text Block. */
  readonly element = input.required<ImageElement | EmbedElement | TextElement>();
  /** The element box's screen-space top-left, so the strip anchors to it under pan/zoom. */
  readonly left = input.required<number>();
  readonly top = input.required<number>();

  private readonly store = inject(BoardStore);
  private readonly session = inject(ENTITY_SESSION);

  /** The stacking-order moves for the order menu's `@for`. */
  protected readonly zActions = Z_ACTIONS;

  /** Whether the Image's aspect-ratio lock is on — drives the toggle's pressed face. */
  protected readonly locked = computed(() => {
    const el = this.element();
    return el.kind === 'image' && !!el.lockRatio;
  });

  /** The route to an Embed's target Entity — the open-target link; null until both ids resolve. */
  protected readonly targetLink = computed(() => {
    const el = this.element();
    if (el.kind !== 'embed') return null;
    const worldId = this.session.current()?.worldId;
    return worldId && el.targetEntityId ? entityRoute(worldId, el.targetEntityId) : null;
  });

  /** Grow the Embed/Text Block's width until its content no longer overflows horizontally. */
  protected fitWidth(): void {
    const el = this.element();
    const overflow = this.axisOverflow(el.id, 'x');
    if (overflow <= 0) return;
    this.store.resize(el.id, { width: el.size.width + overflow, height: el.size.height });
  }

  /** Grow the Embed/Text Block's height until its content no longer overflows vertically. */
  protected fitHeight(): void {
    const el = this.element();
    const overflow = this.axisOverflow(el.id, 'y');
    if (overflow <= 0) return;
    this.store.resize(el.id, { width: el.size.width, height: el.size.height + overflow });
  }

  /** Grow the Embed/Text Block on both axes at once, dropping either scrollbar — one undo step. */
  protected fitBoth(): void {
    const el = this.element();
    const dx = this.axisOverflow(el.id, 'x');
    const dy = this.axisOverflow(el.id, 'y');
    if (dx <= 0 && dy <= 0) return;
    this.store.resize(el.id, {
      width: el.size.width + Math.max(0, dx),
      height: el.size.height + Math.max(0, dy),
    });
  }

  /** Dispatch a stacking-order move from the order menu to the store. */
  protected onZ(action: ZAction['id']): void {
    this.store[action](this.element().id);
  }

  /** Retune the Image box's height to the picture's natural ratio, collapsing the letterbox. */
  protected fitImage(): void {
    const el = this.element();
    const img = document.querySelector<HTMLImageElement>(
      `[data-testid="element-${el.id}"] [data-testid="image-asset"]`,
    );
    if (!img?.naturalWidth || !img.naturalHeight) return;
    const ratio = img.naturalWidth / img.naturalHeight;
    this.store.resize(el.id, { width: el.size.width, height: el.size.width / ratio });
  }

  /** Flip the Image's persisted aspect-ratio lock. */
  protected toggleLock(): void {
    this.store.setLockRatio(this.element().id, !this.locked());
  }

  /**
   * The largest content overflow on `axis` among the element's content host and every scroll container
   * nested inside it — the amount a reader would otherwise scroll on that axis. An Embed's transcluded View
   * owns its own `overflow:auto` scrollers and a Text Block's prose scrolls on its own host, so the visible
   * scrollbar is usually on the host or a *descendant*; scanning them (rather than only the outer box) is
   * what lets fit catch the real overflow. The content host is the sole child of the element box's `.content`
   * wrapper — kind-agnostic, so one path serves Embed and Text Block.
   *
   * `scrollWidth`/`clientWidth` are layout values, read before the content wrapper's camera-zoom transform,
   * so the result is already in the element's world units and adds straight onto its size. Returns 0 when
   * nothing overflows, so the caller no-ops.
   */
  private axisOverflow(id: string, axis: 'x' | 'y'): number {
    const host = document.querySelector<HTMLElement>(`[data-testid="element-${id}"] .content > *`);
    if (!host) return 0;
    const scroll = axis === 'x' ? 'scrollWidth' : 'scrollHeight';
    const client = axis === 'x' ? 'clientWidth' : 'clientHeight';
    const prop = axis === 'x' ? 'overflowX' : 'overflowY';
    let max = 0;
    for (const el of [host, ...Array.from(host.querySelectorAll<HTMLElement>('*'))]) {
      const overflowStyle = getComputedStyle(el)[prop];
      // A visible scrollbar comes from an `auto`/`scroll` container; always include the content host itself
      // (an Embed's is overflow-hidden) as a fallback — "fit to content" when nothing inside scrolls.
      const scrollable = el === host || overflowStyle === 'auto' || overflowStyle === 'scroll';
      if (!scrollable) continue;
      max = Math.max(max, el[scroll] - el[client]);
    }
    return max;
  }
}

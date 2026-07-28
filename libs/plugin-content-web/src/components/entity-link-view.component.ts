import {
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EnvironmentInjector,
  Injector,
  Signal,
  afterRenderEffect,
  computed,
  createComponent,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { Editor } from '@tiptap/core';
import { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeView } from '@tiptap/pm/view';
import { EntitySummary, wikilinkName } from '@hexly/domain';
import { EntitySearchPickerComponent } from '@hexly/web-entity';
import { BodyPortalDirective, ButtonComponent } from '@hexly/web-ui';
import { EntityNameResolver, EntityResolution } from '../services/entity-name-resolver';

/** The repair a broken link affords, supplied by the node view that owns the document position. */
export interface EntityLinkRepair {
  /**
   * Whether the surface accepts writes. A read-only viewer keeps the inert label and is never
   * offered a write they cannot perform (ADR-0073).
   */
  readonly writable: Signal<boolean>;
  /**
   * Whether the caller may create Entities in the host Entity's World. Create is a write, so it
   * inherits the Contributor gate: without it the row is absent, not present-and-failing (ADR-0073).
   */
  readonly creatable: Signal<boolean>;
  /** Rewrite this link's target in place: the prose, the `display` and the `heading` are untouched. */
  readonly retarget: (entity: EntitySummary) => void;
  /** Mint an Entity named `name` and point this link at it, in place, on the same terms. */
  readonly promote: (name: string) => void;
}

/** The half of a repair the editing surface owns; the node view supplies the document position. */
export interface EntityLinkRepairHost extends Pick<EntityLinkRepair, 'writable' | 'creatable'> {
  /** Mint `name` in the host Entity's World; rejects once the failure has been reported to the author. */
  readonly mint: (name: string) => Promise<EntitySummary>;
}

/**
 * Renders a Content Entity Link inline (ADR-0023). Resolves `entityId` to the target's
 * **live** name via {@link EntityNameResolver}, falling back to the stored `label` while
 * the owner list loads (no placeholder flash) or when the target is missing/deleted — a
 * dangling link renders muted and is non-navigable.
 *
 * Three renderings, not two: a link with no id is an *Unresolved Link* — a name never
 * written — and must not read as a *dangling* one, whose target went away (ADR-0073).
 *
 * Either broken rendering is clickable for a writer, opening the repair popover: an import
 * resolves wikilinks by basename, so `[[Zorblax]]` routinely misses an Entity named "Zorblax
 * the Devourer" and retargeting is the fix that does not mint a duplicate (ADR-0073).
 */
@Component({
  selector: 'app-entity-link-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TranslocoPipe, BodyPortalDirective, ButtonComponent, EntitySearchPickerComponent],
  // `relative inline-block` makes each link its own positioning context so the
  // descriptor badge can anchor to the pill's top-right corner (see below).
  host: { class: 'relative inline-block align-baseline' },
  template: `
    @if (tone() === 'live') {
      <!-- routerLink gives a real href, so the browser handles Ctrl/Cmd/middle-click
           (open in a new tab) while a plain click SPA-navigates through the same
           flush-on-leave guard as the back-to-library link. Reachable because the
           node view is created with ContentEditor's element Injector, which resolves
           the route's ActivatedRoute (createEntityLinkNodeView). -->
      <a
        data-testid="entity-link"
        [attr.data-entity-id]="entityId()"
        [routerLink]="['/entities', entityId()]"
        [fragment]="heading() || undefined"
        class="cursor-pointer inline-block rounded-sm bg-accent-soft px-1.5 py-0.5 leading-tight text-accent-strong no-underline transition-colors hover:bg-accent/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >{{ text() }}</a
      >
    } @else {
      <!-- Both broken renderings, one element: they differ in tone and in the data attribute a spec
           reads them apart by, never in the repair affordance, which must not drift (ADR-0073). -->
      <span
        data-testid="entity-link"
        [attr.data-unresolved]="tone() === 'unresolved' ? '' : null"
        [attr.data-dangling]="tone() === 'dangling' ? '' : null"
        [attr.data-entity-id]="tone() === 'dangling' ? entityId() : null"
        [attr.title]="brokenTitleKey() | transloco"
        class="inline-block rounded-sm px-1.5 py-0.5 leading-tight"
        [class]="brokenTone()"
        [class.cursor-pointer]="repairable()"
        [attr.role]="repairable() ? 'button' : null"
        [attr.tabindex]="repairable() ? 0 : null"
        [attr.aria-haspopup]="repairable() ? 'dialog' : null"
        [attr.aria-expanded]="repairable() ? repairOpen() : null"
        (click)="toggleRepair()"
        (keydown.enter)="toggleRepair()"
        (keydown.space)="toggleRepair(); $event.preventDefault()"
        >{{ text() }}</span
      >
    }
    <!-- The Link Descriptor (#96) rides on the pill's top-right corner as a small
         badge: right edge flush with the pill (right-0), growing leftward, so the
         relationship reads as metadata rather than interrupting the prose. -->
    @if (descriptor()) {
      <span
        data-testid="link-descriptor"
        class="pointer-events-none absolute -top-1.5 right-0 whitespace-nowrap rounded-full px-0.5 text-[0.6em] font-semibold leading-none text-ink-stroke shadow-1"
        [class.bg-accent]="tone() === 'live'"
        [class.bg-tone-5]="tone() === 'unresolved'"
        [class.bg-ink-muted]="tone() === 'dangling'"
        >{{ descriptor() }}</span
      >
    }
    @if (repairOpen()) {
      <!-- Portaled to <body>: the pill sits inside the editor's contenteditable, and on a Board
           under a scaled ancestor that would capture a fixed-position descendant. -->
      <div
        #repairMenu
        appBodyPortal
        role="dialog"
        data-testid="entity-link-repair"
        class="fixed z-50 w-64"
        [attr.aria-label]="'editor.entityLink.repairLabel' | transloco"
        [style.left.px]="repairAt().x"
        [style.top.px]="repairAt().y"
      >
        @if (picking()) {
          <app-entity-search-picker
            testid="entity-link-repair-picker"
            placeholderKey="editor.entityLink.relinkSearch"
            emptyKey="editor.entityLink.relinkEmpty"
            [query]="query()"
            (queryChange)="query.set($event)"
            (pick)="choose($event)"
          />
        } @else {
          <div class="rounded-md border border-line bg-surface p-1 shadow-2">
            <!-- *Create* is an Unresolved Link's alone (#350); a dangling one must not get it, because
                 a failed resolver batch reads every id as missing, and a bad connection would mint a
                 duplicate of an Entity that exists and is fine (ADR-0073). -->
            @if (promotable()) {
              <!-- Naming what it mints rather than the display text it renders as (ADR-0073). -->
              <button
                type="button"
                appButton
                variant="ghost"
                size="sm"
                class="w-full justify-start!"
                data-testid="entity-link-repair-create"
                (click)="promote()"
              >
                {{ 'editor.entityLink.create' | transloco: { name: promotedName() } }}
              </button>
            }
            <button
              type="button"
              appButton
              variant="ghost"
              size="sm"
              class="w-full justify-start!"
              data-testid="entity-link-repair-relink"
              (click)="picking.set(true)"
            >
              {{ 'editor.entityLink.relink' | transloco }}
            </button>
          </div>
        }
      </div>
    }
  `,
})
export class EntityLinkViewComponent {
  readonly entityId = input.required<string>();
  readonly label = input.required<string>();
  readonly descriptor = input<string | null>(null);
  /** `[[Target|display]]` static override text (ADR-0033); when set it replaces the live name. */
  readonly display = input<string | null>(null);
  /** `[[Target#Heading]]` anchor (ADR-0033); rendered as the routerLink fragment so navigation scrolls to it. */
  readonly heading = input<string | null>(null);
  /** Absent wherever no document position backs the link (a spec, a static render): no popover. */
  readonly repair = input<EntityLinkRepair | null>(null);

  private readonly resolver = inject(EntityNameResolver);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly repairMenu = viewChild<ElementRef<HTMLElement>>('repairMenu');

  /** `null` when no id was ever stored — an Unresolved Link resolves nothing, so it joins no batch. */
  private readonly resolution = computed<EntityResolution | null>(() =>
    this.entityId() ? this.resolver.resolve(this.entityId()) : null,
  );

  /**
   * Which of the three renderings this link takes (ADR-0073) — one discrimination the
   * template and the descriptor badge both read, so the two cannot drift.
   */
  protected readonly tone = computed<'live' | 'unresolved' | 'dangling'>(() => {
    const r = this.resolution();
    if (!r) return 'unresolved';
    return r.status === 'missing' ? 'dangling' : 'live';
  });

  /**
   * The static `display` override when set (the one exception to the live-name rule,
   * ADR-0033); otherwise the live name when resolved, and the stored label while
   * loading, unresolved or dangling.
   */
  protected readonly text = computed(() => {
    const override = this.display();
    if (override) return override;
    const r = this.resolution();
    return r?.status === 'found' ? r.entity.name : this.label();
  });

  /**
   * A broken pill's tone. An Unresolved Link is tinted and dashed rather than faded, so it reads as
   * unfinished rather than broken, and the dash carries that without relying on hue (ADR-0073); a
   * dangling one is the muted last-known label (issue #78). Neither is navigable.
   */
  protected readonly brokenTone = computed(() =>
    this.tone() === 'unresolved'
      ? 'bg-tone-5-soft text-tone-5 underline decoration-dashed underline-offset-2'
      : 'bg-ink-faint/15 italic text-ink-muted',
  );

  protected readonly brokenTitleKey = computed(() =>
    this.tone() === 'unresolved' ? 'editor.entityLink.unresolved' : 'editor.entityLink.dangling',
  );

  /** Only a broken link is repairable, and only where the surface accepts writes (ADR-0073). */
  protected readonly repairable = computed(() => this.tone() !== 'live' && !!this.repair()?.writable());

  /**
   * What promoting mints: the `label`, never the `display`, read by the one rule the import mints under
   * too ({@link wikilinkName}) — the same link must not name two different Entities (ADR-0073).
   */
  protected readonly promotedName = computed(() => wikilinkName(this.label()));

  /**
   * Repairable, unresolved rather than dangling, and holding create rights in the World (ADR-0073).
   * A label that is no name at all offers nothing rather than a blank Entity the server would refuse.
   */
  protected readonly promotable = computed(
    () => this.repairable() && this.tone() === 'unresolved' && !!this.repair()?.creatable() && !!this.promotedName(),
  );

  protected readonly repairOpen = signal(false);
  /** Viewport coordinates of the open popover — held apart from {@link repairOpen} so re-anchoring is not a re-open. */
  protected readonly repairAt = signal({ x: 0, y: 0 });
  /** False on the action list, true once *Link to an existing Entity…* swapped it for the picker. */
  protected readonly picking = signal(false);
  protected readonly query = signal('');

  constructor() {
    // Bound only while open: a note carries dozens of links, and a permanent listener per link
    // would run — and schedule a change detection — on every press anywhere in the app.
    effect((onCleanup) => {
      if (!this.repairOpen()) return;
      // mousedown, not click: a click inside the popover has already re-rendered it by the time it
      // arrives, so a containment test would read a detached node and dismiss on its own action.
      const onDown = (event: MouseEvent) => this.onOutsideDown(event);
      const onKey = (event: KeyboardEvent) => {
        if (event.key === 'Escape') this.closeRepair(true);
      };
      // Capture: `scroll` does not bubble, and the pill scrolls inside the editor's own box, not the page.
      const reanchor = () => this.repairAt.set(this.anchor());
      document.addEventListener('mousedown', onDown);
      document.addEventListener('keydown', onKey);
      window.addEventListener('scroll', reanchor, true);
      window.addEventListener('resize', reanchor);
      onCleanup(() => {
        document.removeEventListener('mousedown', onDown);
        document.removeEventListener('keydown', onKey);
        window.removeEventListener('scroll', reanchor, true);
        window.removeEventListener('resize', reanchor);
      });
    });

    // The popover is portaled to the end of <body>, so Tab from the pill would skip straight past it:
    // move the keyboard in explicitly, and again when the action list becomes the picker.
    afterRenderEffect(() => {
      if (!this.repairOpen()) return;
      this.picking();
      const menu = this.repairMenu()?.nativeElement;
      // After the render callbacks, not during: `appBodyPortal` relocates this very element in one of
      // them, and moving a node blurs whatever inside it held the keyboard.
      queueMicrotask(() => menu?.querySelector<HTMLElement>('input, button')?.focus());
    });
  }

  protected toggleRepair(): void {
    if (this.repairOpen()) {
      this.closeRepair();
      return;
    }
    if (!this.repairable()) return;
    this.picking.set(false);
    this.query.set('');
    this.repairAt.set(this.anchor());
    this.repairOpen.set(true);
  }

  protected choose(entity: EntitySummary): void {
    this.repair()?.retarget(entity);
    this.closeRepair();
  }

  /** Closed on the gesture rather than on the mint landing: the write reports its own failure. */
  protected promote(): void {
    this.repair()?.promote(this.promotedName());
    this.closeRepair();
  }

  /**
   * Clamped rather than flipped: the popover is not measured at this point, so a pill near an edge
   * gets an opening that is wholly on screen instead of one sized against a guess.
   */
  private anchor(): { x: number; y: number } {
    const pill = this.host.nativeElement.getBoundingClientRect();
    return {
      x: clamp(pill.left, GUTTER, window.innerWidth - REPAIR_WIDTH - GUTTER),
      y: clamp(pill.bottom + GAP, GUTTER, window.innerHeight - REPAIR_MAX_HEIGHT - GUTTER),
    };
  }

  private closeRepair(restoreFocus = false): void {
    this.repairOpen.set(false);
    this.picking.set(false);
    // Only on Esc: a dismissing click has already put the focus where the reader pointed it.
    if (restoreFocus) this.host.nativeElement.querySelector<HTMLElement>('[data-testid=entity-link]')?.focus();
  }

  /** Dismiss on a press landing neither on the pill nor in the popover — which is portaled away from both. */
  private onOutsideDown(event: MouseEvent): void {
    const target = event.target as Node;
    if (this.host.nativeElement.contains(target) || this.repairMenu()?.nativeElement.contains(target)) return;
    this.closeRepair();
  }
}

/** The popover's `w-64`, the gap under the pill, the viewport gutter, and the tallest the picker gets. */
const REPAIR_WIDTH = 256;
const REPAIR_MAX_HEIGHT = 272;
const GUTTER = 8;
const GAP = 4;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(value, Math.max(min, max)));

/**
 * Bridge a ProseMirror node to an {@link EntityLinkViewComponent}.
 *
 * `environmentInjector` must be the route-level injector where {@link EntityNameResolver}
 * is provided. `elementInjector` must be ContentEditor's node injector, which lives inside
 * the router outlet: the environment injector alone cannot resolve the `ActivatedRoute` the
 * component's `routerLink` needs.
 *
 * `host` carries the two standings as signals, so a Board Text Block that arms mid-session — or a
 * World whose rights land after mount — gains its actions without a re-render (ADR-0073).
 */
export function createEntityLinkNodeView(
  node: ProseMirrorNode,
  editor: Editor,
  getPos: () => number | undefined,
  host: EntityLinkRepairHost,
  environmentInjector: EnvironmentInjector,
  elementInjector: Injector,
  appRef: ApplicationRef,
): NodeView {
  const ref = createComponent(EntityLinkViewComponent, {
    environmentInjector,
    elementInjector,
  });
  const apply = (n: ProseMirrorNode) => {
    ref.setInput('entityId', n.attrs['entityId'] ?? '');
    ref.setInput('label', n.attrs['label'] ?? '');
    ref.setInput('descriptor', n.attrs['descriptor'] ?? null);
    ref.setInput('display', n.attrs['display'] ?? null);
    ref.setInput('heading', n.attrs['heading'] ?? null);
  };
  apply(node);
  // setNodeMarkup on the node's own position, so only the target changes: the prose either side
  // is never touched, and `display`, `heading` and the descriptor ride through (ADR-0073).
  const pointAt = (entity: EntitySummary) => {
    const pos = getPos();
    if (pos === undefined) return;
    editor.commands.command(({ tr }) => {
      const current = tr.doc.nodeAt(pos);
      if (current?.type.name !== node.type.name) return false;
      tr.setNodeMarkup(pos, undefined, { ...current.attrs, entityId: entity.id, label: entity.name });
      return true;
    });
  };
  // The link stays unresolved until the mint lands, so it can be clicked again meanwhile — and a second
  // mint is exactly the duplicate ADR-0073 keeps Create away from a dangling link to avoid.
  let minting = false;
  ref.setInput('repair', {
    writable: host.writable,
    creatable: host.creatable,
    retarget: pointAt,
    // The same rewrite behind a mint, so promoting keeps what retargeting keeps. The mint reports its
    // own failure, so a rejection leaves the link as it was.
    promote: (name) => {
      if (minting) return;
      minting = true;
      void host
        .mint(name)
        .then(pointAt, () => undefined)
        .finally(() => (minting = false));
    },
  } satisfies EntityLinkRepair);
  appRef.attachView(ref.hostView);

  return {
    dom: ref.location.nativeElement as HTMLElement,
    update: (updated) => {
      if (updated.type.name !== node.type.name) return false;
      apply(updated);
      return true;
    },
    // The atom owns its own interaction (the link); keep ProseMirror out.
    stopEvent: () => true,
    ignoreMutation: () => true,
    destroy: () => {
      appRef.detachView(ref.hostView);
      ref.destroy();
    },
  };
}

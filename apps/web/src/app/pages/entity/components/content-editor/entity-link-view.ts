import {
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  EnvironmentInjector,
  Injector,
  computed,
  createComponent,
  inject,
  input,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeView } from '@tiptap/pm/view';
import { EntityNameResolver } from '../../services/entity-name-resolver';

/**
 * The app's first Angular TipTap node view (ADR-0023): renders a Content Entity
 * Link inline. It resolves `entityId` to the target's **live** name via the
 * shared {@link EntityNameResolver}, falling back to the stored `label` while the
 * owner list loads (no placeholder flash) or — in a muted *dangling* style — when
 * the target is missing/deleted. `routerLink` SPA-navigates to `/entities/:id` on
 * a plain click while letting Ctrl/Cmd/middle-click open a new tab; a dangling link
 * is non-navigable (issue #78). Deletion is plain atom backspace.
 */
@Component({
  selector: 'app-entity-link-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TranslocoPipe],
  // `relative inline-block` makes each link its own positioning context so the
  // descriptor badge can anchor to the pill's top-right corner (see below).
  host: { class: 'relative inline-block align-baseline' },
  template: `
    @if (dangling()) {
      <!-- Target missing/deleted: last-known label, non-navigable (issue #78). -->
      <span
        data-testid="entity-link"
        data-dangling=""
        [attr.data-entity-id]="entityId()"
        [attr.title]="'noteView.entityLink.dangling' | transloco"
        class="inline-block rounded bg-ink-faint/15 px-1.5 py-0.5 italic leading-tight text-ink-muted"
        >{{ text() }}</span
      >
    } @else {
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
        class="cursor-pointer inline-block rounded bg-gold-soft px-1.5 py-0.5 leading-tight text-gold-strong no-underline transition-colors hover:bg-gold/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
        >{{ text() }}</a
      >
    }
    <!-- The Link Descriptor (#96) rides on the pill's top-right corner as a small
         badge: right edge flush with the pill (right-0), growing leftward, so the
         relationship reads as metadata rather than interrupting the prose. -->
    @if (descriptor()) {
      <span
        class="pointer-events-none absolute -top-1.5 right-0 whitespace-nowrap rounded-full px-0.5 text-[0.6em] font-semibold leading-none text-ink-stroke shadow-1"
        [class.bg-gold]="!dangling()"
        [class.bg-ink-muted]="dangling()"
        >{{ descriptor() }}</span
      >
    }
  `,
})
export class EntityLinkView {
  readonly entityId = input.required<string>();
  readonly label = input.required<string>();
  readonly descriptor = input<string | null>(null);
  /** `[[Target|display]]` static override text (ADR-0033); when set it replaces the live name. */
  readonly display = input<string | null>(null);
  /** `[[Target#Heading]]` anchor (ADR-0033); rendered as the routerLink fragment so navigation scrolls to it. */
  readonly heading = input<string | null>(null);

  private readonly resolver = inject(EntityNameResolver);

  private readonly resolution = computed(() => this.resolver.resolve(this.entityId()));

  /** Target missing/deleted: render the last-known label, non-navigable. */
  protected readonly dangling = computed(() => this.resolution().status === 'missing');

  /**
   * What the link shows: the static `display` override when set (the one exception
   * to the live-name rule, ADR-0033); otherwise the live name when resolved, and
   * the stored label while loading or dangling.
   */
  protected readonly text = computed(() => {
    const override = this.display();
    if (override) return override;
    const r = this.resolution();
    return r.status === 'found' ? r.entity.name : this.label();
  });
}

/**
 * Bridge a ProseMirror node to an {@link EntityLinkView}. No `ngx-tiptap` here —
 * we mount the component imperatively (matching the hand-rolled `TiptapDirective`)
 * and feed node attrs through its signal inputs, re-applying on `update`.
 *
 * `environmentInjector` is the route-level injector where {@link EntityNameResolver}
 * is provided (so every node view shares the one resolver the picker reads).
 * `elementInjector` is ContentEditor's node injector, which lives inside the router
 * outlet — passing it lets the component's `routerLink` resolve `ActivatedRoute`
 * (absent from the environment injector alone, which is why this arg exists).
 */
export function createEntityLinkNodeView(
  node: ProseMirrorNode,
  environmentInjector: EnvironmentInjector,
  elementInjector: Injector,
  appRef: ApplicationRef,
): NodeView {
  const ref = createComponent(EntityLinkView, { environmentInjector, elementInjector });
  const apply = (n: ProseMirrorNode) => {
    ref.setInput('entityId', n.attrs['entityId'] ?? '');
    ref.setInput('label', n.attrs['label'] ?? '');
    ref.setInput('descriptor', n.attrs['descriptor'] ?? null);
    ref.setInput('display', n.attrs['display'] ?? null);
    ref.setInput('heading', n.attrs['heading'] ?? null);
  };
  apply(node);
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

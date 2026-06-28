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
  // Inline so it flows within the paragraph rather than breaking the line.
  host: { class: 'inline' },
  template: `
    @if (dangling()) {
      <!-- Target missing/deleted: last-known label, non-navigable (issue #78). -->
      <span
        data-testid="entity-link"
        data-dangling=""
        [attr.data-entity-id]="entityId()"
        [attr.title]="'noteView.entityLink.dangling' | transloco"
        class="italic text-ink-muted"
        >{{ display() }}@if (descriptor()) {<span> ({{ descriptor() }})</span>}</span
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
        class="cursor-pointer text-gold no-underline hover:underline"
        >{{ display()
        }}@if (descriptor()) {<span class="text-ink-muted"> ({{ descriptor() }})</span>}</a
      >
    }
  `,
})
export class EntityLinkView {
  readonly entityId = input.required<string>();
  readonly label = input.required<string>();
  readonly descriptor = input<string | null>(null);

  private readonly resolver = inject(EntityNameResolver);

  private readonly resolution = computed(() => this.resolver.resolve(this.entityId()));

  /** Target missing/deleted: render the last-known label, non-navigable. */
  protected readonly dangling = computed(() => this.resolution().status === 'missing');

  /** Live name when resolved; the stored label while loading or dangling. */
  protected readonly display = computed(() => {
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

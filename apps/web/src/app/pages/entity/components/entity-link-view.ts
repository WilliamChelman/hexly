import {
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  EnvironmentInjector,
  computed,
  createComponent,
  inject,
  input,
} from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeView } from '@tiptap/pm/view';
import { EntityNameResolver } from '../services/entity-name-resolver';

/**
 * The app's first Angular TipTap node view (ADR-0023): renders a Content Entity
 * Link inline. It resolves `entityId` to the target's **live** name via the
 * shared {@link EntityNameResolver}, falling back to the stored `label` while the
 * owner list loads (no placeholder flash) or — in a muted *dangling* style — when
 * the target is missing/deleted. A plain click SPA-navigates to `/entities/:id`;
 * a dangling link is non-navigable (issue #78). Deletion is plain atom backspace.
 */
@Component({
  selector: 'app-entity-link-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
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
      <!-- A real href so the browser handles Ctrl/Cmd/middle-click natively (open in
           a new tab); a plain left click is intercepted for SPA navigation via Router
           (the node view is created outside the outlet's injector, so routerLink's
           ActivatedRoute isn't reachable — Router, root-provided, is). SPA nav routes
           through flush-on-leave like the back-to-library link. -->
      <a
        data-testid="entity-link"
        [attr.data-entity-id]="entityId()"
        [href]="href()"
        class="cursor-pointer text-gold no-underline hover:underline"
        (click)="onClick($event)"
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
  private readonly router = inject(Router);

  private readonly resolution = computed(() => this.resolver.resolve(this.entityId()));

  /** Target missing/deleted: render the last-known label, non-navigable. */
  protected readonly dangling = computed(() => this.resolution().status === 'missing');

  /** Live name when resolved; the stored label while loading or dangling. */
  protected readonly display = computed(() => {
    const r = this.resolution();
    return r.status === 'found' ? r.entity.name : this.label();
  });

  /** The target's route as a real href so modified clicks open a new tab natively. */
  protected readonly href = computed(() => `/entities/${this.entityId()}`);

  protected onClick(event: MouseEvent): void {
    // Defer to the browser for new-tab/window gestures: modifier or non-primary clicks.
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    this.router.navigate(['/entities', this.entityId()]);
  }
}

/**
 * Bridge a ProseMirror node to an {@link EntityLinkView}. No `ngx-tiptap` here —
 * we mount the component imperatively (matching the hand-rolled `TiptapDirective`)
 * and feed node attrs through its signal inputs, re-applying on `update`. `injector`
 * must be the route-level {@link EnvironmentInjector} where {@link EntityNameResolver}
 * is provided, so every node view shares the one resolver the picker also reads.
 */
export function createEntityLinkNodeView(
  node: ProseMirrorNode,
  injector: EnvironmentInjector,
  appRef: ApplicationRef,
): NodeView {
  const ref = createComponent(EntityLinkView, { environmentInjector: injector });
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
    // The atom owns its own interaction (click → navigate); keep ProseMirror out.
    stopEvent: () => true,
    ignoreMutation: () => true,
    destroy: () => {
      appRef.detachView(ref.hostView);
      ref.destroy();
    },
  };
}

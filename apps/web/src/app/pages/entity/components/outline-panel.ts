import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  afterRenderEffect,
  computed,
  inject,
  signal,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Eyebrow } from '@hexly/web-ui';
import { OutlineStore } from '../services/outline-store';

/**
 * The Outline panel (CONTEXT.md): a nested, click-to-jump list of the Content's
 * headings, highlighting the one currently scrolled into view. Rendered only while
 * open, so its scrollspy lives exactly as long as the panel.
 *
 * Heading identity is positional: index i is the i-th non-empty heading in
 * document order, matching {@link extractOutline}'s skip rule — so the same index
 * addresses a row here and its rendered `<h*>` element, and duplicate heading
 * texts still jump to the right one.
 */
@Component({
  selector: 'app-outline-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Eyebrow, TranslocoPipe],
  host: { class: 'flex flex-col gap-1 p-3 overflow-y-auto bg-surface' },
  template: `
    <span appEyebrow mark class="mb-1">{{ 'noteView.outline.title' | transloco }}</span>

    @for (row of rows(); track $index) {
      <button
        type="button"
        class="w-full py-1 pr-2 text-sm text-left text-ink-muted truncate bg-transparent border-none rounded cursor-pointer hover:bg-gold-soft hover:text-ink aria-current:text-ink-strong aria-current:font-medium "
        [style.paddingLeft.rem]="0.5 + row.depth * 0.75"
        [attr.aria-current]="activeIndex() === $index ? 'true' : null"
        data-testid="outline-item"
        (click)="jump($index)"
      >
        {{ row.text }}
      </button>
    } @empty {
      <p class="text-sm leading-normal text-ink-muted" data-testid="outline-empty">
        {{ 'noteView.outline.empty' | transloco }}
      </p>
    }
  `,
})
export class OutlinePanel {
  protected readonly store = inject(OutlineStore);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly activeIndex = signal<number | null>(null);

  /** Rows ready to render: text + indent depth normalized to the shallowest heading present. */
  protected readonly rows = computed(() => {
    const headings = this.store.headings();
    const min = headings.length ? Math.min(...headings.map((h) => h.level)) : 1;
    return headings.map((h) => ({ text: h.text, depth: h.level - min }));
  });

  private observer?: IntersectionObserver;

  constructor() {
    // Rebuild the scrollspy after each render where the heading set changed (an edit
    // added/removed one): the new <h*> elements are in the DOM by afterRender, and
    // observing a not-yet-mounted node would be a silent no-op (same beat the anchor
    // scroll in content-editor.ts relies on).
    afterRenderEffect(() => {
      this.store.contentRoot(); // track: (re)bind once the editor element registers
      this.store.headings(); // track: re-observe when headings change
      this.setupObserver();
    });
    this.destroyRef.onDestroy(() => this.observer?.disconnect());
  }

  protected jump(index: number): void {
    const el = this.headingElements()[index];
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Scroll to read — deliberately not moving the editor cursor or stealing focus.
    el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  }

  /**
   * The rendered heading elements in document order, filtered to non-empty ones so
   * indices line up with {@link OutlineStore.headings} (extractOutline skips empties).
   * Scoped to the bridged editor element, so a second editor on the page is invisible.
   */
  private headingElements(): HTMLElement[] {
    const root = this.store.contentRoot();
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')).filter(
      (el) => (el.textContent ?? '').trim() !== '',
    );
  }

  private setupObserver(): void {
    this.observer?.disconnect();
    const scrollRoot = this.store.contentRoot()?.closest('[data-content-scroll]');
    const els = this.headingElements();
    if (!scrollRoot || !els.length) {
      this.activeIndex.set(els.length ? 0 : null);
      return;
    }
    // Trigger zone = top 30% of the scroll port: a heading is "active" while its row
    // sits near the top. Topmost intersecting wins; between zones we keep the last
    // active so the highlight never flickers off mid-scroll.
    const visible = new Set<number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const i = els.indexOf(entry.target as HTMLElement);
          if (i < 0) continue;
          if (entry.isIntersecting) visible.add(i);
          else visible.delete(i);
        }
        if (visible.size) this.activeIndex.set(Math.min(...visible));
      },
      { root: scrollRoot, rootMargin: '0px 0px -70% 0px', threshold: 0 },
    );
    els.forEach((el) => observer.observe(el));
    this.observer = observer;
    this.activeIndex.set(0); // something lit until the first callback resolves
  }
}

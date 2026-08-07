import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ParsedFacetQuery } from '@hexly/domain';
import {
  ListboxController,
  ListboxProps,
  ListboxComponent,
  ListboxEmptyComponent,
  ListboxOptionComponent,
  BodyPortalDirective,
  FacetMissComponent,
} from '@hexly/web-ui';
import { MentionItem } from '../extensions/mention-items';

/** What the `@`/`/link` suggestion plugin hands the picker on open/update. */
export type EntityPickerProps = ListboxProps<MentionItem>;

/**
 * The keyboard-driven Entity picker that opens on `@` (and via the `/link` slash item).
 * Matching by name is the suggestion plugin's job (server-side `q` search, ADR-0025);
 * the picker only renders what it is handed — the matches, then the `Create "…"` row that
 * mints the typed name and the `Create "…" with details…` row that mints it through the create
 * dialog (ADR-0073), both reached by the same arrow keys.
 */
@Component({
  selector: 'app-entity-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslocoPipe,
    ListboxComponent,
    ListboxOptionComponent,
    ListboxEmptyComponent,
    BodyPortalDirective,
    FacetMissComponent,
  ],
  template: `
    @if (visible()) {
      <app-listbox
        appBodyPortal
        testid="entity-picker"
        [ariaLabel]="(offersFacetKeys() ? 'editor.entityPicker.facetKeys' : 'editor.entityPicker.label') | transloco"
        [activeItemId]="activeItemId()"
        [anchor]="anchor()!"
      >
        <!-- No box of its own here — the mention *is* the box — so the shared row is placed by hand, as
             a presentational row of the list. What the Tokens applied nothing for is *said* (ADR-0082). -->
        <li role="presentation">
          <app-facet-miss
            class="px-3 py-1 text-xs text-ink-faint"
            [parsed]="facetMiss()"
            testid="entity-picker-unknown-facet"
          />
        </li>
        @for (item of items(); track item.id; let i = $index) {
          @if (item.kind === 'facet-key') {
            <li
              appListboxOption
              [optionId]="optionId(item.id)"
              [testid]="'entity-picker-facet-' + item.key"
              [selected]="i === activeIndex()"
              (pick)="select(item)"
            >
              <span class="font-mono text-xs">{{ item.key }}</span>
            </li>
          } @else if (item.kind === 'entity') {
            <li
              appListboxOption
              [optionId]="optionId(item.id)"
              [testid]="'entity-picker-option-' + item.id"
              [selected]="i === activeIndex()"
              (pick)="select(item)"
            >
              {{ item.entity.name }}
              <span class="font-mono text-2xs text-ink-muted">({{ item.entity.types[0] }})</span>
            </li>
          } @else if (item.kind === 'create') {
            <li
              appListboxOption
              [optionId]="optionId(item.id)"
              testid="entity-picker-create"
              [selected]="i === activeIndex()"
              (pick)="select(item)"
            >
              {{ 'editor.entityPicker.create' | transloco: { name: item.name } }}
            </li>
          } @else {
            <li
              appListboxOption
              [optionId]="optionId(item.id)"
              testid="entity-picker-create-details"
              [selected]="i === activeIndex()"
              (pick)="select(item)"
            >
              {{ 'editor.entityPicker.createDetails' | transloco: { name: item.name } }}
            </li>
          }
        } @empty {
          <li appListboxEmpty>
            {{ 'editor.entityPicker.empty' | transloco }}
          </li>
        }
      </app-listbox>
    }
  `,
})
export class EntityPickerComponent extends ListboxController<MentionItem> {
  protected readonly optionIdPrefix = 'entity-opt-';

  /** What the `$` names typed into the mention applied nothing for (ADR-0082). */
  protected readonly facetMiss = signal<ParsedFacetQuery | null>(null);

  /** Keys rather than Entities: the list is completing a `$` name, and says so. */
  protected readonly offersFacetKeys = computed(() => this.items()[0]?.kind === 'facet-key');

  /** Stated by the `@` trigger on every keystroke, search or no search. */
  showFacetMiss(parsed: ParsedFacetQuery | null): void {
    this.facetMiss.set(parsed);
  }

  /**
   * A completed Facet key leaves the list standing — the mention is still being written, and shutting
   * it on `$type:` would strand the author mid-token (ADR-0082).
   */
  protected override select(item: MentionItem): void {
    super.select(item);
    if (item.kind === 'facet-key') this.visible.set(true);
  }
}

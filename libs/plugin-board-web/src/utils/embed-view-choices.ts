import { map, Observable, of } from 'rxjs';
import { EntityViewChoice, EntityViewChoicesProvider, viewInstanceKey } from '@hexly/web-entity';

/** One of an Embed target's afforded Views, resolved across the seam and keyed for a `@for` / `<option>`. */
export type KeyedViewChoice = EntityViewChoice & { key: string };

/**
 * Resolve an Embed target's afforded Views across the `ENTITY_VIEW_CHOICES` seam and key each by its
 * View-instance key (ADR-0062) — the one projection the Inspector's View select and the Embed picker
 * both consume, so the resolution + keying lives here rather than duplicated at each call site. An absent
 * resolver (the app bound none) yields an empty list, so the caller offers only the target's default View.
 *
 * Callers must cancel the prior in-flight subscription on a target change (switchMap / explicit
 * unsubscribe), so an out-of-order response can't paint target A's Views under target B.
 */
export function keyedViewChoices(
  resolver: EntityViewChoicesProvider | null | undefined,
  entityId: string,
): Observable<readonly KeyedViewChoice[]> {
  return (resolver?.(entityId) ?? of<readonly EntityViewChoice[]>([])).pipe(
    map((choices) => choices.map((choice) => ({ ...choice, key: viewInstanceKey(choice.view) }))),
  );
}

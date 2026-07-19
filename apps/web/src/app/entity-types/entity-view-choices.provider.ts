import { EnvironmentProviders, inject, makeEnvironmentProviders } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { catchError, map, of } from 'rxjs';
import { EntityDetail } from '@hexly/domain';
import { EntitiesClient } from '@hexly/web-core';
import { ENTITY_VIEW_CHOICES, EntityViewChoice } from '@hexly/web-entity';
import { TypeRegistry } from './type-registry';
import { ViewRegistry } from './view-registry';

/**
 * Bind the `ENTITY_VIEW_CHOICES` seam (ADR-0062, #270): resolve the Views a Board **Embed** may render
 * its target through — the app owns the Type/View registries a plugin cannot reach, so it answers the
 * plugin's picker/inspector from here. Loads the target once, projects its afforded {@link ViewInstance}
 * set, and labels each the way the header's view toggle does (a Field of a Structured Data Type is
 * labelled from the Field it renders, ADR-0050). An unreadable/deleted target resolves to an empty list,
 * so the picker offers only the default View — never leaking a `private` Entity's shape.
 */
export function provideEntityViewChoices(): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: ENTITY_VIEW_CHOICES,
      useFactory: () => {
        const entities = inject(EntitiesClient);
        const types = inject(TypeRegistry);
        const views = inject(ViewRegistry);
        const transloco = inject(TranslocoService);

        return (entityId: string) =>
          entities.load(entityId).pipe(
            map((detail) => choicesFor(detail, types, views, transloco)),
            catchError(() => of<readonly EntityViewChoice[]>([])),
          );
      },
    },
  ]);
}

/** The target's afforded Views, each labelled — the Field's label for a Structured Data Type's View, else the View's own. */
function choicesFor(
  detail: EntityDetail,
  types: TypeRegistry,
  views: ViewRegistry,
  transloco: TranslocoService,
): EntityViewChoice[] {
  const attached = attachedFieldIds(detail, types);
  const fields = types.effectiveFields(detail.types, attached);
  return types.viewsFor(detail.types, attached).map((view) => {
    const field = fields.find((f) => f.id === view.fieldKey);
    const labelKey = field ? field.labelKey : views.resolve(view.viewId).labelKey;
    return { view, label: labelKey ? transloco.translate(labelKey) : (field?.label ?? view.viewId) };
  });
}

/** The target's directly-attached Field ids (ADR-0057): document keys that are registered Fields no type defaults. */
function attachedFieldIds(detail: EntityDetail, types: TypeRegistry): string[] {
  const typeDefaultIds = new Set(types.resolveFields(detail.types).map((field) => field.id));
  return Object.keys(detail.document).filter((key) => !typeDefaultIds.has(key) && types.field(key) !== undefined);
}

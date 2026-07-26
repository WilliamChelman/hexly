import { EnvironmentProviders, inject, makeEnvironmentProviders } from '@angular/core';
import { map } from 'rxjs';
import { DETAILED_ENTITY_CREATOR, DetailedEntitySeed } from '@hexly/web-entity';
import { DialogService } from '@hexly/web-ui';
import {
  CreateEntityDialogComponent,
  CreateEntityDialogData,
  CreateEntityDialogResult,
} from './create-entity-dialog.component';

/**
 * Bind the `DETAILED_ENTITY_CREATOR` seam (ADR-0073, #344): the `@` picker's `Create "…" with details…`
 * row opens the ordinary create dialog, which lives here beside the Type registry a plugin cannot reach.
 *
 * The seed's World is passed as the dialog's pin, so the select renders locked — the details path must
 * not do what the fast path forbids. Nothing navigates: the dialog returns its Entity (ADR-0073) and the
 * mention inserts a link, leaving the author mid-sentence.
 */
export function provideDetailedEntityCreator(): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: DETAILED_ENTITY_CREATOR,
      useFactory: () => {
        const dialogs = inject(DialogService);

        return (seed: DetailedEntitySeed) =>
          dialogs
            .open<CreateEntityDialogData, CreateEntityDialogResult>(CreateEntityDialogComponent, {
              type: seed.type,
              worldId: seed.worldId,
              name: seed.name,
              tags: seed.tags,
            })
            // `closed` emits once — `undefined` on cancel — then completes, so the caller's
            // `firstValueFrom` resolves either way and nothing stays subscribed to a torn-down dialog.
            .closed.pipe(map((entity) => entity ?? null));
      },
    },
  ]);
}

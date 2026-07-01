import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { EntityType } from '@hexly/domain';
import { ActiveWorld } from '../../core/services/active-world';
import { EntitiesClient } from '../../core/services/entities.client';
import { WorldStore } from '../../core/services/world.store';
import { Button } from '../../ui/button';
import { Field } from '../../ui/field';
import { Input } from '../../ui/input';
import { Dialog } from '../../ui/dialog';
import { CreateEntityDialogState } from './create-entity-dialog.state';

/**
 * The create-Entity flow behind the `>`-prefix Create Note / Create Map
 * Commands (ADR-0032): name + World select, prefilled to
 * `activeWorld() ?? worlds()[0]`. A separate, more explicit flow from the
 * Inspector's inline create-and-link (EntityLink) — not a replacement for it.
 * Mounted once alongside {@link CommandPalette}; driven by
 * {@link CreateEntityDialogState} rather than route/component state so a
 * Command's `run()` can open it without a reference to this component.
 */
@Component({
  selector: 'app-create-entity-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Dialog, Field, Input, TranslocoPipe],
  template: `
    @if (dialogState.type(); as type) {
      <app-dialog
        [open]="true"
        [heading]="
          (type === 'hexmap'
            ? 'commandPalette.createMap'
            : 'commandPalette.createNote'
          ) | transloco
        "
        (closed)="cancel()"
      >
        <label appField [label]="'commandPalette.nameLabel' | transloco">
          <input
            appInput
            appAutofocus
            data-testid="create-entity-name"
            [value]="name()"
            (input)="onName($event)"
            (keydown.enter)="submit(type)"
          />
        </label>
        <label appField [label]="'commandPalette.worldLabel' | transloco">
          <select
            class="w-full py-2 px-3 text-sm text-ink-strong bg-surface-sunken border border-line-strong rounded-md shadow-inset"
            data-testid="create-entity-world"
            (change)="onWorld($event)"
          >
            <!-- [selected] per-option, not [value] on the select: the select's
                 own value binding would apply before its <option> children
                 exist in the same change-detection pass and silently no-op. -->
            @for (world of worlds(); track world.id) {
              <option [value]="world.id" [selected]="world.id === worldId()">
                {{ world.name }}
              </option>
            }
          </select>
        </label>
        <button
          dialogFooter
          type="button"
          appButton
          data-testid="create-entity-cancel"
          (click)="cancel()"
        >
          {{ 'common.cancel' | transloco }}
        </button>
        <button
          dialogFooter
          type="button"
          appButton
          variant="primary"
          data-testid="create-entity-submit"
          [attr.aria-disabled]="!worldId() || null"
          (click)="submit(type)"
        >
          {{ 'common.create' | transloco }}
        </button>
      </app-dialog>
    }
  `,
})
export class CreateEntityDialog {
  protected readonly dialogState = inject(CreateEntityDialogState);
  private readonly entitiesClient = inject(EntitiesClient);
  private readonly activeWorld = inject(ActiveWorld);
  private readonly worldStore = inject(WorldStore);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly worlds = this.worldStore.worlds;
  protected readonly name = signal('');
  protected readonly worldId = signal<string | null>(null);

  constructor() {
    // Reset to a fresh form every time the dialog opens for a type, defaulting
    // the World to the one already in scope (ADR-0032).
    effect(() => {
      const type = this.dialogState.type();
      untracked(() => {
        this.name.set('');
        this.worldId.set(
          type
            ? (this.activeWorld.worldId() ?? this.worldStore.worlds()[0]?.id ?? null)
            : null,
        );
      });
    });
  }

  protected onName(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
  }

  protected onWorld(event: Event): void {
    this.worldId.set((event.target as HTMLSelectElement).value);
  }

  protected cancel(): void {
    this.dialogState.close();
  }

  protected submit(type: EntityType): void {
    const worldId = this.worldId();
    if (!worldId) return;
    const name =
      this.name().trim() ||
      this.transloco.translate(
        type === 'hexmap' ? 'domain.untitledMap' : 'domain.untitledNote',
      );
    this.entitiesClient
      .create(name, type, worldId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((entity) => {
        this.dialogState.close();
        void this.router.navigate([
          '/w',
          entity.worldId,
          'entities',
          entity.id,
        ]);
      });
  }
}

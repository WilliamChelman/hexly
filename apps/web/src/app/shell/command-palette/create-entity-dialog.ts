import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { EntityType } from '@hexly/domain';
import { ActiveWorld } from '../../core/services/active-world';
import { EntitiesClient } from '../../core/services/entities.client';
import { WorldStore } from '../../core/services/world.store';
import { Button } from '../../ui/button';
import { Dialog } from '../../ui/dialog';
import { Field } from '../../ui/field';
import { Input } from '../../ui/input';
import { CreateEntityLauncher } from './create-entity-launcher';

/**
 * The Create Note / Create Map dialog (ADR-0032): the global create flow the
 * palette's Create Commands open via {@link CreateEntityLauncher}. Distinct from
 * the Inspector's inline create-and-link (issue #77) — this is a deliberate name
 * + World form. The World prefills to the active World, falling back to the first
 * loaded one (ADR-0028); an empty name falls back to the domain's untitled title.
 * Mounted once in {@link App} alongside the palette.
 */
@Component({
  selector: 'app-create-entity-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Dialog, Field, Input, TranslocoPipe],
  template: `
    <app-dialog
      [open]="!!type()"
      [heading]="heading()"
      (closed)="launcher.close()"
    >
      <label appField [label]="'commandPalette.create.nameLabel' | transloco">
        <input
          appInput
          type="text"
          data-testid="create-name"
          [attr.placeholder]="'commandPalette.create.namePlaceholder' | transloco"
          [value]="name()"
          (input)="name.set($any($event.target).value)"
          (keydown.enter)="submit()"
        />
      </label>
      <label appField [label]="'commandPalette.create.worldLabel' | transloco">
        <select
          appInput
          data-testid="create-world"
          [value]="worldId()"
          (change)="worldId.set($any($event.target).value)"
        >
          @for (world of worlds(); track world.id) {
            <option [value]="world.id">{{ world.name }}</option>
          }
        </select>
      </label>

      <button
        dialogFooter
        type="button"
        appButton
        variant="ghost"
        (click)="launcher.close()"
      >
        {{ 'common.cancel' | transloco }}
      </button>
      <button
        dialogFooter
        type="button"
        appButton
        data-testid="create-submit"
        (click)="submit()"
      >
        {{ 'commandPalette.create.submit' | transloco }}
      </button>
    </app-dialog>
  `,
})
export class CreateEntityDialog {
  protected readonly launcher = inject(CreateEntityLauncher);
  private readonly entitiesClient = inject(EntitiesClient);
  private readonly activeWorld = inject(ActiveWorld);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly type = this.launcher.type;
  protected readonly worlds = inject(WorldStore).worlds;

  protected readonly name = signal('');
  protected readonly worldId = signal<string | null>(null);

  protected readonly heading = computed(() =>
    this.type()
      ? this.transloco.translate(
          this.type() === 'note'
            ? 'commandPalette.create.noteHeading'
            : 'commandPalette.create.mapHeading',
        )
      : undefined,
  );

  constructor() {
    // Reset the form each time the dialog opens: blank name, World prefilled to the
    // active World or the first loaded one (ADR-0028).
    effect(() => {
      if (!this.type()) return;
      this.name.set('');
      this.worldId.set(this.activeWorld.worldId() ?? this.worlds()[0]?.id ?? null);
    });
  }

  protected submit(): void {
    const type = this.type();
    if (!type) return;
    const name = this.name().trim() || this.untitled(type);
    this.entitiesClient
      .create(name, type, this.worldId() ?? undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((entity) => {
        this.router.navigate(['/entities', entity.id]);
        this.launcher.close();
      });
  }

  private untitled(type: EntityType): string {
    return this.transloco.translate(
      type === 'hexmap' ? 'domain.untitledMap' : 'domain.untitledNote',
    );
  }
}

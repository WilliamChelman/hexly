import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { WorldStore } from '../core/services/world.store';
import { ToasterService } from '../core/services/toaster.service';
import { Button } from '../ui/button';
import { Icon } from '../ui/icon/icon';

/**
 * The World switcher (ADR-0024): lists the user's Worlds and sets the active one
 * in {@link WorldStore}, which the entity browser scopes to. Loads the World list
 * on first render (it's the persistent shell chrome). "New world" mints a World —
 * the server creates its Home Entity atomically — switches to it, and opens that
 * landing page.
 */
@Component({
  selector: 'app-world-switcher',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Icon, TranslocoPipe],
  template: `
    @if (worlds().length > 0) {
      <label class="sr-only" for="world-switcher">{{
        'worlds.switcherLabel' | transloco
      }}</label>
      <select
        id="world-switcher"
        data-testid="world-switcher"
        class="w-full bg-surface-sunken text-ink-strong border border-line rounded-sm py-1 px-2 text-sm outline-none focus:border-gold"
        (change)="switch($any($event.target).value)"
      >
        @for (world of worlds(); track world.id) {
          <option [value]="world.id" [selected]="world.id === activeId()">
            {{ world.name }}
          </option>
        }
      </select>
    }
    <button
      type="button"
      appButton
      variant="ghost"
      size="sm"
      data-testid="new-world"
      [disabled]="creating()"
      (click)="createWorld()"
    >
      <app-icon name="plus" [size]="16" />
      {{ 'worlds.new' | transloco }}
    </button>
  `,
})
export class WorldSwitcher {
  private readonly store = inject(WorldStore);
  private readonly router = inject(Router);
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);

  protected readonly worlds = this.store.worlds;
  protected readonly activeId = this.store.activeWorldId;
  protected readonly creating = signal(false);

  constructor() {
    this.store.load();
  }

  protected switch(id: string): void {
    this.store.setActive(id);
  }

  protected createWorld(): void {
    if (this.creating()) return;
    this.creating.set(true);
    this.store
      .create(this.transloco.translate('worlds.untitled'))
      .pipe(finalize(() => this.creating.set(false)))
      .subscribe({
        next: (world) => this.router.navigate(['/entities', world.homeEntityId]),
        error: () =>
          this.toaster.show(
            this.transloco.translate('worlds.createError'),
            'error',
          ),
      });
  }
}

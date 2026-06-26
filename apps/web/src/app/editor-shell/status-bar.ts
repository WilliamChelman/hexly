import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { TranslocoPipe } from '@jsverse/transloco';
import { HealthStatus, isHealthy } from '@hexly/domain';
import { Cartouche } from '../ui/cartouche';
import { Coord } from '../ui/coord';
import { Dot } from '../ui/dot';
import { HexMapStore } from './hexmap-store';

/**
 * The bottom rail. It owns the API health probe it displays — the only piece of
 * the editor that talks to the backend — so the data lives where it is shown.
 */
@Component({
  selector: 'app-status-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'flex items-center gap-4 py-0 px-4 text-2xs text-ink-muted bg-linear-[180deg] from-bg-deep to-surface border-t border-line',
  },
  imports: [Cartouche, Coord, Dot, TranslocoPipe],
  template: `
    <span class="flex items-center gap-2 whitespace-nowrap" data-testid="health">
      @if (health(); as status) {
        <span appDot [positive]="healthy()"></span>
        API {{ status.status }} · {{ status.service }}
      } @else if (errorKey(); as key) {
        <span appDot></span>{{ key | transloco }}
      } @else {
        <span appDot></span>{{ 'editorShell.statusBar.connecting' | transloco }}
      }
    </span>
    <span class="flex-1"></span>
    <span class="flex items-center gap-2 whitespace-nowrap"><app-coord>q 0 · r 0</app-coord></span>
    <span class="flex items-center gap-2 whitespace-nowrap" data-testid="hex-count"
      >{{
        'editorShell.statusBar.hexCount' | transloco: { count: hexCount() }
      }}</span
    >
    <span class="flex items-center gap-2 whitespace-nowrap">Zoom 100%</span>
    <span class="flex items-center gap-2 whitespace-nowrap text-gold tracking-wider" appCartouche>Astral / Solar</span>
  `,
})
export class StatusBar implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly store = inject(HexMapStore);

  /** How many hexes the user has painted (sparse document — record count, ADR-0003). */
  protected readonly hexCount = computed(
    () => Object.keys(this.store.document().hexes).length,
  );

  /** The API's reported health, or `null` until the call resolves. */
  protected readonly health = signal<HealthStatus | null>(null);
  /** A translation key set when the `/health` call fails, so the status bar shows
   * a translated fallback (ADR-0014 — the client maps the outcome to a key). */
  protected readonly errorKey = signal<string | null>(null);
  protected readonly healthy = computed(() => {
    const status = this.health();
    return status !== null && isHealthy(status);
  });

  ngOnInit(): void {
    this.http.get<HealthStatus>('/health').subscribe({
      next: (status) => this.health.set(status),
      error: () => this.errorKey.set('editorShell.statusBar.apiError'),
    });
  }
}

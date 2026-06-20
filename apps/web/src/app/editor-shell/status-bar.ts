import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { HealthStatus, isHealthy } from '@hexly/domain';
import { Cartouche } from '../ui/cartouche';
import { Coord } from '../ui/coord';
import { Dot } from '../ui/dot';
import { EditorStore } from './editor-store';

/**
 * The bottom rail. It owns the API health probe it displays — the only piece of
 * the editor that talks to the backend — so the data lives where it is shown.
 */
@Component({
  selector: 'app-status-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Cartouche, Coord, Dot],
  template: `
    <span class="item" data-testid="health">
      @if (health(); as status) {
        <span appDot [positive]="healthy()"></span>
        API {{ status.status }} · {{ status.service }}
      } @else if (error(); as message) {
        <span appDot></span>{{ message }}
      } @else {
        <span appDot></span>Connecting…
      }
    </span>
    <span class="spacer"></span>
    <span class="item"><app-coord>q 0 · r 0</app-coord></span>
    <span class="item">{{ hexCount() }} {{ hexCount() === 1 ? 'hex' : 'hexes' }}</span>
    <span class="item">Zoom 100%</span>
    <span class="item" appCartouche>Astral / Parchment</span>
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: var(--space-4);
      padding: 0 var(--space-4);
      font-size: var(--text-2xs);
      color: var(--ink-muted);
      background: var(--surface);
      border-top: 1px solid var(--line-strong);
    }
    .item {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      white-space: nowrap;
    }
    .spacer {
      flex: 1;
    }
  `,
})
export class StatusBar implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly store = inject(EditorStore);

  /** How many hexes the user has painted — the document is sparse, so this is
   * exactly the count of records, not a grid area (ADR-0003). */
  protected readonly hexCount = computed(
    () => Object.keys(this.store.document().hexes).length,
  );

  /** The API's reported health, or `null` until the call resolves. */
  protected readonly health = signal<HealthStatus | null>(null);
  /** Set when the `/health` call fails, so the status bar can show a fallback. */
  protected readonly error = signal<string | null>(null);
  protected readonly healthy = computed(() => {
    const status = this.health();
    return status !== null && isHealthy(status);
  });

  ngOnInit(): void {
    this.http.get<HealthStatus>('/health').subscribe({
      next: (status) => this.health.set(status),
      error: () => this.error.set('Could not reach the API.'),
    });
  }
}

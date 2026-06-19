import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { HealthStatus, isHealthy } from '@hexly/domain';

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  private readonly http = inject(HttpClient);

  /** The API's reported health, or `null` until the call resolves. */
  protected readonly health = signal<HealthStatus | null>(null);
  /** Set when the `/health` call fails, so the UI can show a fallback. */
  protected readonly error = signal<string | null>(null);

  /** Derived via the shared domain helper, proving the lib resolves at runtime. */
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

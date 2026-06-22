import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { finalize } from 'rxjs';
import { AuthStore } from './auth.store';
import { HeaderService } from '../shell/header.service';
import { Button } from '../ui/button';
import { Field } from '../ui/field';
import { Input } from '../ui/input';
import { Panel } from '../ui/panel';

/**
 * The sign-in screen for the closed user set (ADR-0004). It collects email +
 * password, hands them to {@link AuthStore}, and on success the session cookie
 * is set and we enter the editor. A rejected login surfaces a single,
 * deliberately vague message — the API never says whether it was the email or
 * the password that was wrong.
 */
@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Panel, Field, Input, Button],
  template: `
    <div class="page">
      <section class="card" appPanel raised>
        <h1 class="sr-only">Sign in</h1>
        <form (submit)="submit($event)">
          <label appField label="Email">
            <input
              appInput
              type="email"
              name="email"
              autocomplete="username"
              [value]="email()"
              (input)="email.set(value($event))"
            />
          </label>
          <label appField label="Password">
            <input
              appInput
              type="password"
              name="password"
              autocomplete="current-password"
              [value]="password()"
              (input)="password.set(value($event))"
            />
          </label>

          @if (error()) {
            <p class="error" role="alert">{{ error() }}</p>
          }

          <button
            appButton
            variant="primary"
            type="submit"
            [disabled]="pending()"
          >
            {{ pending() ? 'Signing in…' : 'Sign in' }}
          </button>
        </form>
      </section>
    </div>
  `,
  styles: `
    .page {
      display: grid;
      place-items: center;
      min-height: 100%;
      padding: var(--space-5);
      background: var(--surface-sunken);
    }
    .card {
      width: 100%;
      max-width: 22rem;
      padding: var(--space-6);
    }
    form {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
    .error {
      margin: 0;
      font-size: var(--text-sm);
      color: var(--danger);
    }
  `,
})
export class Login implements OnDestroy {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly header = inject(HeaderService);

  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly pending = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    // Contribute the sign-in heading to the single app header (ADR-0015).
    this.header.set({ title: 'Sign in' });
  }

  ngOnDestroy(): void {
    // Withdraw our heading as we leave so the next page starts from a clean slate.
    this.header.clear();
  }

  /** Read the current value out of an input event. */
  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected submit(event: Event): void {
    event.preventDefault();
    if (this.pending()) return;

    this.pending.set(true);
    this.error.set(null);
    // Trim client-side so the value we send is clean; the server still owns
    // canonicalization (trim + lowercase), so we deliberately don't lowercase here.
    this.auth
      .login(this.email().trim(), this.password())
      // Always clear pending when the request settles, so a cancelled
      // navigation can't leave the button stuck on "Signing in…".
      .pipe(finalize(() => this.pending.set(false)))
      .subscribe({
        next: () => {
          const returnUrl =
            this.route.snapshot.queryParamMap.get('returnUrl') ?? '/';
          this.router.navigateByUrl(returnUrl);
        },
        error: () => this.error.set('Incorrect email or password.'),
      });
  }
}

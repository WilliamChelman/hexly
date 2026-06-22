import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { finalize } from 'rxjs';
import { translateSignal, TranslocoPipe } from '@jsverse/transloco';
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
  imports: [Panel, Field, Input, Button, TranslocoPipe],
  template: `
    <div class="page">
      <section class="card" appPanel raised>
        <h1 class="sr-only">{{ heading() }}</h1>
        <form (submit)="submit($event)">
          <label appField [label]="'auth.email' | transloco">
            <input
              appInput
              type="email"
              name="email"
              autocomplete="username"
              [value]="email()"
              (input)="email.set(value($event))"
            />
          </label>
          <label appField [label]="'auth.password' | transloco">
            <input
              appInput
              type="password"
              name="password"
              autocomplete="current-password"
              [value]="password()"
              (input)="password.set(value($event))"
            />
          </label>

          @if (error(); as e) {
            <p class="error" role="alert">{{ e | transloco }}</p>
          }

          <button
            appButton
            variant="primary"
            type="submit"
            [disabled]="pending()"
          >
            {{ (pending() ? 'auth.signingIn' : 'auth.signIn') | transloco }}
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
export class Login {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly header = inject(HeaderService);
  private readonly destroyRef = inject(DestroyRef);

  /** The translated page heading, shown both as the document's <h1> (sr-only)
   * and the header chrome title — sourced from one key so the two can't drift
   * and both re-render live when the language changes. */
  protected readonly heading = translateSignal('auth.heading');

  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly pending = signal(false);
  /** A translation key for the active error, or `null` when there is none. */
  protected readonly error = signal<string | null>(null);

  constructor() {
    // Contribute the sign-in heading to the single app header (ADR-0015),
    // re-contributing whenever the active language changes so the chrome title
    // tracks the switch live. It is withdrawn automatically when this page is
    // destroyed.
    effect(() => {
      this.header.set({ title: this.heading() }, this.destroyRef);
    });
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
        error: () => this.error.set('auth.invalidCredentials'),
      });
  }
}

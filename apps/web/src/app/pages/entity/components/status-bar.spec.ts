import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { provideTranslocoTesting } from '../../../core/i18n/transloco-testing';
import { HexMapStore } from '../services/hexmap-store';
import { StatusBar } from './status-bar';

describe('StatusBar', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StatusBar, provideTranslocoTesting()],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /** Render the bar, returning the fixture and the still-pending /health request. */
  function render() {
    const fixture = TestBed.createComponent(StatusBar);
    fixture.detectChanges(); // ngOnInit → GET /health
    const req = http.expectOne('/api/health');
    return { fixture, req };
  }

  it('shows the connecting state in English before /health resolves', () => {
    const { fixture, req } = render();

    const health = fixture.nativeElement.querySelector('[data-testid=health]');
    expect(health.textContent).toContain('Connecting…');

    req.flush({ status: 'ok', service: 'api' }); // settle so verify() is clean
  });

  it('renders the connecting state in French when French is the active language', () => {
    const { fixture, req } = render();
    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('[data-testid=health]').textContent,
    ).toContain('Connexion…');

    req.flush({ status: 'ok', service: 'api' });
  });

  it('surfaces an unreachable API as a translated message', () => {
    const { fixture, req } = render();
    req.flush(null, { status: 503, statusText: 'Service Unavailable' });
    fixture.detectChanges();

    const health = () =>
      fixture.nativeElement.querySelector('[data-testid=health]');
    // English default: the failure maps to a key resolving to the English copy.
    expect(health().textContent).toContain('Could not reach the API.');

    // ...and reflows to French live on a switch.
    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();
    expect(health().textContent).toContain('Impossible de joindre l’API.');
    expect(health().textContent).not.toContain('Could not reach the API.');
  });

  it('pluralizes the hex count in English and translates it in French', () => {
    const store = TestBed.inject(HexMapStore);
    store.paintAt({ q: 0, r: 0 }, 'grass'); // exactly one painted hex
    const { fixture, req } = render();
    req.flush({ status: 'ok', service: 'api' });
    fixture.detectChanges();

    const count = () =>
      fixture.nativeElement.querySelector('[data-testid=hex-count]').textContent;
    expect(count()).toContain('1 hex');

    store.paintAt({ q: 1, r: 0 }, 'grass'); // now two → English plural
    fixture.detectChanges();
    expect(count()).toContain('2 hexes');

    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();
    expect(count()).toContain('2 hex');
    expect(count()).not.toContain('hexes');
  });
});

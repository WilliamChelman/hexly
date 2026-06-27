import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { CONTENT_FORMAT, EntityDetail } from '@hexly/domain';
import { provideTranslocoTesting } from '../../../core/i18n/transloco-testing';
import { EditorShell } from './editor-shell';
import { EntitySession } from '../services/entity-session';
import { HexMapStore } from '../services/hexmap-store';

// Pure view: routing/load/tab-title live in EntityPage + EntitySession (see
// entity.page.spec / entity-session.spec). Covers only the layout shell.
describe('EditorShell', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EditorShell, provideTranslocoTesting()],
      providers: [
        EntitySession,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('renders the API health reported in the status bar', async () => {
    const fixture = TestBed.createComponent(EditorShell);
    fixture.detectChanges(); // ngOnInit -> GET /health

    httpMock.expectOne('/api/health').flush({ status: 'ok', service: 'api' });

    await fixture.whenStable();
    fixture.detectChanges();

    const health = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="health"]',
    );
    expect(health?.textContent).toContain('ok');
    expect(health?.textContent).toContain('api');
  });

  it('arms the non-destructive Select tool by default', () => {
    const fixture = TestBed.createComponent(EditorShell);
    fixture.detectChanges();
    httpMock.expectOne('/api/health').flush({ status: 'ok', service: 'api' });

    // Maps open armed with Select so a stray first click never paints (#27).
    // Icon-only strip, so arming reads from the button's pressed state (ADR-0013).
    const select = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid=tool-select]',
    );
    expect(select?.getAttribute('aria-pressed')).toBe('true');
  });

  it('boots to a clear map: a full-bleed canvas, a bare rail, and the panel closed', () => {
    const fixture = TestBed.createComponent(EditorShell);
    fixture.detectChanges();
    httpMock.expectOne('/api/health').flush({ status: 'ok', service: 'api' });

    const el = fixture.nativeElement as HTMLElement;
    // Canvas, strip, and rail present; right panel closed by default, so neither
    // Inspector nor Regions renders until there's something to show (ADR-0013, story 20).
    expect(el.querySelector('app-map-canvas')).not.toBeNull();
    expect(el.querySelector('app-tool-palette')).not.toBeNull();
    expect(el.querySelector('app-editor-rail')).not.toBeNull();
    expect(el.querySelector('app-inspector')).toBeNull();
    expect(el.querySelector('app-regions-panel')).toBeNull();
  });

  // Hexmap with a populated Content body, to prove the Note view seeds it (#75).
  const hexmapWithContent = (text: string): EntityDetail => ({
    id: 'm1',
    ownerId: 'u1',
    name: 'The Reach of Aldermoor',
    type: 'hexmap',
    tags: [],
    visibility: 'private',
    version: 1,
    createdAt: 1,
    updatedAt: 1,
    document: {
      type: 'hexmap',
      content: {
        format: CONTENT_FORMAT,
        snapshot: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
        },
      },
      hexes: {},
      regions: [],
      labels: [],
    },
  });

  /** Flush the status bar's health probe so afterEach's verify() is satisfied. */
  function flushHealth() {
    httpMock.expectOne('/api/health').flush({ status: 'ok', service: 'api' });
  }

  it('shows the hex canvas in the Map view, not the Content editor', () => {
    TestBed.inject(EntitySession).adopt(hexmapWithContent('The reach lies north.'));

    const fixture = TestBed.createComponent(EditorShell);
    fixture.detectChanges();
    flushHealth();

    const el = fixture.nativeElement as HTMLElement;
    // Default Map view: grid up, Content editor absent.
    expect(el.querySelector('app-map-canvas')).not.toBeNull();
    expect(el.querySelector('app-content-editor')).toBeNull();
  });

  it('swaps the canvas for the Content editor in the Note view, seeded with the map’s Content', () => {
    TestBed.inject(EntitySession).adopt(hexmapWithContent('The reach lies north.'));
    // adopt() opens on the grid; flip to the Note view.
    TestBed.inject(HexMapStore).setView('note');

    const fixture = TestBed.createComponent(EditorShell);
    fixture.detectChanges();
    flushHealth();

    const el = fixture.nativeElement as HTMLElement;
    // Note view: Content editor takes the body, canvas gone.
    expect(el.querySelector('app-content-editor')).not.toBeNull();
    expect(el.querySelector('app-map-canvas')).toBeNull();
    // …seeded with the hexmap's stored Content, not an empty doc.
    const surface = el.querySelector('[data-testid=note-content]') as HTMLElement;
    expect(surface.textContent).toContain('The reach lies north.');
  });

  it('opens the Regions panel from the closed default via the rail', () => {
    const fixture = TestBed.createComponent(EditorShell);
    fixture.detectChanges();
    httpMock.expectOne('/api/health').flush({ status: 'ok', service: 'api' });

    const el = fixture.nativeElement as HTMLElement;
    // Closed by default.
    expect(el.querySelector('app-regions-panel')).toBeNull();
    expect(el.querySelector('app-inspector')).toBeNull();

    // Rail's first entry opens the Regions panel.
    (el.querySelector('[data-testid=rail-regions]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(el.querySelector('app-regions-panel')).not.toBeNull();
    expect(el.querySelector('app-inspector')).toBeNull();
  });
});

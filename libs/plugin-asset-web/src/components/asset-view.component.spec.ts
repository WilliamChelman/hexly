import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { Observable, of } from 'rxjs';
import { EntityDetail, EntityReferences } from '@hexly/domain';
import { EntitiesClient } from '@hexly/web-core';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { FakeEntitySession, provideFakeEntitySession } from '@hexly/web-entity/testing';
import { EntityNameResolver } from '@hexly/plugin-content/web';
import { ContentEditorComponent } from '@hexly/plugin-content/editor';
import { CONTENT_EDITOR_TEST_CATALOGS } from '@hexly/plugin-content/testing';
import { ASSET_FIELD_ID, AssetValue } from '@hexly/plugin-asset';
import { ASSET_TEST_CATALOGS } from '../i18n/test-catalogs';
import { AssetViewComponent } from './asset-view.component';

const HASH = 'a'.repeat(64);

/** An asset-ref value, image-kind with full stats by default; override per test for other kinds. */
function assetValue(overrides: Partial<AssetValue> = {}): AssetValue {
  return {
    hash: HASH,
    ext: '.png',
    mime: 'image/png',
    size: 2_500_000,
    stats: { width: 1920, height: 1080, orientation: 'landscape', dominantColor: '#3366cc' },
    ...overrides,
  };
}

/** An Asset EntityDetail carrying `value` at the asset-ref key. */
function assetDetail(value: AssetValue): EntityDetail {
  return {
    id: 'asset-1',
    worldId: 'world-1',
    name: 'dragon.png',
    types: ['core.type.asset'],
    tags: [],
    visibility: 'shared',
    version: 1,
    seq: 1,
    createdAt: 0,
    updatedAt: 0,
    document: { [ASSET_FIELD_ID]: value },
  };
}

describe('AssetViewComponent', () => {
  let references: (id: string) => Observable<EntityReferences>;

  beforeEach(async () => {
    references = vi.fn(() => of<EntityReferences>({ references: [], referencedBy: [] }));
    await TestBed.configureTestingModule({
      imports: [provideTranslocoTesting({ ...ASSET_TEST_CATALOGS, ...CONTENT_EDITOR_TEST_CATALOGS })],
      providers: [
        ...provideFakeEntitySession(),
        // The reused RichContent editor's ambient dependencies (mirrors the ContentEditor spec harness).
        EntityNameResolver,
        { provide: EntitiesClient, useValue: { references: (id: string) => references(id) } },
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { fragment: of(null) } },
      ],
    }).compileComponents();
  });

  function render(value: AssetValue) {
    const session = TestBed.inject(FakeEntitySession);
    session.loadDetail(assetDetail(value));
    const fixture = TestBed.createComponent(AssetViewComponent);
    fixture.detectChanges();
    return { session, fixture };
  }

  it('renders an image asset with the image renderer at its served capability URL (ADR-0065)', () => {
    const { fixture } = render(assetValue());

    const img = fixture.nativeElement.querySelector('[data-testid=asset-image]') as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe(`/assets/world-1/${HASH}.png`);
    expect(fixture.nativeElement.querySelector('[data-testid=asset-icon-card]')).toBeNull();
  });

  it('renders a non-image asset as an icon card, not the image renderer (ADR-0065)', () => {
    const { fixture } = render(assetValue({ ext: '.pdf', mime: 'application/pdf', stats: null }));

    expect(fixture.nativeElement.querySelector('[data-testid=asset-image]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid=asset-icon-card]')).not.toBeNull();
  });

  it('degrades to the icon card when the image fails to load (original-is-fallback)', () => {
    const { fixture } = render(assetValue());

    const img = fixture.nativeElement.querySelector('[data-testid=asset-image]') as HTMLImageElement;
    img.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid=asset-image]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid=asset-icon-card]')).not.toBeNull();
  });

  it('shows the mechanical Asset Stats (dimensions, dominant color, size)', () => {
    const { fixture } = render(assetValue());

    const stats = fixture.nativeElement.querySelector('[data-testid=asset-stats]') as HTMLElement;
    expect(stats.querySelector('[data-testid=asset-stat-dimensions]')?.textContent).toContain('1920 × 1080');
    expect(stats.textContent).toContain('#3366cc');
    expect(stats.textContent).toContain('2.4 MB');
  });

  it('mounts the canonical Content editor so prose can be authored on the Asset', () => {
    const { fixture } = render(assetValue());

    expect(fixture.debugElement.query(By.directive(ContentEditorComponent))).not.toBeNull();
  });

  it('lists the Entities that link here as usage (inbound links)', () => {
    references = vi.fn(() =>
      of<EntityReferences>({
        references: [],
        referencedBy: [{ descriptor: null, source: { id: 'note-1', name: 'Lair of the Dragon', types: [] } }],
      }),
    );
    const { fixture } = render(assetValue());

    const rows = fixture.nativeElement.querySelectorAll('[data-testid=asset-usage-row]');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Lair of the Dragon');
    expect(references).toHaveBeenCalledWith('asset-1');
  });

  it('shows the empty usage state once the (empty) list has landed', () => {
    const { fixture } = render(assetValue());

    expect(fixture.nativeElement.querySelector('[data-testid=asset-usage-empty]')).not.toBeNull();
  });
});

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { EntityDetail } from '@hexly/domain';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { FakeEntitySession, provideFakeEntitySession } from '@hexly/web-entity/testing';
import { EntityNameResolver } from '@hexly/plugin-content/web';
import { ContentEditorComponent } from '@hexly/plugin-content/editor';
import { CONTENT_EDITOR_TEST_CATALOGS } from '@hexly/plugin-content/testing';
import { ASSET_FIELD_ID, AssetValue } from '@hexly/plugin-asset';
import { provideEntityTypesTesting } from '@hexly/web-entity/testing';
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
function assetDetail(value: AssetValue, overrides: Partial<EntityDetail> = {}): EntityDetail {
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
    ...overrides,
  };
}

describe('AssetViewComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [provideTranslocoTesting({ ...ASSET_TEST_CATALOGS, ...CONTENT_EDITOR_TEST_CATALOGS })],
      providers: [
        ...provideFakeEntitySession(),
        // The reused RichContent editor's ambient dependencies (mirrors the ContentEditor spec harness):
        // EntityNameResolver over the real root EntitiesClient, backed by the testing HTTP backend.
        EntityNameResolver,
        // The `@` mention inside that editor reads its Facet vocabulary off the registry (ADR-0082).
        provideEntityTypesTesting([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { fragment: of(null) } },
      ],
    }).compileComponents();
  });

  function render(value: AssetValue, overrides: Partial<EntityDetail> = {}) {
    const session = TestBed.inject(FakeEntitySession);
    session.loadDetail(assetDetail(value, overrides));
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

  it('names the missing-bytes state and requests no bytes when the server reports them absent (#325)', () => {
    const { fixture } = render(assetValue(), { assetBytesMissing: true });

    const missing = fixture.nativeElement.querySelector('[data-testid=asset-missing]') as HTMLElement | null;
    expect(missing).not.toBeNull();
    expect(missing?.textContent).toContain("This file isn't where Hexly expects it");
    expect(fixture.nativeElement.querySelector('[data-testid=asset-image]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid=asset-icon-card]')).toBeNull();
  });

  it('says nothing about missing bytes for a non-image Asset whose bytes are present (#325)', () => {
    // The icon card means "not an image", not "not there": the two states must stay distinguishable.
    const { fixture } = render(assetValue({ ext: '.pdf', mime: 'application/pdf', stats: null }));

    expect(fixture.nativeElement.querySelector('[data-testid=asset-missing]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid=asset-icon-card]')).not.toBeNull();
  });

  it('still shows the Stats and prose of a missing-bytes Asset — none of that was lost (#325)', () => {
    const { fixture } = render(assetValue(), { assetBytesMissing: true });

    expect(fixture.nativeElement.querySelector('[data-testid=asset-stat-dimensions]')?.textContent).toContain(
      '1920 × 1080',
    );
    expect(fixture.debugElement.query(By.directive(ContentEditorComponent))).not.toBeNull();
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

  // Usage ("where is this Asset used") is no longer a bespoke inline list: the universal References
  // panel answers it on every View (ADR-0067, #296), so the Asset View renders no usage section.
  it('renders no inline usage list — usage lives in the universal References panel now (ADR-0067)', () => {
    const { fixture } = render(assetValue());

    expect(fixture.nativeElement.querySelector('[data-testid=asset-usage]')).toBeNull();
  });
});

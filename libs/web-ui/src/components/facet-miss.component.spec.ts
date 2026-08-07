import { TestBed } from '@angular/core/testing';
import { ComponentFixture } from '@angular/core/testing';
import { FacetKeySet, parseFacetQuery } from '@hexly/domain';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { UI_TEST_CATALOGS } from '../i18n/test-catalogs';
import { FacetMissComponent } from './facet-miss.component';

/** A browse surface's vocabulary in miniature: the reserved trio, plus one numeric Facet key. */
const KEYS: FacetKeySet = { reserved: ['type', 'tag', 'visibility'], fields: ['challenge_rating'] };

describe('FacetMiss (ADR-0082)', () => {
  let fixture: ComponentFixture<FacetMissComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FacetMissComponent, provideTranslocoTesting(UI_TEST_CATALOGS)],
    }).compileComponents();
    fixture = TestBed.createComponent(FacetMissComponent);
  });

  /** Render the report for one box string, as the surface that parsed it would hand it over. */
  function stateOf(raw: string): HTMLElement {
    fixture.componentRef.setInput('parsed', parseFacetQuery(raw, KEYS));
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function text(el: HTMLElement, testid: string): string | undefined {
    return el.querySelector(`[data-testid="${testid}"]`)?.textContent?.trim();
  }

  it('says nothing, and takes no room, for a box whose tokens all applied', () => {
    const el = stateOf('$type:npc gorb');
    expect(el.querySelectorAll('p')).toHaveLength(0);
    expect(fixture.debugElement.nativeElement.style.display).toBe('none');
  });

  it('names every unresolvable key once, in the order typed', () => {
    expect(text(stateOf('$domain:x $realm:y $domain:z'), 'unknown-facet')).toBe('No Facet “domain, realm” here.');
  });

  it('says a token that names no value filters nothing', () => {
    expect(text(stateOf('$tag:'), 'unknown-facet-empty-value')).toBe('“tag” names no value, so it filters nothing.');
  });

  it('says a quote is still open rather than filtering on half a value', () => {
    expect(text(stateOf('$tag:"sea of '), 'unknown-facet-unterminated-quote')).toBe(
      '“tag” has a quote still open, so it filters nothing yet.',
    );
  });

  it('says an excluded range bound cannot be expressed (ADR-0081)', () => {
    expect(text(stateOf('-$challenge_rating:>=5'), 'unknown-facet-negated-bound')).toBe(
      "A range bound can't be excluded, so “challenge_rating” filters nothing.",
    );
  });

  it('states each reason on its own line, and an unknown key beside them', () => {
    const el = stateOf('$domain:x $tag: -$challenge_rating:>5');
    expect(Array.from(el.querySelectorAll('p')).map((p) => p.getAttribute('data-testid'))).toEqual([
      'unknown-facet',
      'unknown-facet-empty-value',
      'unknown-facet-negated-bound',
    ]);
  });

  it('groups the keys that missed for one reason into one message', () => {
    expect(text(stateOf('$tag: $type:'), 'unknown-facet-empty-value')).toBe(
      '“tag, type” names no value, so it filters nothing.',
    );
  });

  it('takes the host surface’s testid stem, so one page can carry two boxes', () => {
    fixture.componentRef.setInput('testid', 'image-unknown-facet');
    const el = stateOf('$domain:x $tag:');
    expect(text(el, 'image-unknown-facet')).toContain('domain');
    expect(text(el, 'image-unknown-facet-empty-value')).toContain('tag');
  });
});

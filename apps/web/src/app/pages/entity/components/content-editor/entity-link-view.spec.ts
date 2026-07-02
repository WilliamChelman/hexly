import { ComponentRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { EntitySummary } from '@hexly/domain';
import { provideTranslocoTesting } from '../../../../core/i18n/transloco-testing';
import {
  EntityNameResolver,
  EntityResolution,
} from '../../services/entity-name-resolver';
import { EntityLinkView } from './entity-link-view';

/** A resolver stub that reports a fixed live name for every id (no HTTP). */
class StubResolver {
  constructor(private readonly resolution: EntityResolution) {}
  resolve(): EntityResolution {
    return this.resolution;
  }
}

const found = (name: string): EntityResolution => ({
  status: 'found',
  entity: { name } as EntitySummary,
});

describe('EntityLinkView', () => {
  function mount(inputs: {
    entityId: string;
    label: string;
    display?: string | null;
    heading?: string | null;
  }) {
    const fixture = TestBed.createComponent(EntityLinkView);
    const ref = fixture.componentRef as ComponentRef<EntityLinkView>;
    ref.setInput('entityId', inputs.entityId);
    ref.setInput('label', inputs.label);
    if ('display' in inputs) ref.setInput('display', inputs.display ?? null);
    if ('heading' in inputs) ref.setInput('heading', inputs.heading ?? null);
    fixture.detectChanges();
    return fixture;
  }

  function configure(resolution: EntityResolution) {
    TestBed.configureTestingModule({
      imports: [EntityLinkView, provideTranslocoTesting()],
      providers: [
        { provide: EntityNameResolver, useValue: new StubResolver(resolution) },
        provideRouter([]),
      ],
    });
  }

  it('renders the live target name when no display override is set', () => {
    configure(found('Avalon'));
    const fixture = mount({ entityId: 'e1', label: 'stale' });

    const link = fixture.nativeElement.querySelector('[data-testid=entity-link]');
    expect(link.textContent).toContain('Avalon');
    expect(link.textContent).not.toContain('stale');
  });

  it('renders the static display text in place of the live name (ADR-0033)', () => {
    configure(found('Avalon'));
    const fixture = mount({ entityId: 'e1', label: 'Avalon', display: 'the White City' });

    const link = fixture.nativeElement.querySelector('[data-testid=entity-link]');
    expect(link.textContent).toContain('the White City');
    // The live name is deliberately overridden — narrative prose keeps its phrasing.
    expect(link.textContent).not.toContain('Avalon');
  });

  it('carries the heading as a router fragment so navigation can anchor to it', () => {
    configure(found('Avalon'));
    const fixture = mount({ entityId: 'e1', label: 'Avalon', heading: 'History' });

    const anchor = fixture.nativeElement.querySelector('[data-testid=entity-link]');
    // routerLink renders the fragment into the href as `#History`.
    expect(anchor.getAttribute('href')).toContain('#History');
  });
});

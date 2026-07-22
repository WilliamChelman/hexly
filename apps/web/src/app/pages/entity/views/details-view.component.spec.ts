import { provideTranslocoTesting } from '../../../../testing/transloco-testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { EntityDetail, defineField } from '@hexly/domain';
import { ENTITY_SESSION, ENTITY_TYPES } from '@hexly/web-entity';
import { EntitySession } from '../services/entity-session';
import { TypeRegistry } from '../../../entity-types/type-registry';
import { DetailsViewComponent } from './details-view.component';

/**
 * The Details View (`core.view.details`, ADR-0067) is the fallback main content. It **shares one
 * rendering** with the universal Details Panel — mounting {@link DetailsPanelComponent} — so its spec
 * proves only that the shared rendering appears full-width and reaches the Entity's Fields; the panel's
 * own spec (`details-panel.component.spec.ts`) covers the inline Type/Field management in depth.
 */
describe('DetailsView', () => {
  const domain = defineField({ id: 'world.field.domain', label: 'Domain', dataType: { kind: 'string' } });

  const detail = (document: Record<string, unknown>): EntityDetail => ({
    id: 'd1',
    worldId: 'w1',
    name: 'Athena',
    types: ['world.type.deity'],
    tags: [],
    visibility: 'private',
    version: 1,
    seq: 1,
    createdAt: 1,
    updatedAt: 1,
    rights: ['edit'],
    document,
  });

  let session: EntitySession;
  let registry: TypeRegistry;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DetailsViewComponent, provideTranslocoTesting()],
      providers: [
        EntitySession,
        { provide: ENTITY_SESSION, useExisting: EntitySession },
        { provide: ENTITY_TYPES, useExisting: TypeRegistry },
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();
    session = TestBed.inject(EntitySession);
    registry = TestBed.inject(TypeRegistry);
    registry.setWorldFields([domain]);
    registry.register({
      id: 'world.type.deity',
      icon: 'label',
      views: [],
      labelText: 'Deity',
      fieldRefs: ['world.field.domain'],
      graphColorToken: '--color-ink-muted',
    });
  });

  function render(detailToOpen: EntityDetail) {
    session.adopt(detailToOpen);
    const fixture = TestBed.createComponent(DetailsViewComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('frames the shared Details Panel rendering as full-width fallback content', () => {
    const el = render(detail({ 'world.field.domain': 'War' }));

    // The full-width view container wraps the one shared rendering — the Details Panel component.
    const view = el.querySelector('[data-testid="details-view"]');
    expect(view).not.toBeNull();
    const panel = el.querySelector('[data-testid="details-panel"]');
    expect(panel).not.toBeNull();
    // Reaches the Entity's declared Field, editable in place — the inline management the panel owns.
    const domainRow = el.querySelector('[data-testid="detail-field-world.field.domain"]');
    expect((domainRow?.querySelector('input') as HTMLInputElement).value).toBe('War');
  });

  it('edits a Field value in place, straight into the one document map', () => {
    const el = render(detail({ 'world.field.domain': 'War' }));
    const input = el.querySelector('[data-testid="detail-field-world.field.domain"] input') as HTMLInputElement;
    input.value = 'Wisdom';
    input.dispatchEvent(new Event('input'));

    expect(session.doc()['world.field.domain']).toBe('Wisdom');
  });
});

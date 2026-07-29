import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { EntityType } from '@hexly/domain';
import { providePluginContent } from '@hexly/plugin-content/web';
import { provideTranslocoTesting } from '../../../../testing/transloco-testing';
import { EntityCardComponent, EntityCardVm } from './entity-card.component';

/**
 * The sigil slot renders the Entity's Thumbnail when the list resolved one (ADR-0066), so a card is
 * recognizable by sight; absent — no Field, no own bytes, or a dangling designation the server already
 * dropped — it falls back to the primary type's icon, never a broken image.
 */
describe('EntityCard — thumbnail in the sigil slot (ADR-0066)', () => {
  const card = (over: Partial<EntityCardVm> = {}): EntityCardVm => ({
    id: 'e1',
    title: 'A map',
    type: 'core.type.note' as EntityType,
    tags: [],
    updatedAt: 1,
    rights: ['read'],
    ...over,
  });

  function render(vm: EntityCardVm): ComponentFixture<EntityCardComponent> {
    TestBed.configureTestingModule({
      imports: [EntityCardComponent, provideTranslocoTesting()],
      providers: [providePluginContent(), provideRouter([])],
    });
    const fixture = TestBed.createComponent(EntityCardComponent);
    fixture.componentRef.setInput('card', vm);
    fixture.componentRef.setInput('worldId', 'w1');
    fixture.detectChanges();
    return fixture;
  }

  const el = (fixture: ComponentFixture<EntityCardComponent>) => fixture.nativeElement as HTMLElement;

  it('renders the resolved thumbnail as the sigil image, not the type icon', () => {
    const fixture = render(card({ thumbnailUrl: 'https://cdn.example/thumb.webp' }));

    const img = el(fixture).querySelector<HTMLImageElement>('[data-testid="thumbnail-e1"]');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe('https://cdn.example/thumb.webp');
    // Decorative: the stretched open-link already carries the Entity's name (a11y).
    expect(img!.getAttribute('alt')).toBe('');
    // The type-icon sigil is not rendered when a thumbnail stands in for it.
    expect(el(fixture).querySelector('[data-testid="type-sigil"]')).toBeNull();
  });

  it('falls back to the primary type icon when no thumbnail was resolved', () => {
    const fixture = render(card({ thumbnailUrl: undefined }));

    expect(el(fixture).querySelector('[data-testid="thumbnail-e1"]')).toBeNull();
    // The sigil slot renders the type icon in place of the missing thumbnail.
    const sigil = el(fixture).querySelector('[data-testid="type-sigil"]');
    expect(sigil).not.toBeNull();
    expect(sigil!.querySelector('app-icon')).not.toBeNull();
  });

  /**
   * **Adoption** (ADR-0079): the card's one Sealed-only action, gated on where the Entity lives rather
   * than on the Rights it reports — a **Compendium Entry**'s are `read` alone, and adoption is a
   * standing on the *target* World, which this card cannot see.
   */
  it('offers Adopt on a Sealed entry, whose Rights say only `read`', () => {
    const fixture = render(card({ sealed: true }));

    expect(el(fixture).querySelector('[data-testid="adopt-e1"]')).not.toBeNull();
  });

  it('offers no Adopt on a World’s own Entity, however many Rights it carries', () => {
    const fixture = render(card({ rights: ['read', 'edit', 'delete'] }));

    expect(el(fixture).querySelector('[data-testid="adopt-e1"]')).toBeNull();
  });
});

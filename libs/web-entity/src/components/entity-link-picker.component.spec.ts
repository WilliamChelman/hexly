import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { of } from 'rxjs';
import { defineField, EntityDetail, EntitySummary, EntityType } from '@hexly/domain';
import { EntitiesClient } from '@hexly/web-core';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { WEB_ENTITY_TEST_CATALOGS } from '../i18n/test-catalogs';
import { provideEntityTypesTesting } from '../testing/entity-types.fake';
import { CORE_VIEW_DETAILS } from '../models/view-definition';
import { TypeDefinition } from '../models/type-definition';
import { EntityLinkPickerComponent } from './entity-link-picker.component';

/** A code-registered type, chrome and all — the shape the picker reads its create row off. It declares its default Fields by id (`fieldRefs`, ADR-0054). */
function codeType(id: string, fieldRefs: readonly string[] = []): TypeDefinition {
  return {
    id: id as TypeDefinition['id'],
    icon: 'label',
    views: [CORE_VIEW_DETAILS],
    fieldRefs,
    graphColorToken: '--color-ink-muted',
    labels: {
      name: `${id}.name`,
      eyebrow: `${id}.eyebrow`,
      titleLabel: `${id}.titleLabel`,
      rename: `${id}.rename`,
      editorLabel: `${id}.editorLabel`,
      create: `${id}.create`,
      untitled: `${id}.untitled`,
    },
  };
}

/** A World-defined type: an authored name, no copy to translate, and no bespoke view (#191). */
const deity: TypeDefinition = {
  id: 'world.type.deity' as TypeDefinition['id'],
  icon: 'label',
  labelText: 'Deity',
  views: [CORE_VIEW_DETAILS],
  graphColorToken: '--color-ink-muted',
};

/** A required Field the monster references — a prompt, never a gate (ADR-0074). */
const crField = defineField({
  id: 'dnd.field.cr',
  label: 'Challenge Rating',
  dataType: { kind: 'number' },
  required: true,
  facetable: true,
});

/** A type whose referenced Field is **required**: create-and-link offers it like any other. */
const monster: TypeDefinition = codeType('dnd.type.monster', [crField.id]);

/** A System-managed type (ADR-0068), as `core.type.asset` is: never user-creatable. */
const systemType: TypeDefinition = { ...codeType('test.type.system'), systemManaged: true };

function summary(id: string, name: string): EntitySummary {
  return {
    id,
    worldId: 'w1',
    name,
    types: ['core.type.note'],
    tags: [],
    visibility: 'private',
    version: 1,
    createdAt: 0,
    updatedAt: 0,
  };
}

/** The entities the stubbed client lists, and the creates it recorded. */
let stubEntities: EntitySummary[] = [];
let createdCalls: Array<{ name: string; type: EntityType }> = [];
let nextCreatedId = 'created-1';

/** A host holding the link, as the Hex Map's Inspector (and any other slot owner) does. */
@Component({
  imports: [EntityLinkPickerComponent],
  template: `<app-entity-link-picker [entityId]="linked()" [slot]="slot()" (linkChange)="linked.set($event)" />`,
})
class Host {
  readonly linked = signal<string | null>(null);
  readonly slot = signal('hex-0,0');
}

describe('EntityLinkPicker', () => {
  beforeEach(async () => {
    stubEntities = [];
    createdCalls = [];
    nextCreatedId = 'created-1';
    await TestBed.configureTestingModule({
      imports: [Host, provideTranslocoTesting(WEB_ENTITY_TEST_CATALOGS)],
      providers: [
        provideRouter([]),
        // Note, Map, a World's own Deity, a Monster whose CR is required, and a System-managed type —
        // the registry the app composes, as a lib reads it. The picker never learns which is which.
        ...provideEntityTypesTesting(
          [codeType('core.type.note'), codeType('core.type.hex-map'), deity, monster, systemType],
          [crField],
        ),
        {
          provide: EntitiesClient,
          useValue: {
            // Mirror the server's envelope + filters (ADR-0025): `ids` selects, `q` matches names
            // case-insensitively, so the picker's calls resolve as they do in prod.
            list: (opts: { ids?: string[]; q?: string } = {}) => {
              let items = stubEntities;
              if (opts.ids) items = items.filter((e) => opts.ids?.includes(e.id));
              if (opts.q) items = items.filter((e) => e.name.toLowerCase().includes(opts.q?.toLowerCase() ?? ''));
              return of({ items, nextCursor: null });
            },
            create: (name: string, types: readonly EntityType[]) => {
              createdCalls.push({ name, type: types[0] });
              const detail: EntityDetail = {
                ...summary(nextCreatedId, name),
                types: [...types],
                seq: 1,
                document: {} as EntityDetail['document'],
              };
              return of(detail);
            },
          },
        },
      ],
    }).compileComponents();
  });

  function render() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return fixture;
  }

  function byId(fixture: { nativeElement: HTMLElement }, testid: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testid}"]`);
  }

  function click(fixture: { nativeElement: HTMLElement }, testid: string): void {
    (byId(fixture, testid) as HTMLButtonElement).click();
  }

  it('opens the picker and emits the chosen Entity as the new link', () => {
    stubEntities = [summary('n1', 'Riverbend'), summary('n2', 'North Reach')];
    const fixture = render();

    click(fixture, 'entity-link-pick');
    fixture.detectChanges();
    click(fixture, 'entity-link-option-n2');
    fixture.detectChanges();

    expect(fixture.componentInstance.linked()).toBe('n2');
    expect(byId(fixture, 'entity-link-name')?.textContent).toContain('North Reach');
  });

  it('filters the options by a case-insensitive name search', () => {
    stubEntities = [summary('n1', 'Riverbend'), summary('n2', 'North Reach')];
    const fixture = render();

    click(fixture, 'entity-link-pick');
    fixture.detectChanges();
    const search = byId(fixture, 'entity-link-search') as HTMLInputElement;
    search.value = 'river';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(byId(fixture, 'entity-link-option-n1')).not.toBeNull();
    expect(byId(fixture, 'entity-link-option-n2')).toBeNull();
  });

  it('emits null when the link is removed', () => {
    stubEntities = [summary('n1', 'Riverbend')];
    const fixture = render();
    fixture.componentInstance.linked.set('n1');
    fixture.detectChanges();

    click(fixture, 'entity-link-remove');
    fixture.detectChanges();

    expect(fixture.componentInstance.linked()).toBeNull();
    expect(byId(fixture, 'entity-link-pick')).not.toBeNull();
  });

  it('renders the entity name as a real anchor to the linked Entity', () => {
    stubEntities = [summary('n1', 'Riverbend')];
    const fixture = render();
    fixture.componentInstance.linked.set('n1');
    fixture.detectChanges();

    // The name itself is the link — a real <a routerLink>, so ctrl/cmd-click opens it in a new tab.
    // World-agnostic (#118): /entities/:id resolves the target's World and redirects there.
    const name = byId(fixture, 'entity-link-name') as HTMLAnchorElement;
    expect(name.tagName).toBe('A');
    expect(name.getAttribute('href')).toBe('/entities/n1');
    expect(name.textContent).toContain('Riverbend');
  });

  it('renders a non-navigable dangling label when the link cannot be resolved', () => {
    // The target is deleted or inaccessible, so the ids-resolve comes back empty (#78).
    stubEntities = [];
    const fixture = render();
    fixture.componentInstance.linked.set('ghost');
    fixture.detectChanges();

    expect(byId(fixture, 'entity-link-name')).toBeNull();
    expect(byId(fixture, 'entity-link-dangling')).not.toBeNull();
  });

  it('closes the picker when the host moves to another slot', () => {
    const fixture = render();
    click(fixture, 'entity-link-pick');
    fixture.detectChanges();
    expect(byId(fixture, 'entity-link-search')).not.toBeNull();

    fixture.componentInstance.slot.set('hex-1,0');
    fixture.detectChanges();

    // A pick would otherwise land on the slot the picker was opened for, not the one now selected.
    expect(byId(fixture, 'entity-link-search')).toBeNull();
  });

  describe('create and link', () => {
    it('offers every creatable Type the registry knows — naming none of them', () => {
      const fixture = render();
      click(fixture, 'entity-link-pick');
      fixture.detectChanges();

      // Core, plugin, and World-defined types sit on the same footing; the testid derives from the
      // type id, so the next plugin's create affordance needs no new code here.
      expect(byId(fixture, 'entity-link-create-core.type.note')).not.toBeNull();
      expect(byId(fixture, 'entity-link-create-core.type.hex-map')).not.toBeNull();
      expect(byId(fixture, 'entity-link-create-world.type.deity')?.textContent).toContain('Deity');
    });

    it('offers a type declaring a required Field like any other (ADR-0074)', () => {
      const fixture = render();
      click(fixture, 'entity-link-pick');
      fixture.detectChanges();

      // dnd.type.monster's CR is required. The bare create lands it Incomplete rather than refused, so
      // withholding it here would be the one surface that still bends around a gate nothing enforces.
      expect(byId(fixture, 'entity-link-create-dnd.type.monster')).not.toBeNull();
    });

    it('leaves out a System-managed type — the system alone assigns it (ADR-0068)', () => {
      const fixture = render();
      click(fixture, 'entity-link-pick');
      fixture.detectChanges();

      // The write choke point refuses a user-initiated create carrying one, so the button would only fail.
      expect(byId(fixture, 'entity-link-create-test.type.system')).toBeNull();
    });

    it('creates an Entity of the chosen type and links it in one flow', () => {
      nextCreatedId = 'n-new';
      const fixture = render();

      click(fixture, 'entity-link-pick');
      fixture.detectChanges();
      click(fixture, 'entity-link-create-core.type.note');
      fixture.detectChanges();

      // Blank query → the type's own untitled label (its `untitled` chrome key), never a branch on id.
      // The fixture's codeType derives that key from the type id, so it echoes `core.type.note.untitled`.
      expect(createdCalls).toEqual([{ name: 'core.type.note.untitled', type: 'core.type.note' }]);
      expect(fixture.componentInstance.linked()).toBe('n-new');
      // Resolved locally, so the new name shows without a server round trip.
      expect(byId(fixture, 'entity-link-name')?.textContent).toContain('core.type.note.untitled');
    });

    it('names the created Entity after the typed search query', () => {
      nextCreatedId = 'iron';
      const fixture = render();

      click(fixture, 'entity-link-pick');
      fixture.detectChanges();
      const search = byId(fixture, 'entity-link-search') as HTMLInputElement;
      search.value = 'Ironhold';
      search.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      click(fixture, 'entity-link-create-core.type.hex-map');
      fixture.detectChanges();

      expect(createdCalls).toEqual([{ name: 'Ironhold', type: 'core.type.hex-map' }]);
      expect(fixture.componentInstance.linked()).toBe('iron');
    });
  });

  it('renders its own chrome in French — the copy is web-entity’s, not a plugin’s', () => {
    const fixture = render();
    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();

    expect(byId(fixture, 'entity-link-pick')?.textContent).toContain('Lier une entité');
  });
});

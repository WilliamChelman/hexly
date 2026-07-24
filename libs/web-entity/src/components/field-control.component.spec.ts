import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { EntityPage, Field, defineField } from '@hexly/domain';
import { AssetsClient, EntitiesClient } from '@hexly/web-core';
import { MockEntitiesClient, provideTranslocoTesting } from '@hexly/web-core/testing';
import { FieldControlComponent } from './field-control.component';
import { WEB_ENTITY_TEST_CATALOGS } from '../i18n/test-catalogs';

const emptyPage: EntityPage = { items: [], nextCursor: null };

/** A host owning the field + value, mirroring how the generic Field view embeds the control. */
@Component({
  imports: [FieldControlComponent],
  template: `<app-field-control [field]="field()" [value]="value()" [worldId]="'w1'" />`,
})
class Host {
  readonly field = signal<Field>(assetLink);
  readonly value = signal<unknown>(null);
}

/** An entityLink Field targeting the Asset type — the pick-or-upload trigger (ADR-0066). */
const assetLink = defineField({
  id: 'core.field.thumbnail',
  label: 'Thumbnail',
  dataType: { kind: 'entityLink', targetTypes: ['core.type.asset'] },
  required: false,
  facetable: false,
});

/** A plain entityLink Field targeting a World type — the unchanged search-picker case. */
const placeLink = defineField({
  id: 'test.field.lair',
  label: 'Lair',
  dataType: { kind: 'entityLink', targetTypes: ['world.type.place'] },
  required: false,
  facetable: false,
});

describe('FieldControl entityLink branching (ADR-0066, #288)', () => {
  beforeEach(async () => {
    const entities = new MockEntitiesClient();
    entities.list.mockReturnValue(of(emptyPage));
    await TestBed.configureTestingModule({
      imports: [Host, provideTranslocoTesting(WEB_ENTITY_TEST_CATALOGS)],
      providers: [
        { provide: EntitiesClient, useValue: entities },
        { provide: AssetsClient, useValue: {} },
      ],
    }).compileComponents();
  });

  const byId = (el: HTMLElement, testid: string) => el.querySelector(`[data-testid="${testid}"]`) as HTMLElement | null;

  it('renders the asset pick-or-upload control for an asset-targeting entityLink', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.field.set(assetLink);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    // The asset affordance replaces the plain search picker.
    expect(byId(el, 'asset-link-control')).not.toBeNull();
    expect(byId(el, 'entity-link-field-core.field.thumbnail')).toBeNull();
  });

  it('leaves a non-asset entityLink unchanged — the plain search picker, no upload', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.field.set(placeLink);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    // The plain entityLink markup is used; the asset control is absent.
    expect(byId(el, 'entity-link-field-test.field.lair')).not.toBeNull();
    expect(byId(el, 'entity-link-open')).not.toBeNull();
    expect(byId(el, 'asset-link-control')).toBeNull();
  });
});

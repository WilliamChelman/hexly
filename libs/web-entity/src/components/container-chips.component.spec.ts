import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FacetCount } from '@hexly/domain';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { ContainerChipsComponent } from './container-chips.component';
import { COLLAB_TEST_CATALOGS } from '../i18n/test-catalogs';

/** A host owning the narrowing, mirroring how each picker embeds the chips beside its own read. */
@Component({
  imports: [ContainerChipsComponent],
  template: `<app-container-chips testid="pick" [containers]="containers()" [(selected)]="selected" />`,
})
class Host {
  readonly containers = signal<readonly FacetCount[]>([]);
  readonly selected = signal<string | undefined>(undefined);
}

describe('ContainerChips', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Host, provideTranslocoTesting(COLLAB_TEST_CATALOGS)],
    }).compileComponents();
  });

  const byId = (el: HTMLElement, testid: string) => el.querySelector(`[data-testid=${testid}]`) as HTMLElement | null;

  function render(containers: readonly FacetCount[]) {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.containers.set(containers);
    fixture.detectChanges();
    return fixture;
  }

  it('renders one counted chip per Container, labelled with its name', () => {
    const fixture = render([
      { value: 'w1', label: 'Aldermoor', count: 3 },
      { value: 'shelf', label: 'The Art Shelf', count: 1 },
    ]);
    const el = fixture.nativeElement as HTMLElement;

    expect(byId(el, 'pick-container-w1')?.textContent).toContain('Aldermoor');
    expect(byId(el, 'pick-container-shelf')?.textContent).toContain('The Art Shelf');
    // The count off the same read the options come from, so a chip cannot annotate a list it disagrees with.
    expect(byId(el, 'pick-container-shelf')?.textContent).toContain('1');
  });

  it('narrows to one Container and back to all', () => {
    const fixture = render([
      { value: 'w1', label: 'Aldermoor', count: 3 },
      { value: 'shelf', label: 'The Art Shelf', count: 1 },
    ]);
    const el = fixture.nativeElement as HTMLElement;

    byId(el, 'pick-container-shelf')?.click();
    expect(fixture.componentInstance.selected()).toBe('shelf');

    byId(el, 'pick-container-all')?.click();
    expect(fixture.componentInstance.selected()).toBeUndefined();
  });

  it('renders nothing where there is nothing to narrow — a World that Mounts nothing (ADR-0080)', () => {
    // One Container, or none: the read spans a single scope, so the category is absent by presence and
    // the picker looks exactly as it did before Mounts existed.
    expect(byId(render([{ value: 'w1', label: 'Aldermoor', count: 3 }]).nativeElement, 'pick-containers')).toBeNull();
    expect(byId(render([]).nativeElement, 'pick-containers')).toBeNull();
  });
});

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EntityDetail, EntityType } from '@hexly/domain';
import { EntitySession } from '../../editor-shell/entity-session';
import { EditorHeader } from '../../editor-shell/editor-header';
import { provideTranslocoTesting } from '../../core/i18n/transloco-testing';
import { EntityHeader } from './entity-header';

/** Stand-in so the test never mounts the real editor header and its deps. */
@Component({ selector: 'app-editor-header', template: 'HEADER' })
class EditorHeaderStub {}

describe('EntityHeader', () => {
  const detail = (type: EntityType): EntityDetail => ({
    id: 'x',
    ownerId: 'u1',
    name: 'X',
    type,
    tags: [],
    visibility: 'private',
    version: 1,
    createdAt: 1,
    updatedAt: 1,
    document:
      type === 'note'
        ? { type: 'note', content: { format: 'tiptap-v1', snapshot: {} } }
        : {
            type: 'hexmap',
            content: { format: 'tiptap-v1', snapshot: {} },
            hexes: {},
            regions: [],
            labels: [],
          },
  });

  async function render(type: EntityType) {
    await TestBed.configureTestingModule({
      imports: [EntityHeader, provideTranslocoTesting()],
      providers: [
        EntitySession,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    })
      .overrideComponent(EntityHeader, {
        remove: { imports: [EditorHeader] },
        add: { imports: [EditorHeaderStub] },
      })
      .compileComponents();
    TestBed.inject(EntitySession).adopt(detail(type));
    const fixture = TestBed.createComponent(EntityHeader);
    fixture.detectChanges();
    return fixture;
  }

  it('shows the editor header for a hexmap', async () => {
    const fixture = await render('hexmap');
    expect(fixture.nativeElement.querySelector('app-editor-header')).not.toBeNull();
  });

  it('shows no editor header for a note', async () => {
    const fixture = await render('note');
    expect(fixture.nativeElement.querySelector('app-editor-header')).toBeNull();
  });
});

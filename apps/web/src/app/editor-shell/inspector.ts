import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Button } from '../ui/button';
import { Chip } from '../ui/chip';
import { Coord } from '../ui/coord';
import { Eyebrow } from '../ui/eyebrow';
import { Field } from '../ui/field';
import { GlyphBox } from '../ui/glyph-box';
import { SettlementIcon } from '../ui/icon/glyphs/settlement';
import { Swatch } from '../ui/swatch';

/** The right rail: the selected hex's identity, terrain, regions and Note. */
@Component({
  selector: 'app-inspector',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Chip, Coord, Eyebrow, Field, GlyphBox, SettlementIcon, Swatch],
  template: `
    <header class="head">
      <span appEyebrow>Selected hex</span>
      <app-coord>q 0 · r 0</app-coord>
    </header>

    <div class="title">
      <span appGlyphBox><app-icon-settlement [size]="18" /></span>
      <div>
        <h3 class="name">Caer Aldermoor</h3>
        <app-chip tone="gold">Settlement</app-chip>
      </div>
    </div>

    <div appField label="Terrain">
      <div class="row">
        <span appSwatch style="background: var(--terrain-forest)"></span>
        <span>Forest</span>
      </div>
    </div>

    <div appField label="Regions">
      <div class="chips">
        <app-chip
          ><span appSwatch style="background: #7c9b86; width: 11px; height: 11px"></span
          >The Whisperwood</app-chip
        >
        <app-chip
          ><span appSwatch style="background: #b08a4e; width: 11px; height: 11px"></span
          >Aldermoor Reach</app-chip
        >
      </div>
    </div>

    <div appField label="Note" class="note">
      <p>
        A walled town where the forest road meets the river ford. The
        <em>Lanternwrights' Guild</em> keeps the old beacon lit — sailors on the
        Drowned Coast still steer by it on clear nights.
      </p>
    </div>

    <div class="actions">
      <button type="button" appButton size="sm" style="flex: 1">Edit note</button>
      <button type="button" appButton variant="ghost" size="sm" danger>Clear hex</button>
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
      padding: var(--space-4);
      overflow-y: auto;
      background: var(--surface);
      border-left: 1px solid var(--line-strong);
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .title {
      display: flex;
      gap: var(--space-3);
      align-items: center;
    }
    .title > div {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
      align-items: flex-start;
    }
    .name {
      font-size: var(--text-md);
    }
    .row {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      font-size: var(--text-sm);
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
    .note p {
      font-size: var(--text-sm);
      line-height: var(--leading-normal);
      color: var(--ink);
    }
    .actions {
      display: flex;
      gap: var(--space-2);
      margin-top: auto;
      padding-top: var(--space-2);
    }
  `,
})
export class Inspector {}

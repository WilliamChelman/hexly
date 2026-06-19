import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ThemeService } from '../core/theme.service';

interface Swatch {
  readonly token: string;
  readonly name: string;
}
interface TypeRow {
  readonly token: string;
  readonly size: string;
  readonly sample: string;
}

/**
 * The living design-system reference. It renders the token layer back to the
 * reader — colours, type, spacing, components — so other UI slices can see
 * exactly what is available and adopt it. It is intentionally built only from
 * the global component classes it documents.
 */
@Component({
  selector: 'app-styleguide',
  imports: [RouterLink],
  templateUrl: './styleguide.html',
  styleUrl: './styleguide.css',
})
export class Styleguide {
  protected readonly themeService = inject(ThemeService);
  protected readonly theme = this.themeService.theme;

  protected readonly semantic: Swatch[] = [
    { token: '--bg', name: 'Table' },
    { token: '--surface', name: 'Paper' },
    { token: '--surface-raised', name: 'Pinned note' },
    { token: '--surface-sunken', name: 'Well' },
    { token: '--ink', name: 'Ink' },
    { token: '--ink-muted', name: 'Ink muted' },
    { token: '--gold', name: 'Compass gold' },
    { token: '--sea', name: 'Sea / aurora' },
    { token: '--astra', name: 'Nebula' },
    { token: '--ember', name: 'Marginalia' },
    { token: '--positive', name: 'Moss' },
    { token: '--line-strong', name: 'Drawn rule' },
  ];

  protected readonly terrain: Swatch[] = [
    { token: '--terrain-grass', name: 'Grassland' },
    { token: '--terrain-forest', name: 'Forest' },
    { token: '--terrain-ocean', name: 'Ocean' },
    { token: '--terrain-mountain', name: 'Mountains' },
    { token: '--terrain-desert', name: 'Desert' },
    { token: '--terrain-marsh', name: 'Marsh' },
  ];

  protected readonly typeScale: TypeRow[] = [
    { token: '--text-3xl', size: '41px', sample: 'Worlds, mapped' },
    { token: '--text-2xl', size: '33px', sample: 'The Reach of Aldermoor' },
    { token: '--text-xl', size: '26px', sample: 'A cartographer’s table' },
    { token: '--text-lg', size: '21px', sample: 'Paint terrain & features' },
    {
      token: '--text-md',
      size: '17px',
      sample: 'Notes ride along in the side panel',
    },
    {
      token: '--text-base',
      size: '15px',
      sample: 'The default reading size for body copy.',
    },
    {
      token: '--text-sm',
      size: '13px',
      sample: 'Panel and control text sits here.',
    },
    {
      token: '--text-2xs',
      size: '11px',
      sample: 'Coordinate chips and micro-labels.',
    },
  ];

  protected readonly spacing = [
    '--space-1',
    '--space-2',
    '--space-3',
    '--space-4',
    '--space-5',
    '--space-6',
    '--space-7',
  ];

  protected readonly radii = [
    '--radius-sm',
    '--radius-md',
    '--radius-lg',
    '--radius-xl',
  ];
}

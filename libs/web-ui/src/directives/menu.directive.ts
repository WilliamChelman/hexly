import { Directive } from '@angular/core';
import {
  CdkMenu,
  CdkMenuGroup,
  CdkMenuItem,
  CdkMenuItemCheckbox,
  CdkMenuItemRadio,
  CdkMenuTrigger,
  MENU_TRIGGER,
  PARENT_OR_NEW_MENU_STACK_PROVIDER,
} from '@angular/cdk/menu';

/**
 * The app's menu primitives over CDK Menu (ADR-0007): CDK's behaviour — focus, keyboard, the
 * overlay, ARIA roles, and the menu-stack DI that closes menus on select — composed via
 * `hostDirectives` under the app's panel + row chrome (`menu-panel` / `menu-item`,
 * styles.css), so callers write plain buttons and links:
 *
 *   <button [appMenuTrigger]="actions">…</button>
 *   <ng-template #actions>
 *     <div appMenuPanel>
 *       <button appMenuItem (triggered)="run()">Action</button>
 *       <button appMenuItemCheckbox [checked]="on()" (triggered)="toggle()">Toggle</button>
 *       <a appMenuItem routerLink="/x">Link</a>
 *     </div>
 *   </ng-template>
 *
 * The panel and its rows live directly inside the trigger's `<ng-template>` (not projected
 * through a component) so CDK stamps them into the overlay with the menu-stack in scope —
 * a menu item resolved outside that context throws `NG0201: cdk-menu-stack`.
 */

/**
 * Opens a menu from the host element: `[appMenuTrigger]="theTemplate"`. Re-declares
 * {@link CdkMenuTrigger}'s two providers — `hostDirectives` don't carry a directive's
 * `providers`, so without this the root trigger's menu-stack goes missing
 * (`NG0201: cdk-menu-stack`).
 */
@Directive({
  selector: '[appMenuTrigger]',
  hostDirectives: [
    {
      directive: CdkMenuTrigger,
      inputs: ['cdkMenuTriggerFor: appMenuTrigger'],
    },
  ],
  providers: [{ provide: MENU_TRIGGER, useExisting: CdkMenuTrigger }, PARENT_OR_NEW_MENU_STACK_PROVIDER],
})
export class MenuTriggerDirective {}

/** The dropdown panel — one `<div appMenuPanel>` inside the trigger's `<ng-template>`. */
@Directive({
  selector: '[appMenuPanel]',
  hostDirectives: [CdkMenu],
  host: { class: 'menu-panel' },
})
export class MenuPanelDirective {}

/** A plain menu row — a `<button>` action or an `<a>` link. Re-exposes CDK's `(triggered)`. */
@Directive({
  selector: '[appMenuItem]',
  hostDirectives: [{ directive: CdkMenuItem, outputs: ['cdkMenuItemTriggered: triggered'] }],
  host: { class: 'menu-item' },
})
export class MenuItemDirective {}

/** A checkbox row: a trailing check reflects `[checked]`; flips on `(triggered)`. */
@Directive({
  selector: '[appMenuItemCheckbox]',
  hostDirectives: [
    {
      directive: CdkMenuItemCheckbox,
      inputs: ['cdkMenuItemChecked: checked'],
      outputs: ['cdkMenuItemTriggered: triggered'],
    },
  ],
  host: { class: 'menu-item justify-between w-full' },
})
export class MenuItemCheckboxDirective {}

/** A radio row within an {@link MenuGroupDirective}: `[checked]` marks the active one. */
@Directive({
  selector: '[appMenuItemRadio]',
  hostDirectives: [
    {
      directive: CdkMenuItemRadio,
      inputs: ['cdkMenuItemChecked: checked'],
      outputs: ['cdkMenuItemTriggered: triggered'],
    },
  ],
  host: { class: 'menu-item justify-between w-full' },
})
export class MenuItemRadioDirective {}

/** Groups radio rows so exactly one stays checked (ARIA radiogroup semantics). */
@Directive({
  selector: '[appMenuGroup]',
  hostDirectives: [CdkMenuGroup],
})
export class MenuGroupDirective {}

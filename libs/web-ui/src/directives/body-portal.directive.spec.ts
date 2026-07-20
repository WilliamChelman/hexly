import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BodyPortalDirective } from './body-portal.directive';

@Component({
  imports: [BodyPortalDirective],
  template: `
    @if (open()) {
      <div appBodyPortal data-testid="portaled">hoisted</div>
    }
  `,
})
class HostComponent {
  readonly open = signal(true);
}

describe('BodyPortalDirective', () => {
  const find = () => document.body.querySelector('[data-testid=portaled]');

  it('teleports the host to <body>, and removes it when the @if collapses', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges(); // flushes afterNextRender → teleport

    const node = find();
    expect(node).not.toBeNull();
    expect(node!.parentElement).toBe(document.body);

    // Angular removes a node via node.remove() (ignoring the recorded parent), so a teleported node is
    // still torn down when its structural block collapses — no orphan left at <body>.
    fixture.componentInstance.open.set(false);
    fixture.detectChanges();
    expect(find()).toBeNull();
  });
});

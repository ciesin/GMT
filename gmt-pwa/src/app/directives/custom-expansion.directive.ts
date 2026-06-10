import { Directive, ElementRef, HostListener } from '@angular/core';

@Directive({
    selector: '[closeChildExpansionOnClose]',
    standalone: false
})
export class closeChildExpansionOnClose {

  constructor(private el: ElementRef) { }

  @HostListener('closed')
  onPanelClose(): void {
    // close any open expansion panels
    this.closeChildPanels();
  }

  private closeChildPanels(): void {
    this.el.nativeElement
      .querySelectorAll('mat-expansion-panel mat-expansion-panel mat-expansion-panel-header.mat-expanded')
      .forEach(x => x.click());
  }
}

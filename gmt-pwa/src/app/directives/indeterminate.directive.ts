import { Directive, ElementRef,Input } from '@angular/core';

@Directive({
    selector: '[indeterminate]',
    standalone: false
})
export class IndeterminateDirective {
  @Input()
  set indeterminate(value:boolean){
    this.elem.nativeElement.indeterminate=value;
  }
  constructor(private elem: ElementRef) {}
}

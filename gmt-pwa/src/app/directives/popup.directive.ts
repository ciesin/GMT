import {Directive, ElementRef, EventEmitter, HostListener, Input, Output, Renderer2} from '@angular/core';
import {APP_ROOT_ID} from "../../main";

@Directive({
    selector: '[gmtPopup]',
    standalone: false
})
export class PopupDirective {
  private hostListener: (event: any) => void;
  private rootEl: any;
  @Output() onClose = new EventEmitter<void>();
  private rootListener: (event: any) => void;
  private appRoot: HTMLElement;

  constructor(private host: ElementRef, private renderer: Renderer2) {
    this.host = host;
  }

  ngOnInit() {
    this.rootEl = this.renderer.createElement('div');
    this.appRoot = document.getElementById(APP_ROOT_ID)!;
    this.appRoot.appendChild(this.rootEl);
    // document.body.appendChild(this.rootEl);
    this.renderer.addClass(this.rootEl,'gmtPopup')
    this.rootEl.appendChild(this.host.nativeElement)

    this.hostListener = (event: any) => {
      event.stopImmediatePropagation();
    };
    this.rootListener = (event: any) => {
      this.onClose.emit();
    };

    this.host.nativeElement.addEventListener("click", this.hostListener);
    this.rootEl.addEventListener("click", this.rootListener);
  }

  ngOnDestroy() {
    window.removeEventListener('click', this.hostListener, true);
    if (this.appRoot)
     this.appRoot.removeChild(this.rootEl);
  }

}

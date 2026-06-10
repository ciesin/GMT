import {Directive, ElementRef, HostListener, Input, Renderer2, TemplateRef} from '@angular/core';
import {APP_ROOT_ID} from "../../main";

// Usages :
// <div [menuPopup]="menu" side="top">
// <div class="menu-popup" #menu>someText</div>
// OR
// <div [menuPopupId]="someId" side="top">
// <div class="menu-popup" id="someId">someText</div>
// Note side attribute is optional, default is right

@Directive({
    selector: '[menuPopupId],[menuPopup]',
    standalone: false
})
export class MenuPopupDirective {
  @Input() menuPopupId: string;
  @Input() menuPopup: HTMLElement;
  @Input() side: "bottom" | "top" | "left" | "right" | "bottom-left" = "right";
  menu: HTMLElement | null = null;

  private hostListener: () => void;
  private created: boolean = false;
  private appRoot: HTMLElement;

  constructor(private host: ElementRef, private renderer: Renderer2) {
    this.host = host;
  }

  ngOnInit() {

    this.appRoot = document.getElementById(APP_ROOT_ID)!;
    const globalListener = (event:any) => {
      if (!this.menu || this.host.nativeElement.contains(event.target)) {
      //menu is closed or click is inside menu opener
        return;
      }
      this.hide();
    };
    const scrollListener = () => {
      this.hide()
    }

    this.hostListener = () => {
      if (!this.menu) {
        this.show();
        document.addEventListener("click", globalListener);
        window.addEventListener('scroll', scrollListener, true);
      } else {
        this.hide();
        document.removeEventListener("click", globalListener);
        window.removeEventListener('scroll', scrollListener, true);
      }
    };
    this.host.nativeElement.addEventListener("click", this.hostListener);
  }

  ngOnDestroy() {
    window.removeEventListener('click', this.hostListener, true);
    this.hide()
  }

  show() {
    if (this.menuPopupId) {
      this.menu = document.getElementById(this.menuPopupId) as HTMLElement;
    }
    if (this.menuPopup) {
      this.menu = this.menuPopup;
    }

    if (!this.created){
      this.renderer.appendChild(this.appRoot, this.menu);
      this.renderer.addClass(this.menu, `menu-popup-${this.side}`);
    }
    this.created = true;
    this.renderer.addClass(this.menu, 'menu-popup-show');
    this.renderer.addClass(this.host.nativeElement, 'menu-popup-open');
    setTimeout(() => {
      this.setPosition();
      this.renderer.addClass(this.menu, 'menu-popup-positioned');
    }, 100);
  }

  hide() {
    if (!this.renderer || !this.menu) {
      return;
    }
    this.renderer.removeClass(this.menu, 'menu-popup-show');
    this.renderer.removeClass(this.menu, 'menu-popup-positioned');
    this.renderer.removeClass(this.host.nativeElement, 'menu-popup-open');
    this.menu = null;
  }

  setPosition() {
    if (!this.menu) {
      return;
    }
    const hostPos = this.host.nativeElement.getBoundingClientRect();
    const tooltipPos = this.menu.getBoundingClientRect();
    const scrollPos = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;

    let top, left;

    if (this.side === 'bottom-left') {
      top = hostPos.bottom;
      left = hostPos.right - tooltipPos.width;
    }
    if (this.side === 'top') {
      top = hostPos.top - tooltipPos.height;
      left = hostPos.left;
    }

    if (this.side === 'bottom') {
      top = hostPos.bottom;
      left = hostPos.left;
    }

    if (this.side === 'left') {
      top = hostPos.top + (hostPos.height - tooltipPos.height) / 2;
      left = hostPos.left - tooltipPos.width;
    }

    if (this.side === 'right') {
      top = hostPos.top;
      left = hostPos.right;
    }

    this.renderer.setStyle(this.menu, 'top', `${top + scrollPos}px`);
    this.renderer.setStyle(this.menu, 'left', `${left}px`);
  }

}

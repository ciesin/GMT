import {Directive, ElementRef, HostListener, Input, Renderer2} from '@angular/core';
import { NGXLogger } from 'ngx-logger';
import {APP_ROOT_ID} from "../../main";

// Usages :
// <div [clickableToolTip]="someText" side="top">
// OR
// <div [clickableToolTipNode]="tooltip" side="top">
// <div class="clickable-tooltip" #tooltip>someText</div>
// OR
// <div [clickableToolTipId]="someId" side="top">
// <div class="clickable-tooltip" id="someId">someText</div>
// Note side attribute is optional, default is bottom

//clickable-tool-tip.directive.less should be also imported
@Directive({
    selector: '[clickableToolTip] , [clickableToolTipId], [clickableToolTipNode]',
    standalone: false
})
export class ClickableToolTipDirective {
  @Input() clickableToolTip: string;
  @Input() clickableToolTipId: string;
  @Input() clickableToolTipNode: HTMLElement;
  @Input() side: "bottom" | "top" | "left" | "right" = "bottom";
  tooltip: HTMLElement | null;
  offset = 10;
  private hostListener: (event: Event) => void;
  private created: boolean = false;

  handler = () => {
    this.hide()
  }
  private divCreated: HTMLElement | null = null;
  private appRoot: HTMLElement;

  constructor(private host: ElementRef,
              private renderer: Renderer2,
              private logger: NGXLogger) {
  }

  ngOnInit() {
    this.appRoot = document.getElementById(APP_ROOT_ID)!;
    const globalListener = (event: Event) => {
      if (!this.tooltip || this.host.nativeElement.contains(event.target)) {
        //menu is closed or click is inside menu opener
        return;
      }
      this.hide();
    };
    const scrollListener = () => {
      this.hide()
    }

    this.hostListener = (event) => {
      event.stopPropagation();
      event.stopImmediatePropagation();
      event.preventDefault();
      if (!this.tooltip) {
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
    try {
      if (this.clickableToolTipId) {
        this.tooltip = document.getElementById(this.clickableToolTipId) as HTMLElement;
      }
      if (this.clickableToolTipNode) {
        this.tooltip = this.clickableToolTipNode;
      }
      if (this.clickableToolTip) {
        if (!this.divCreated) {
          this.divCreated = this.renderer.createElement('div');
          this.renderer.addClass(this.divCreated, 'clickable-tooltip');
          this.renderer.appendChild(
            this.divCreated,
            this.renderer.createText(this.clickableToolTip)
          );
        }
        this.tooltip = this.divCreated;
      }

      if (!this.created) {
        this.renderer.appendChild(this.appRoot, this.tooltip);
        this.renderer.addClass(this.tooltip, `clickable-tooltip-${this.side}`);
      }
      this.created = true;
      this.renderer.addClass(this.tooltip, 'clickable-tooltip-show');
      this.renderer.addClass(this.host.nativeElement, 'clickable-tooltip-open');
      setTimeout(() => {
        this.setPosition();
        this.renderer.addClass(this.tooltip, 'clickable-tooltip-positioned');
      }, 100);
    } catch (e) {
      this.logger.error("ClickableToolTipDirective show")
      this.logger.error(e)
    }
  }

  hide() {
    try {
      if (!this.renderer || !this.tooltip) {
        return;
      }
      this.renderer.removeClass(this.host.nativeElement, 'clickable-tooltip-open');
      this.renderer.removeClass(this.tooltip, 'clickable-tooltip-show');
      this.tooltip = null;

    } catch (e) {
      this.logger.error("ClickableToolTipDirective hide")
      this.logger.error(e)
    }
  }

  create() {
    try {
      if (this.clickableToolTip) {
        this.tooltip = this.renderer.createElement('div');
        this.renderer.addClass(this.tooltip, 'clickable-tooltip');
        this.renderer.appendChild(
          this.tooltip,
          this.renderer.createText(this.clickableToolTip)
        );
      }

      if (this.clickableToolTipId) {
        let elementById = document.getElementById(this.clickableToolTipId);
        if (elementById) {
          this.tooltip = elementById.cloneNode(true) as HTMLElement;
        }
      }
      if (this.clickableToolTipNode) {
        this.tooltip = this.clickableToolTipNode.cloneNode(true) as HTMLElement;
        this.renderer.appendChild(this.appRoot, this.tooltip);
      }

      this.renderer.appendChild(this.appRoot, this.tooltip);
      this.renderer.addClass(this.tooltip, `clickable-tooltip-${this.side}`);

    } catch (e) {
      this.logger.error("ClickableToolTipDirective create")
      this.logger.error(e)
    }
  }

  setPosition() {
    if (!this.tooltip) {
      return;
    }
    const hostPos = this.host.nativeElement.getBoundingClientRect();
    const tooltipPos = this.tooltip.getBoundingClientRect();
    const scrollPos = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;

    let top, left;

    if (this.side === 'top') {
      top = hostPos.top - tooltipPos.height - this.offset;
      left = hostPos.left + (hostPos.width - tooltipPos.width) / 2;
    }

    if (this.side === 'bottom') {
      top = hostPos.bottom + this.offset;
      left = hostPos.left + (hostPos.width - tooltipPos.width) / 2;
    }

    if (this.side === 'left') {
      top = hostPos.top + (hostPos.height - tooltipPos.height) / 2;
      left = hostPos.left - tooltipPos.width - this.offset;
    }

    if (this.side === 'right') {
      top = hostPos.top + (hostPos.height - tooltipPos.height) / 2;
      left = hostPos.right + this.offset;
    }

    this.renderer.setStyle(this.tooltip, 'top', `${top + scrollPos}px`);
    this.renderer.setStyle(this.tooltip, 'left', `${left}px`);
  }
}

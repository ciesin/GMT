import {Component, EventEmitter, Input, OnInit, Output, Renderer2, ViewContainerRef} from '@angular/core';
import {v4 as uuidv4} from "uuid";
import {APP_ROOT_ID} from "../../../main";

/**
 * eg:
 * <gmt-dropdown [selectedKey]="selectedDistance" [options]="distanceOptions"
 *                                 (onSelect)="selectedDistance = $event">
 *
 *   selectedDistance: string = DISTANCE_KM;
 *     distanceOptions = {
 *       [DISTANCE_KM]: {
 *         optionHtml: 'Distance (km)', //could contains html
 *         selectedHtml: 'DISTANCE (KM)' //optional
 *       },...
 *     }
 *
 *
 */

@Component({
    selector: 'gmt-dropdown-switch',
    templateUrl: './dropdown-switch.component.html',
    styleUrls: ['./dropdown-switch.component.less'],
    standalone: false
})
export class DropdownSwitchComponent implements OnInit {

  @Input() options: { true: { optionHtml: string, selectedHtml?: string }, false: { optionHtml: string, selectedHtml?: string } };
  @Output() onSelect = new EventEmitter<boolean>();
  @Input() selectedKey: boolean | undefined = undefined;
  @Input() chooseLabel: string;

  popupId: string = uuidv4();
  hostId: string = uuidv4();
  popup: HTMLElement | null = null;
  host: HTMLElement | null = null;
  private globalListener: (event: any) => void;
  private scrollListener: () => void;
  private pendingPosition: NodeJS.Timeout;
  private appRoot: HTMLElement;

  constructor(private renderer: Renderer2,
              private _viewContainer: ViewContainerRef,
  ) {
  }

  ngOnInit(): void {
    this.appRoot = document.getElementById(APP_ROOT_ID)!;
    this.chooseLabel ||= "Choose";

    this.globalListener = (event: any) => {
      if (this.popup && this.popup.contains(event.target)) {
        //menu is closed or click is inside menu opener
        return;
      }
      this.hide();
    };
    this.scrollListener = () => {
      this.hide()
    }
  }

  ngOnDestroy() {
    this.hide()
  }

  show() {
    if (!this.popup) {
      this.popup = document.getElementById(this.popupId) as HTMLElement;
    }

    this.renderer.addClass(this.popup, 'show');
    if (this.pendingPosition) {
      clearTimeout(this.pendingPosition);
    }
    this.pendingPosition = setTimeout(() => {
      this.setPosition();
      this.renderer.addClass(this.popup, 'positioned');
      document.addEventListener("click", this.globalListener);
      window.addEventListener('scroll', this.scrollListener, true);
    }, 100);
  }

  hide() {
    if (this.pendingPosition) {
      clearTimeout(this.pendingPosition);
    }
    document.removeEventListener("click", this.globalListener);
    window.removeEventListener('scroll', this.scrollListener, true);
    if (!this.renderer || !this.popup) {
      return;
    }
    this.renderer.removeClass(this.popup, 'show');
    this.renderer.removeClass(this.popup, 'positioned');
    this.popup = null;
  }

  setPosition() {
    if (!this.popup) {
      return;
    }
    if (!this.host) {
      this.host = document.getElementById(this.hostId) as HTMLElement;
    }
    const hostRect = this.host.getBoundingClientRect();
    const popupRect = this.popup.getBoundingClientRect();
    const scrollPos = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;

    const left = hostRect.left;
    const width = hostRect.width;

    let top = hostRect.bottom;
    if (popupRect.height + hostRect.bottom - scrollPos > screen.height) {
      top = hostRect.top - popupRect.height;
    }

    this.renderer.appendChild(this.appRoot, this.popup);
    this.renderer.setStyle(this.popup, 'top', `${top}px`);
    this.renderer.setStyle(this.popup, 'left', `${left}px`);
    this.renderer.setStyle(this.popup, 'width', `${width}px`);
  }

  select(key: boolean) {
    this.selectedKey = key;
    this.onSelect.emit(key);
    this.hide();
  }

  toggle() {
    if (this.popup)
      this.hide();
    else
      this.show();
  }
}

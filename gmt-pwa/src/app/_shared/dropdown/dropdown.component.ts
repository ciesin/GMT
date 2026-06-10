import {Component, EventEmitter, Input, OnInit, Output, Renderer2, ViewContainerRef} from '@angular/core';
import { NGXLogger } from 'ngx-logger';
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
    selector: 'gmt-dropdown',
    templateUrl: './dropdown.component.html',
    styleUrls: ['./dropdown.component.less'],
    standalone: false
})
export class DropdownComponent<KeyType extends string> implements OnInit {

  @Input() options: {[key in string]: { optionHtml: string, selectedHtml?: string }};
  @Output() onSelect = new EventEmitter<KeyType>();
  @Input() selectedKey: string | undefined = "";
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
              private logger: NGXLogger
              ) {
  }

  ngOnInit(): void {

    if (!this.options[this.selectedKey!]){
      this.logger.error("Wrong selectedKey: ",this.selectedKey," for options: ",this.options);
      this.logger.info("fallback to: ");
      this.logger.info(Object.keys(this.options)[0]);
      this.selectedKey = Object.keys(this.options)[0];
    }

    this.appRoot = document.getElementById(APP_ROOT_ID)!;
    if (!this.selectedKey || this.selectedKey==="" )
        this.selectedKey = Object.keys(this.options)[0];

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
    if (popupRect.height + hostRect.bottom - scrollPos + 200> screen.height){
      top = hostRect.top - popupRect.height;
    }

    this.renderer.appendChild(this.appRoot, this.popup);
    this.renderer.setStyle(this.popup, 'top', `${top}px`);
    this.renderer.setStyle(this.popup, 'left', `${left}px`);
    this.renderer.setStyle(this.popup, 'width', `${width}px`);
  }

  select(key: string) {
    this.selectedKey = key;
    this.onSelect.emit(key as KeyType);
    this.hide();
  }

  toggle() {
    if (this.popup)
      this.hide();
    else
      this.show();
  }
}

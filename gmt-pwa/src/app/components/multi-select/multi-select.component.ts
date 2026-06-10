
import {
  Component,
  EventEmitter,
  Input,
  OnInit,
  Output,
  Renderer2,
  TemplateRef,
  ViewChild,
  ViewChildren
} from '@angular/core';
import {v4 as uuidv4} from "uuid";
import {TRUE} from "ol/functions";
import {APP_ROOT_ID} from "../../../main";
import {Subject} from "rxjs";
import {takeUntil} from "rxjs/operators";

@Component({
    selector: 'gmt-multi-select',
    templateUrl: './multi-select.component.html',
    styleUrls: ['./multi-select.component.less'],
    standalone: false
})
export class MultiSelectComponent<KeyType extends string> implements OnInit {
  @Input() openSelections: Subject<boolean> = new Subject();
  @Input() options: { [id: string]: string };
  @Input() allLabel: string = "All";
  @Input() optionStyle: string = "All";
  @Input() selectedItems: string[] ;
  @Input() selectionClass: string = "" ;
  @Input() filterInputText: string | undefined = "" ;
  @Output() onSelect = new EventEmitter<KeyType[]>();

  selectedItemsText: string = "";
  popupId: string = uuidv4();
  hostId: string = uuidv4();
  popup: HTMLElement | null = null;
  host: HTMLElement | null = null;
  private globalListener: (event: any) => void;
  private scrollListener: () => void;
  private pendingPosition: NodeJS.Timeout;
  allKeys: string[];
  optionsCount: number;
  private appRoot: HTMLElement;
  private unsubscribe = new Subject();

  constructor(private renderer: Renderer2) {
  }

  ngOnInit(): void {
    this.appRoot = document.getElementById(APP_ROOT_ID)!;
    this.allKeys = Object.keys(this.options);
    this.optionsCount = this.allKeys.length;
    this.globalListener = (event: any) => {
      if (this.popup && this.popup.contains(event.target)) {
        //menu is closed or click is inside menu opener
        return;
      }
      this.hide();
    };
    this.openSelections.pipe(takeUntil(this.unsubscribe)).subscribe(open => {
      if(open){
        this.show();
      } else{
        this.hide();
      }
    });
  }

  ngOnDestroy() {
    this.hide();
    this.unsubscribe.next(undefined);
    this.unsubscribe.complete();
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
    const hostPos = this.host.getBoundingClientRect();
    const scrollPos = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;

    const top = hostPos.top;
    const left = hostPos.left;
    const width = hostPos.width;

    this.renderer.appendChild(this.appRoot, this.popup);
    this.renderer.setStyle(this.popup, 'top', `${top}px`);
    this.renderer.setStyle(this.popup, 'left', `${left}px`);
    this.renderer.setStyle(this.popup, 'width', `${width}px`);
  }

  isSelected(optionKey: string) {
    return this.selectedItems.includes(optionKey)
  }

  onChange(target: any, key: string, event: Event) {
    if (target.checked) {
      if (!this.selectedItems.includes(key)) {
        this.selectedItems.push(key);
      }
    } else {
      if (this.selectedItems.includes(key)) {
        this.selectedItems.splice(this.selectedItems.indexOf(key), 1);
      }
    }
    if (this.selectedItems.length > 0)
      this.onSelect.emit(this.selectedItems as KeyType[]);
    else {
      this.selectedItems = [...this.allKeys];
      target.checked = true;
      this.onSelect.emit([...this.allKeys] as KeyType[]);
    }
    this.updateSelectedItemsText();
  }

  private updateSelectedItemsText() {

    if (this.selectedItems.length === 0 || this.selectedItems.length === this.optionsCount) {
      this.selectedItemsText = this.allLabel;
      return;
    }
    this.selectedItemsText = this.selectedItems.map(key => this.options[key]).join(", ");

  }

  log($event: Event) {
    console.log($event)
  }

  clearAll() {
    this.selectedItems = []
  }

  enableAll() {
    this.selectedItems = [...this.allKeys];
    this.updateSelectedItemsText();
    this.onSelect.emit(this.selectedItems as KeyType[]);
  }

  hightLightTerm(label: string) {
    if(!this.filterInputText){
      return label;
    }
    if (this.filterInputText.trim() === "") {
      return label;
    }
    return label.replace(new RegExp(this.filterInputText.trim(), 'gi'), (str) => '<span class="highlight">' + str + '</span>');
  }
}

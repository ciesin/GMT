import { CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import {
  AfterViewInit,
  Component,
  EventEmitter,
  Injectable,
  InjectionToken,
  Injector,
  Input,
  OnDestroy,
  OnInit,
  Output,
  Type,
  ViewChild,
} from '@angular/core';
import { MatAccordion } from '@angular/material/expansion';
import { MatSelectChange } from '@angular/material/select';
import { Sort, SortDirection } from '@angular/material/sort';
import { Router } from '@angular/router';
import { IconProp } from '@fortawesome/fontawesome-svg-core';
import _, { isNil } from 'lodash';
import { NGXLogger } from 'ngx-logger';
import { filter, ReplaySubject, Subject, takeUntil } from 'rxjs';
import { isNavigationEnd } from 'src/app/utils/route-helper';

export interface SortHeader {
  label: string;
  active: string;
  direction: SortDirection;
}

export const ID_TOKEN = new InjectionToken<string>('id');
export const EDIT_PERMISSIONS = new InjectionToken<boolean>('editPermissions');
export const ADDITIONAL_DATA = new InjectionToken<any>('additionalData');
export const ACCORDION_TOKEN = new InjectionToken<any>('accordion');

@Injectable()
export class Id {}

@Component({
  selector: 'gmt-microplan-list',
  templateUrl: './microplan-list.component.html',
  styleUrls: ['./microplan-list.component.less'],
  standalone: false
})
export class MicroplanListComponent
  implements AfterViewInit, OnInit, OnDestroy
{
  @Output() sortOrderChanged = new EventEmitter<Sort>();
  @Output() onScroll = new EventEmitter();
  @Input() virtualScroll = true;
  @Input() sortHeaders: Array<SortHeader | SortHeader[]> = [];
  @Input() idDisplayList: Array<string> = [];
  @Input() hasEditPermissions: boolean = false;
  @Input() additionalData: Map<string, any> = new Map();
  //The reason this exists is that in the case of the hf list in the st details page, we need to have injector
  //token values that are more unique, in that case snId + hfId.  If this is not used, then switching between
  //2 settlements that refer to same hf id will not refresh the HfDetailsContentComponent
  @Input() idPrefix: string = '';
  @Input() itemComponent: Type<any>;
  @Input() icon: IconProp;
  @Input() addFabSpace: boolean = false;
  @Input() noHeader: string | null = null;
  @Input() activeSort: Sort;

  private _injectors = new Map<string, Injector>();
  private scrollIndex: number;
  private considerScrollEvents = true;
  private considerScrollEventsTimeout: string | number | NodeJS.Timeout;
  private unsubscribe = new Subject();

  @ViewChild('scrollViewport') scrollviewport: CdkVirtualScrollViewport;
  matAccordion$ = new ReplaySubject<MatAccordion>();
  @ViewChild(MatAccordion) set matAccordion(m: MatAccordion) {
    this.matAccordion$.next(m);
  }

  constructor(
    private router: Router,
    private injector: Injector,
    private logger: NGXLogger
  ) {
    // To test empty list
    // setTimeout(() => {
    //   this.idDisplayList = [];
    // }, 1500);
  }

  ngOnInit(): void {
    if (isNil(this.activeSort)) {
      this.activeSort = this.sortHeaders.flat().find((s) => !!s.direction)!;
    }
  }

  ngOnDestroy(): void {
    this.matAccordion$.complete();
    this.unsubscribe.next(undefined);
    this.unsubscribe.complete();
  }

  ngAfterViewInit(): void {
    if (this.scrollviewport) {
      this.scrollviewport.scrolledIndexChange
        .pipe(
          filter((_) => this.considerScrollEvents),
          takeUntil(this.unsubscribe)
        )
        .subscribe(this.scroll.bind(this));
    } else {
      this.logger.error('scrollviewport is falsy');
    }

    this.listenToNavigationEnd();
  }

  private listenToNavigationEnd() {
    this.router.events
      .pipe(filter(isNavigationEnd), takeUntil(this.unsubscribe))
      .subscribe((event) => {
        // To avoid a bug where the scroll index is reset to 0 when changing tab,
        //  we disable scroll listening for 500ms after the navigation changed.
        this.logger.debug('Navigate end, set consider scroll to false');
        this.considerScrollEvents = false;
        if (this.considerScrollEventsTimeout) {
          clearTimeout(this.considerScrollEventsTimeout);
        }
        this.considerScrollEventsTimeout = setTimeout(() => {
          this.logger.debug(
            'Navigate end + 500ms, set consider scroll to true'
          );
          this.considerScrollEvents = true;
        }, 500);

        // We also reset the scroll index where it was previously
        if (this.scrollIndex && this.scrollviewport) {
          this.logger.debug(
            `Navigate end -- Setting scroll to ${this.scrollIndex}, # of items: ${this.idDisplayList.length}`
          );
          this.scrollviewport.scrollToIndex(this.scrollIndex);
        } else {
          this.logger.warn(
            `(this.scrollIndex && this.scrollviewport) falsy, not setting scroll position.  Scroll Index: ${
              this.scrollIndex
            }, Scroll Viewport Nil? ${_.isNil(this.scrollviewport)}`
          );
        }
      });
  }

  identify(index: number, id: string) {
    return id;
  }

  createInjector(id: string): Injector | null {
    if (!id) {
      this.logger.warn('id not defined: %o', id);
      return null;
    }

    // injector not present, create it
    if (!this._injectors.has(id)) {
      this.createNewInjector(id);
    } else {
      const inj = this._injectors.get(id)!;
      if (inj.get(EDIT_PERMISSIONS) !== this.hasEditPermissions) {
        this.createNewInjector(id);
      }
      // else if (inj.get(ADDITIONAL_DATA) !== this.additionalData.get(id)) {
      //   this.createNewInjector(id);
      // }
    }
    // return injector
    return this._injectors.get(id)!;
  }

  sortData(sort: Sort) {
    this.activeSort = sort;
    this.sortOrderChanged.next(sort);
  }

  private scroll(firstVisibleItemIndex: number) {
    //this.logger.debug(`Setting scroll index to ${this.scrollIndex}`);
    // remember scroll index
    this.scrollIndex = firstVisibleItemIndex;

    this.onScroll.emit();
  }

  public isSortHeader(x: SortHeader | SortHeader[]): x is SortHeader {
    return !(x instanceof Array);
  }

  public handleSortChoice(event: MatSelectChange | { value: string }) {
    const [active, direction] = event.value.split(',');
    this.sortData({ active, direction });
  }

  public disableSort(event) {
    if (!event.isUserInput) {
      return;
    }
    if (event.source._parent.selected === event.source) {
      // second click on already selected option
      //  disabling the selection
      event.source._parent.value = undefined;
      this.sortData({
        active: event.source.value.split(',')[0],
        direction: '',
      });
    }
  }

  private createNewInjector(id: string) {
    this._injectors.set(
      id,
      Injector.create({
        providers: [
          {
            provide: ID_TOKEN,
            useValue: id,
          },
          {
            provide: EDIT_PERMISSIONS,
            useValue: this.hasEditPermissions,
          },
          {
            provide: ADDITIONAL_DATA,
            useValue: this.additionalData ? this.additionalData.get(id) : null,
          },
          {
            provide: ACCORDION_TOKEN,
            useValue: this.matAccordion$,
          },
        ],
        parent: this.injector,
      })
    );
  }
}

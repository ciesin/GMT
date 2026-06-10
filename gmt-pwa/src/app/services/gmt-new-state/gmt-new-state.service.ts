import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type GmtNewMode = 'compact' | 'extanded' | 'expanded';

@Injectable({
  providedIn: 'root'
})
export class GmtNewStateService {

  private expanded = false;
  private expanded$ = new BehaviorSubject<boolean>(false);

  private hide = false;
  private hide$ = new BehaviorSubject<boolean>(false);


  constructor() { }

  getExpanded$() {
    return this.expanded$;
  }

  setExpanded(expanded: boolean) {
    this.expanded = expanded;
    this.expanded$.next(this.expanded);
  }

  getHide$() {
    return this.hide$;
  }

  setHide(hide: boolean) {
    this.hide = hide;
    this.hide$.next(this.hide);
  }
}

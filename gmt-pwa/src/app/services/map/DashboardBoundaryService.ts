import {Injectable} from "@angular/core";
import {BehaviorSubject, Observable} from "rxjs";
import {Extent} from "../../utils/server-interfaces/GeoJson";
import {BoundaryNameAndParent, EMPTY_BOUNDARY_NAME_AND_PARENT} from "../breadcrumb.service";



@Injectable({
  providedIn: 'root'
})
/**
 * Provides a shared boundary level focus, specifying the boundary level
 * to focus on and optionally the specific boundary entity which is focused.
 */
export class BoundaryFocusService {

  private _focus: BehaviorSubject<BoundaryNameAndParent> = new BehaviorSubject(EMPTY_BOUNDARY_NAME_AND_PARENT);

  focus: Observable<BoundaryNameAndParent> = this._focus.asObservable();

  /**
   * NOTE!!  This should only be called by boundary selector
   * subscribeToRouteChanges
   *
   * See comment there to keep flow unidirectional
   * @param focus
   */
  setFocus(focus: BoundaryNameAndParent) {
    this._focus.next(focus);
  }

  getFocus(): BoundaryNameAndParent {
    return this._focus.getValue();
  }
}

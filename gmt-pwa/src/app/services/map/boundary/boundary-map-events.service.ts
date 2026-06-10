import { Injectable } from "@angular/core";
import { MapEventsService } from "@services/map/base/map-events.service";
import { Observable, Subject } from "rxjs";

@Injectable({
    providedIn: 'root'
})
export class BoundaryMapEventsService extends MapEventsService {
    private boundaryHighlight = new Subject<string | null>();

    public triggerBoundaryHighlightEvent(highlightedBoundaryId: string | null) {
        this.boundaryHighlight.next(highlightedBoundaryId);
    }

    public boundaryHighlightEventObs(): Observable<string | null> {
        return this.boundaryHighlight.asObservable();
    }

}

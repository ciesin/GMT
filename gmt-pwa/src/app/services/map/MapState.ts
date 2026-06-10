import { Injectable } from "@angular/core";
import { BehaviorSubject, Observable } from "rxjs";
import { Extent, Position } from "../../utils/server-interfaces/GeoJson";
import BaseLayer from "ol/layer/Base";
import View from "ol/View";
import _ from "lodash";

export interface MapState {
    view: View | undefined,
    extent: Extent | undefined,
    focus: Extent | undefined,
    baselayers: BaseLayer[],
    overlays: BaseLayer[]
    baselayer: string | undefined
}


@Injectable({
    providedIn: 'root'
})
/**
 * Provides a shared map state to link more than one maps views to the same view state.
 * To sync maps, they can share the same view object. This view object should get
 * configured by only one map and other maps should set the new view on themselves.
 */
export class MapStateService {

    private _state: BehaviorSubject<MapState> = new BehaviorSubject({
        view: undefined,
        extent: undefined,
        focus: undefined,
        baselayers: [],
        overlays: [],
        baselayer: undefined
    } as MapState);

    state: Observable<MapState> = this._state.asObservable();

    setState(state: MapState) {
        this._state.next(state);
    }

    getState(): MapState {
        return this._state.getValue();
    }

    setView(view: View) {
        let state = this.getState();
        state.view = view;
        this.setState(state)
    }

    setFocus(focus: Extent | undefined) {
        let state = this.getState();
        state.focus = focus;
        this.setState(state)
    }

    setExtent(extent: Extent) {
        let state = this.getState();
        state.extent = extent;
        this.setState(state)
    }

    setBaselayers(layers: BaseLayer[]) {
        let state = this.getState();
        state.baselayers = layers;
        this.setState(state)
    }

    setBaselayer(layer: string | null) {
        let state = this.getState();
        if (_.isNil(layer)) {
            state.baselayer = undefined
        } else {
            state.baselayer = layer;
        }
        this.setState(state)
    }
}

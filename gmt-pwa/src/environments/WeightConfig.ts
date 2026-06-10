import {GeoJsonHealthFacility, GeoJsonSettlementPart, UNKNOWN} from "../app/utils/server-interfaces/GeoJson";
import {IEnvironment} from "./iEnvironment";
import _ from "lodash";

export class WeightConfig {

  private readonly pairs: Array<DistanceWeightPair>

  public readonly maxDistance: number = 2000;

  constructor(private env: IEnvironment) {
    const dwStrings = env.coverage_weight.distance.split(";");

    this.pairs = [];

    for(const dwStr of dwStrings) {
      const dw = dwStr.split(",");

      this.pairs.push({
                        distance: parseFloat( dw[0].trim() ),
                        weight: parseFloat( dw[1].trim() ),
                      });
    }

    this.pairs.sort( (a, b) => {
      return a.distance - b.distance;
    });

    this.maxDistance = this.pairs[this.pairs.length-1].distance;
  }

  private getDistanceWeight(distance: number) : number {

    for(let idx = 0; idx < this.pairs.length - 1; ++idx)
    {
            let dw1 = this.pairs[idx];
            let dw2 = this.pairs[idx+1]

            if (distance >= dw1.distance && distance < dw2.distance) {
                //normal case linear interp between these 2 points

                //y = y1 + ((x – x1) / (x2 – x1)) * (y2 – y1)
                //y is weight
                let slope = (distance - dw1.distance) / (dw2.distance - dw1.distance);
                return dw1.weight + slope * (dw2.weight - dw1.weight);
            }
        }

        //If our distance is less than the 1st point, we return the 1st
        if (distance < this.pairs[0].distance) {
            return this.pairs[0].weight;
        }

        //Too far, return 0.0
        return 0.0;

  }

  public calculateWeight(
    hf: GeoJsonHealthFacility,
    distance: number,
    sp: GeoJsonSettlementPart,
    debug: boolean = false
    ) : number {

    const distanceWeight = this.getDistanceWeight(distance);

    const inBoundary = sp.properties.boundary_polygon == hf.properties.boundary_polygon;

    const boundaryWeight = inBoundary ? this.env.coverage_weight.boundary.in : this.env.coverage_weight.boundary.out;

    const freqWeightConfig = this.env.coverage_weight.frequency;
    let freqWeight = freqWeightConfig[hf.properties.frequency];
    //A fallback that shouldn't happen, to ensure we don't have unknown or 0 weight
    if (!_.isFinite(freqWeight)) {
      freqWeight = freqWeightConfig.Unknown || 1;
    }

    const strategyWeight = hf.properties.type == "fixed_post" ?
      this.env.coverage_weight.strategy.fixed_post :
      this.env.coverage_weight.strategy.outreach;

    const weight = distanceWeight * strategyWeight * freqWeight * boundaryWeight;
    if (debug) {
      console.log(`For hf ${hf.properties.name} weight = ${weight} distace = ${distance} w = ${distanceWeight} freq = ${hf.properties.frequency} w = ${freqWeight} in boundary ${inBoundary} ${boundaryWeight} strat ${hf.properties.type} w = ${strategyWeight}`);
    }
    return weight;
  }

  public getMinSquarePerc() : number {
    return this.env.coverage_weight.min_square_perc;
  }

  public getMinSettPerc(): number {
    return this.env.coverage_weight.min_sett_percentage;
  }
  public getMinSettPop(): number {
    return this.env.coverage_weight.min_sett_pop;
  }
}


interface DistanceWeightPair {
    distance: number,
    weight: number,
}




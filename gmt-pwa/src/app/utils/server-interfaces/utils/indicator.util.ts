import { GeoJsonCatchmentItem, GeoJsonHealthFacility, GeoJsonSettlementName, GeoJsonSettlementPart } from "../GeoJson";
import { getNumberOrDefault, isFloat, isMachineGenerated } from "./string.util";
import { isEmpty } from "./geom.util";
import _ from "lodash";

export const NON_ZERO_POP = 0.49;

export function getSpComputedPop(
    sp: GeoJsonSettlementPart,
    minPop = 0
): number {
    if (!sp) {
        return minPop;
    }

    const pop = getNumberOrDefault(sp.properties.computed_pop, 0);

    if (pop < minPop) {
        return minPop;
    } else {
        return pop;
    }
}

/**
 *
 * @param sn
 * @param sp
 * @param logger
 * @returns
 */
export function getSnEstimatedPop(sn: GeoJsonSettlementName,
    sp: GeoJsonSettlementPart): number {

    if (!sp || !sn) {
        //This file is also shared in nodejs, where we don't have ngxlogger
        //logger.warn("Settlement name or part is null, can't calculate estimated pop");
        return 0;
    }

    if (_.isFinite(sn.properties.estimated_pop)) {
        return sn.properties.estimated_pop!;
    }

    //default to computed pop
    return getSpComputedPop(sp, 0);
}


export function getCiComputedPop(sn: GeoJsonSettlementName,
    sp: GeoJsonSettlementPart,
    ci: GeoJsonCatchmentItem): number {
    return getSpComputedPop(sp) * ci.properties.population_perc / 100.0;
}
//Defaults to computed pop if estimated pop is not defined
export function getCiEstimatedGisPop(sn: GeoJsonSettlementName,
    sp: GeoJsonSettlementPart,
    ci: GeoJsonCatchmentItem): number {
    return getSnEstimatedPop(sn, sp) * ci.properties.population_perc / 100.0;
}
//Returns null if estimated pop is not defined
export function getCiEstimatedPopIfExists(sn: GeoJsonSettlementName,
    ci: GeoJsonCatchmentItem): number | null {

    if (_.isNil(sn)) {
        return null;
    }

    if (!_.isFinite(sn.properties.estimated_pop)) {
        return null;
    }
    return sn.properties.estimated_pop! * ci.properties.population_perc / 100.0;
}

//Which health facilities would need Field data collection?
export function hfEligibleFDC(hf: GeoJsonHealthFacility): boolean {
    return hf.properties && hf.properties.services.includes("Routine Immunization");
}

export function hfNeedsFDC_NeedCoordsUpdate(hf: GeoJsonHealthFacility): boolean {
    return isEmpty(hf.geometry);
}

//Which settlement name points would need potentially field data collection
export function snEligbleFDC(sn: GeoJsonSettlementName): boolean {
    // TODO Eric - could be a bug
    return sn.properties && !sn.properties.uninhabited;
}

export function snNeedsFDC_NeedNameUpdate(sn: GeoJsonSettlementName): boolean {
    return sn.properties && isMachineGenerated(sn.properties?.name);
}

export function snNeedsFDC_NeedCoordsUpdate(sn: GeoJsonSettlementName): boolean {
    return isEmpty(sn.geometry);
}

//Just enough to calculate unclaimed and multiple claimed
export interface PartialSettlementNameCatchmentInfo {
    totalPerc: number;
    hfCount: number;
}

export function calculatePartialCatchmentInfo(
    settlementName: GeoJsonSettlementName,
    ciList: Array<GeoJsonCatchmentItem>,
): PartialSettlementNameCatchmentInfo {

    //In ciList ci.properties.settlement_name == settlementName.properties.global_id
    //should be true
    return {
        hfCount: ciList.length,
        totalPerc: calculateTotalPopulationClaimPerSettlement(ciList)
    };


}

function calculateTotalPopulationClaimPerSettlement(ciList: Array<GeoJsonCatchmentItem>): number {
    return ciList.reduce((acc, current) => {
        const popPerc = current.properties.population_perc;

        //this.logger.info(`Pop perc is ${popPerc}  ${isFloat(popPerc)}`);

        if (!isFloat(popPerc)) {
            return acc;
        } else {
            return acc + popPerc;
        }
    }, 0);


}

export function isUnclaimed(ciInfo: PartialSettlementNameCatchmentInfo): boolean {
    if (ciInfo.totalPerc < 99.8) {
        return true;
    }
    return false;
}


export function safeDivide(num: number, denom: number) {
    if (denom == 0) {
        return num;
    }
    return num / denom;
}

/*
Requirement -- field pop is >100% different from computed pop AND the absolute number is > 100 different
*/
export function settlementHasPopulationDiscrepencyIssue(
    name: GeoJsonSettlementName,
    part: GeoJsonSettlementPart
): boolean {

    if (!name || !part) {
        return false;
    }

    //always >= 0
    const computedPop = getSpComputedPop(part, 0);
    const estimatedPop = getSnEstimatedPop(name, part);

    const absDifference = Math.abs(computedPop - estimatedPop);

    //Any abs difference less than 100 we ignore
    if (absDifference <= 100) {
        return false;
    }

    const percDifferenceComputed = absDifference / computedPop;
    const percDifferenceEstimated = absDifference / estimatedPop;
    //% difference must be greater than 100%
    return percDifferenceComputed > 1 || percDifferenceEstimated > 1;
}


export function getNumberSafe(n: number | undefined | null, defaultNum = 0): number {
    if (_.isNumber(n)) {
        return n;
    } else {
        return defaultNum;
    }
}
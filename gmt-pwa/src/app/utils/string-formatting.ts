import levenshtein from "js-levenshtein";
import {
    Frequency,
    GeoJsonHealthFacility, GeoJsonHealthFacilityProperties,
    HealthFacilityType,
    PropertyValue,
    UNKNOWN
} from "./server-interfaces/GeoJson";
import { isFloat, isString } from "./server-interfaces/utils/string.util";
import { NOT_OPERATING_HOURS } from "../constants/hf.constants";
// import { NGXLogger } from "ngx-logger"; if uncommented, I get compilation issues
import * as _ from "lodash";

export { getNumberOrDefault, isFloat, isMachineGenerated, isString } from "./server-interfaces/utils/string.util";

export function formatDurationHm(timeInSeconds: number): string {
    if (timeInSeconds < 0) {
        return "Unknown";
    }

    const hours = Math.floor(timeInSeconds / 3600);
    const minutes = Math.ceil((timeInSeconds - (hours * 3600)) / 60);
    if (hours > 0) {
        if (minutes === 0) {
            return `${hours}h`;
        }
        return hours + "h" + ("0" + minutes).slice(-2);
    }
    return ("0" + minutes).slice(-2) + "min";
}

export function formatDuration(timeInSeconds: number, short = false): string {

    if (timeInSeconds < 0) {
        return "Unknown";
    }

    const hours = Math.floor(timeInSeconds / 3600);
    const minutes = Math.ceil((timeInSeconds - (hours * 3600)) / 60);
    //const seconds = Math.round(timeInSeconds - (hours * 3600) - (minutes * 60));

    if (short) {
        let out = hours > 1 ? hours + "h " : "";
        return out + minutes + "min";
    }

    let ret_pieces: Array<string> = [];

    if (hours > 1) {
        ret_pieces.push(`${hours} hours`);
    } else if (hours == 1) {
        ret_pieces.push(`${hours} hour`);
    }
    if (minutes > 1) {
        ret_pieces.push(`${minutes} minutes`);
    } else if (minutes == 1) {
        ret_pieces.push(`${minutes} minute`);
    }
    /*if (seconds > 1) {
      ret_pieces.push(`${seconds} seconds`);
    } else if (seconds == 1) {
      ret_pieces.push(`${seconds} second`);
    }*/

    return ret_pieces.join(" ");
}

export function formatPopulation(pop: PropertyValue, locale?: Intl.LocalesArgument, minify: boolean = true): string {
    if (!_.isFinite(pop) || (_.isNumber(pop) && pop <= -1)) {
        return "Unknown";
    }
    pop = pop as number;
    //to avoid displaying -0 as well as not displaying 1 for very low pop values
    let suffix = '';
    let maximumFractionDigits = 0;

    if (pop < 0.01) {
        return "0";
    }
    if (minify) {
        if (pop > 1e9) {
            // Billion pop
            pop = pop / 1e9;
            suffix = 'B';
            maximumFractionDigits = 1;
        } else if (pop > 1e6) {
            // Million pop
            pop = pop / 1e6;
            suffix = 'M';
            maximumFractionDigits = 1;
        } else if (pop > 1e3) {
            // Million pop
            pop = pop / 1e3;
            suffix = 'k';
            maximumFractionDigits = 1;
        }
    }
    return pop.toLocaleString(_.isNil(locale) ? undefined : locale, { maximumFractionDigits }) + suffix;
}

export function formatPercentageOn100OrNull(perc: PropertyValue, locale?: Intl.LocalesArgument): string | null {
    //if perc is not round, calculation could give result very closed to 0 : e.g. -9.1238456e-15
    if (!isFloat(perc) || perc < -0.001) {
        return null;
    }

    if (perc < 0)
        perc = 0;

    if (perc > 1)
        perc = 1;

    return (perc / 100).toLocaleString(locale, { style: 'percent', maximumFractionDigits: 0 });
}

export function formatPercentage(perc: PropertyValue, withPercSign: boolean = false, locale?: Intl.LocalesArgument): string {
    //if perc is not round, calculation could give result very closed to 0 : e.g. -9.1238456e-15
    if (!isFloat(perc) || perc < -0.001) {
        return "N/A";
    }

    if (perc < 0) {
        perc = 0;
    }
    return (perc / 100).toLocaleString(locale, { style: 'percent', maximumFractionDigits: 1 }).slice(0, withPercSign ? undefined : -1);
}



export function formatDistanceOrNull(distance: number, locale?: Intl.LocalesArgument) {
    let unit = 'meter';
    let maximumFractionDigits = 0;
    if (!isFloat(distance))
        return null;
    if (distance < 0)
        return null;
    if (distance >= 1000) {
        unit = 'kilometer';
        maximumFractionDigits = 1;
        distance /= 1000;
    }
    return distance.toLocaleString(locale, { style: 'unit', unit: unit, maximumFractionDigits });
}

export function formatDistance(distance: PropertyValue, short = false, locale?) {

    if (!isFloat(distance) || distance < 0) {
        return "-";
    }

    let unit = 'meter'

    if (distance >= 1000) {
        unit = "kilometer";
        distance /= 1000;
    }
    return distance.toLocaleString(locale, { style: 'unit', unit, unitDisplay: short ? 'narrow' : 'long' })
}

export const INVALID_COORD = -200;

/**
 * Formats a lat/lon
 * @param coord
 */
export function formatCoordinate(coord: number | unknown, maximumFractionDigits = 4, locale?): string {
    if (!isFloat(coord) || coord <= INVALID_COORD) {
        return "Unknown";
    }
    return coord.toLocaleString(locale, { maximumFractionDigits });
}


export function round(value: number, precision: any) {
    const multiplier = Math.pow(10, precision || 0);
    return Math.round(value * multiplier) / multiplier;
}


export interface Suggestion {
    query: string;
}

export function formatStrategy(strategy: HealthFacilityType): string {
    if (strategy == UNKNOWN) {
        return "Unknown";
    } else if (strategy == "fixed_post") {
        return "Fixed Post";
    } else if (strategy == "outreach") {
        return "Outreach";
    } else if (strategy == "mobile") {
        return "Mobile";
    }

    return "Unknown";
}

export function formatFrequency(frequency: Frequency) {

    switch (frequency) {
        case "oncePerMonth":
            return "Once per month";
        case "twicePerMonth":
            return "Twice per month";
        case "threePerMonth":
            return "Three times per month";
        //These are all shown as weekly where the operating hours is what distinguishes it
        case "oncePerWeek":
        case "twicePerWeek":
        case "threePerWeek":
        case "fourPerWeek":
        case "fivePerWeek":
        case "sixPerWeek":
        case "daily":
            return "Weekly";
        case "other":
            return "Other";
        case UNKNOWN:
        default:
            return "Unknown";
    }

}

export function formatFrequencyOrDays(hfProps: GeoJsonHealthFacilityProperties): string {
    let schedule = formatFrequency(hfProps.frequency);
    if (schedule == "Weekly") {
        return formatDaysAsCSL(hfProps);
    } else {
        return schedule;
    }
}

export function formatDaysAsCSL(hfProps: GeoJsonHealthFacilityProperties): string {

    if (_.isNil(hfProps)) {
        return "";
    }

    //Array starts at monday
    let isOpen = hfProps.operating_hours_stop.map(stop_time => stop_time !== NOT_OPERATING_HOURS);
    //Return indices of true values
    const trueIndices: Array<number> = isOpen.reduce((acc, val, index) => {
        if (val) { acc.push(index) }
        return acc;
    }, [] as Array<number>);

    const dayNames = trueIndices.map(idx => {
        switch (idx) {
            case 0:
                return 'Monday';
            case 1:
                return 'Tuesday';
            case 2:
                return 'Wednesday';
            case 3:
                return 'Thursday';
            case 4:
                return 'Friday';
            case 5:
                return 'Saturday';
            case 6:
                return 'Sunday';
            default:
                return 'Invalid Day';
        }
    });

    return dayNames.join(", ");
}

const IS_WHITESPACE_REGEX = new RegExp("^\\s*$");

export function isNullOrWhitespace(s: PropertyValue): boolean {
    if (!isString(s)) {
        return true;
    }

    return IS_WHITESPACE_REGEX.test(s);

}

export function joinListUnique<T>(s1: Array<T>, s2: Array<T>): Array<T> {
    //note sets are iterated in insertion order
    //https://stackoverflow.com/questions/33089695/how-can-i-sort-an-es6-set

    const set = new Set<T>();
    (s1 || []).forEach(item => set.add(item));
    (s2 || []).forEach(item => set.add(item));

    return Array.from(set);
}

export function firstUp(text: string) {
    if (text.length === 0)
        return "";
    return text.charAt(0).toUpperCase() + text.slice(1);
}

export function excerptStr(str: string, max: number) {
    return str.length <= max ? str : `${str.substr(0, max - 1)}...`;
}

function getWords(name1: string): Array<string> {
    return name1.split(/\s+/).filter(s => s.length > 0);
}

export function searchDistance(searchName: string, settlementName: string): number {

    if (!settlementName || settlementName.length == 0) {
        return 0;
    }
    if (!searchName || searchName.length == 0) {
        return 0;
    }

    let searchNameUpper: string = searchName.toLocaleUpperCase();
    let settlementNameUpper: string = settlementName.toLocaleUpperCase();

    const searchWords = getWords(searchNameUpper);
    const settlementWords = getWords(settlementNameUpper);

    //For each search word, take the best score and add it
    //each perfect word match is == 1

    //Also initialize the score with an overall match, same thing overall match is 1
    const len = Math.max(searchNameUpper.length, settlementNameUpper.length);
    const ld = levenshtein(searchNameUpper, settlementNameUpper);

    //Initialize total diff with overall score
    let totalDiff = 1 - ld / len;

    let maxScore = 1;

    //If the search name is only 1 word, return the min levenstein of the matching words
    for (const searchWord of searchWords) {
        let bestScore = -1;
        let bestIndex = -1;

        if (settlementWords.length <= 0) {
            break;
        }
        for (const [idx, settlementWord] of settlementWords.entries()) {
            const len = Math.max(settlementWord.length, searchWord.length);
            const ld = levenshtein(searchWord, settlementWord);
            //add a small score for a single word match
            const nd = 1 - ld / len;
            if (nd > bestScore) {
                bestScore = nd;
                bestIndex = idx;
            }
        }

        //remove the settlement word
        settlementWords.splice(bestIndex, 1);

        totalDiff += bestScore;

        maxScore += 1;
    }

    //Normalize between 0 and 1
    return totalDiff / maxScore;
}

export function highlightText(text: string, highlight: string) {
    if (highlight) {
        return text.replace(new RegExp(highlight, "gi"), match => {
            return '<span class="highlightText">' + match + '</span>';
        });
    }

    return text;
}

//https://stackoverflow.com/questions/45787459/convert-number-to-alphabet-string-javascript/45787487
export function indexToLetter(index: number, logger): string {

    if (index === 0) {
        // logger.info("Displayed index number should start at 1 to me more human readable. ")
        return "-"
    }

    let s = '', t;

    while (index > 0) {
        t = (index - 1) % 26;
        s += String.fromCharCode('a'.charCodeAt(0) + t);
        index = (index - t) / 26 | 0;
    }
    return s;
}


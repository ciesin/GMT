import { Sort } from '@angular/material/sort';
import {
    AUTOCOMPLETE_MAX_PROPOSITIONS,
    ChosenFilters
} from "src/app/components/microplan-view/microplan-filter/microplan-filter.component";
import { GeoJsonHealthFacility, GeoJsonSettlementName, SettlementListItem } from 'src/app/utils/server-interfaces/GeoJson';
import { CoverageHf } from '../../vector_layer/single-hf-processing.service';
import { SettlementIssueItem } from "../../../routine-immu/microplan-gis/base-data-edit/base-data-edit.component";
import _ from "lodash";

export interface SortingFilteringServiceInterface<T> {
    chosenFilters: ChosenFilters | null;
    list: Array<T>;
    sortOrder: Sort;
    idDisplayList: Array<string>;
    searchAutocompletePropositions: { name: string, value: string }[];

    setSortOrder(sortOrder: Sort);

    setFilters(chosenFilters: ChosenFilters);

    getSearchedText(): string | undefined;

    handleSearchText(search: string);

    filterAndSort(): Promise<void>;
}

//This class is built directly, not injected as an angular service
export class SortingFilteringService implements SortingFilteringServiceInterface<GeoJsonHealthFacility> {

    chosenFilters: ChosenFilters | null = null;
    list: Array<GeoJsonHealthFacility> = [];
    sortOrder: Sort
    idDisplayList: Array<string> = [];
    searchAutocompletePropositions: { name: string, value: string }[] = [];

    private healthFacilityCoverageData: Map<string, CoverageHf> = new Map();

    constructor(
        list: Array<GeoJsonHealthFacility>,
        healthFacilityData: Array<CoverageHf>,
        options: {
            chosenFilters?: ChosenFilters,
            sortOrder?: Sort,
        } = {}
    ) {
        if (options.chosenFilters) {
            console.debug('SortingFilteringService initialized with chosen filter', options.chosenFilters);
            this.setFilters(options.chosenFilters);
        }
        if (options.sortOrder) {
            console.debug('SortingFilteringService initialized with sort order', options.sortOrder);
            this.setSortOrder(options.sortOrder);
        }
        this.updateList(list, healthFacilityData);
    }

    public updateList(newList: Array<GeoJsonHealthFacility>, healthFacilityData: Array<CoverageHf>) {
        this.list = newList;
        this.healthFacilityCoverageData = new Map<string, CoverageHf>();
        for (const c of healthFacilityData) {
            if (!c) {
                continue;
            }
            this.healthFacilityCoverageData.set(c.global_id, c);
        }
        this.filterAndSort();
    }

    public setSortOrder(sortOrder: Sort) {
        return setSortOrderImpl(this, sortOrder);
    }

    public setFilters(chosenFilters: ChosenFilters) {
        return setFiltersImpl(this, chosenFilters);
    }

    public getSearchedText(): string | undefined {
        return getSearchedTextImpl(this);
    }

    public handleSearchText(search: string): void {
        this.searchAutocompletePropositions = getAutoCompletePropositions(
            search,
            this.list,
            getAllNames);
    }

    public async filterAndSort(): Promise<void> {
        // A. filter
        let filteredIdList = new Set();
        let searchText: string = this.getSearchedText()!;
        //This hack is to workaround an angular dom exception
        //Basically by waiting, the empty hf list gets rendered first, then afterwords we apply the filter
        await new Promise((p) => setTimeout(p, 1));

        if (!this.chosenFilters?.choices.size && !searchText) {
            filteredIdList = new Set(this.list.map(obj => obj.properties.global_id));
        } else {
            for (const obj of this.list) {
                let passedFilter = true;

                // filters
                if (this.chosenFilters!.choices.size > 0) {
                    for (const [filterKey, filterChoice] of this.chosenFilters!.choices.entries()) {
                        // Special case for "Services provided" filter because it is list, so != won't work
                        if (filterKey == "services") {
                            if (obj.properties.services.includes("Routine Immunization") !== filterChoice.value) {
                                passedFilter = false;
                                break;
                            }
                        } else {
                            if (obj.properties[filterKey] != filterChoice.value) {
                                passedFilter = false;
                                break;
                            }
                        }
                    }
                }

                //no need to search names if filter already failed
                if (!passedFilter) {
                    continue;
                }

                // search text
                if (searchText) {
                    const searchItems = getAllNames(obj);
                    if (searchItems.every(name => {
                        return !name.includes(searchText);
                    })) {
                        //if search fails all names, skip
                        passedFilter = false;
                    }
                }

                if (!passedFilter) {
                    continue;
                }

                filteredIdList.add(obj.properties.global_id);
            }
        }

        // B. Sort and reset
        if (!this.sortOrder || !this.sortOrder.direction) {
            this.idDisplayList = this.list
                .filter(obj => filteredIdList.has(obj.properties.global_id))
                .map(obj => obj.properties.global_id);
        } else {
            this.idDisplayList = this.list
                .filter(obj => filteredIdList.has(obj.properties.global_id))
                .sort((obj1, obj2) => {
                    let order = this.sortOrder.direction === 'asc' ? 1 : -1;
                    switch (this.sortOrder.active) {
                        case 'population':
                            const hf1Pop = this.healthFacilityCoverageData.has(obj1.properties.global_id) ? this.healthFacilityCoverageData.get(obj1.properties.global_id)!.catchmentPopulation.computedPop : 0;
                            const hf2Pop = this.healthFacilityCoverageData.has(obj2.properties.global_id) ? this.healthFacilityCoverageData.get(obj2.properties.global_id)!.catchmentPopulation.computedPop : 0;
                            return (hf1Pop - hf2Pop) * order;
                        case 'name':
                            return obj1.properties.name.localeCompare(obj2.properties.name) * order
                        default:
                            return 0;
                    }
                })
                .map(obj => obj.properties.global_id);
        }
    }
}


//Simulate mixins

export function setSortOrderImpl<T>(me: SortingFilteringServiceInterface<T>, sortOrder: Sort) {
    me.sortOrder = sortOrder;
}

export function setFiltersImpl<T>(me: SortingFilteringServiceInterface<T>, chosenFilters: ChosenFilters) {
    me.chosenFilters = chosenFilters;
}

export function getSearchedTextImpl<T>(me: SortingFilteringServiceInterface<T>): string | undefined {
    return me.chosenFilters?.searchText?.trim().toLocaleLowerCase();
}

export function getAutoCompletePropositions<T>(
    search: string,
    items: Array<T>,
    getAllNamesFunc: (item: T) => string[]): Array<{ name: string, value: string }> {

    const searchTerm = search.trim().toLocaleLowerCase();
    if (searchTerm === '') {
        return [];
    }

    const autocomplete: Array<{ name: string, value: string }> = [];
    let index = 0;
    while (autocomplete.length < AUTOCOMPLETE_MAX_PROPOSITIONS && index < items.length) {
        const itemNames = getAllNamesFunc(items[index]);
        for (const itemName of itemNames) {
            if (!itemName.includes(searchTerm)) {
                continue;
            }

            autocomplete.push({
                name: itemName,
                value: itemName,
            });
            //only do 1 per item
            continue;
        }

        index++;
    }
    return autocomplete;
}


function getAllNames(hItem: GeoJsonHealthFacility): Array<string> {
    const ret: Array<string> = [];
    ret.push(hItem.properties.name.toLocaleLowerCase());

    if (_.isArray(hItem.properties.synonyms)) {
        for (const s of hItem.properties.synonyms) {
            ret.push(s.toLocaleLowerCase());
        }
    }

    return ret;

}

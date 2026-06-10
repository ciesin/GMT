import { getSearchedTextImpl, SortingFilteringServiceInterface } from "./sorting-filtering.service";
import {
    HierarchyListEntry,
    HierarchyListEntryBoundary,
    HierarchyListEntryHF
} from "src/app/utils/server-interfaces/HierarchyList";
import {
    ChosenFilters
} from "@components/microplan-view/microplan-filter/microplan-filter.component";
import { Sort } from "@angular/material/sort";
import { VectorLayerService } from "@services/vector_layer/vector-layers.service";

interface testItem {
    name: string;
    id: string;
}
export class BoundarySortingFilteringService implements SortingFilteringServiceInterface<HierarchyListEntryBoundary | HierarchyListEntryHF> {
    chosenFilters: ChosenFilters;
    idDisplayList: Array<string>;
    list: Array<HierarchyListEntryBoundary | HierarchyListEntryHF>;
    searchAutocompletePropositions: { name: string; value: string }[];
    sortOrder: Sort;
    private readonly offlineIds: Set<string>;
    private filteredList: Array<HierarchyListEntryBoundary | HierarchyListEntryHF>;

    constructor(hierarchyList: Array<HierarchyListEntryBoundary | HierarchyListEntryHF>, offlineIds: Set<string>, options: {
        chosenFilters?: ChosenFilters,
        sortOrder?: Sort,
    } = {}) {
        if (options.chosenFilters) {
            console.debug('SortingFilteringService initialized with chosen filter', options.chosenFilters);
            this.setFilters(options.chosenFilters);
        }
        if (options.sortOrder) {
            console.debug('SortingFilteringService initialized with sort order', options.sortOrder);
            this.setSortOrder(options.sortOrder);
        }
        this.list = hierarchyList;
        this.filteredList = [...this.list];
        this.offlineIds = offlineIds;
        this.filterAndSort();
    }

    async filterAndSort(): Promise<void> {
        this.filter();
        this.sort();
    }

    filter() {
        let tempIdDisplaylist = new Array<string>();

        // search
        const search = this.getSearchedText();
        if (search === '') {
            tempIdDisplaylist = this.list.map(x => x.global_id);
        } else {
            tempIdDisplaylist = this.list
                .filter(x => x.name.toLocaleLowerCase().includes(search!))
                .map(x => x.global_id);
        }

        // filters
        const filters = this.chosenFilters?.choices || [];
        let tempList = this.list.filter(x => tempIdDisplaylist.includes(x.global_id));

        for (const [key, { value }] of filters) {
            switch (key) {

                case 'offline':
                    tempList = tempList.filter(x => value === this.offlineIds.has(x.global_id));
                    break;

                case 'participating':
                    tempList = tempList.filter((x: any) => value === !!x.indicators.num_boundary_participating);
                    break;

                case 'issues':
                    tempList = tempList.filter(x => this._checkIssueFilter(value, x));
                    break;

                default:
                    throw new Error('Filter not implemented');
            }
        }

        // update id list of items to display
        this.filteredList = tempList;
        this.idDisplayList = this.filteredList.map(x => x.global_id);
    }

    sort() {
        if (!this.sortOrder) {
            return;
        }

        this.idDisplayList = this.filteredList
            .sort((obj1, obj2) => {
                let order = this.sortOrder.direction === 'asc' ? -1 : 1;
                switch (this.sortOrder.active) {
                    case 'population':
                        const pop1 = (obj1 as HierarchyListEntryBoundary).indicators!.boundary_pop;
                        const pop2 = (obj2 as HierarchyListEntryBoundary).indicators!.boundary_pop;
                        return (pop1! - pop2!) * order;
                    case 'name':
                        return obj1.name.localeCompare(obj2.name) * order;
                    default:
                        return 0;
                }
            })
            .map(x => x.global_id);
    }

    getSearchedText(): string | undefined {
        return getSearchedTextImpl(this);
    }

    handleSearchText(search: string) {
    }

    setFilters(chosenFilters: ChosenFilters) {
        this.chosenFilters = chosenFilters;
    }

    setSortOrder(sortOrder: Sort) {
        this.sortOrder = sortOrder;
    }


    private _checkIssueFilter(value, item): boolean {
        // Quick and Dirty implementation of issue filter check based on attention-card
        // TODO refactor to clean code, maybe a service or utils functions ?

        switch (value) {
            case 'none':
                return !item.indicators.num_set_prob
                    && !item.indicators.num_set_mgn
                    && !item.indicators.num_boundary_corrections
                    && !item.indicators.num_set_pop_diff;
            case 'any':
                return !!item.indicators.num_set_prob
                    || !!item.indicators.num_set_mgn
                    || !!item.indicators.num_boundary_corrections
                    || !!item.indicators.num_set_pop_diff;
            case 'special':
                return !!item.indicators.num_set_prob;
            case 'missing base data':
                return !!item.indicators.num_set_mgn;
            case 'boundary corrections':
                return !!item.indicators.num_boundary_corrections;
            case 'population discrepancies':
                return !!item.indicators.num_set_pop_diff;
            default:
                throw new Error(`Filter not implemented for ${value}`)
        }
    }
}

import { Sort } from '@angular/material/sort';
import _, { isNil } from 'lodash';
import {
  ANY_PROBLEM_FILTER,
  ChosenFilters,
} from 'src/app/components/microplan-view/microplan-filter/microplan-filter.component';
import { SettlementIssueItem } from 'src/app/routine-immu/microplan-gis/base-data-edit/base-data-edit.component';
import {
  getAutoCompletePropositions,
  getSearchedTextImpl,
  setFiltersImpl,
  setSortOrderImpl,
  SortingFilteringServiceInterface,
} from 'src/app/services/shared/lists/sorting-filtering.service';
import { SingleStProcessingService } from 'src/app/services/vector_layer/single-st-processing.service';
import {
  ProblematicOption,
  SettlementListItem,
} from 'src/app/utils/server-interfaces/GeoJson';

//This class is built directly, not injected as an angular service
export class SettlementSortingFilteringService
  implements
    SortingFilteringServiceInterface<SettlementListItem | SettlementIssueItem>
{
  list: Array<SettlementListItem | SettlementIssueItem> = [];
  chosenFilters: ChosenFilters | null = null;
  sortOrder: Sort;
  idDisplayList: Array<string> = [];
  searchAutocompletePropositions: Array<{ name: string; value: string }> = [];

  constructor(
    private stService: SingleStProcessingService,
    list: Array<SettlementListItem | SettlementIssueItem>,
    options: {
      chosenFilters?: ChosenFilters;
      sortOrder?: Sort;
    } = {}
  ) {
    if (options.chosenFilters) {
      this.setFilters(options.chosenFilters);
    }
    if (options.sortOrder) {
      this.setSortOrder(options.sortOrder);
    }
    this.updateList(list);
    this.filterAndSort().then();
  }

  public updateList(list: Array<SettlementListItem | SettlementIssueItem>) {
    this.list = list;
    this.filterAndSort().then();
  }

  public handleSearchText(search: string): void {
    this.searchAutocompletePropositions = getAutoCompletePropositions(
      search,
      this.list,
      getAllNames
    );
  }

  public async filterAndSort(): Promise<void> {
    let filteredIdList: Set<string> = await this.filter();
    this.sort(filteredIdList);
    ////    // C. focus
    ////
    ////    // it is easier to separate filtering and clearing filter stage
    ////    if (!!searchText && this.chosenFilters.choices.size == 0) {
    ////      this.mapEvents.triggerRemoveHfFocus();
    ////    } else {
    ////      this.mapEvents.triggerFocusHf(this.hfIdDisplayList);
    ////    }
  }

  public async filter(): Promise<Set<string>> {
    let filteredSettNameGuidSet = new Set<string>();
    let searchText: string = this.chosenFilters?.searchText
      ?.trim()
      .toLocaleLowerCase()!;
    //This hack is to workaround an angular dom exception
    //Basically by waiting, the empty hf list gets rendered first, then afterwords we apply the filter
    await new Promise((p) => setTimeout(p, 1));

    if (!this.chosenFilters?.choices.size && !searchText) {
      filteredSettNameGuidSet = new Set(
        this.list.map((sett) => sett.settlementName.properties.global_id)
      );
    } else {
      for (const sett of this.list) {
        const passedFilter = passedSettlementFilter(
          this.chosenFilters,
          sett,
          searchText
        );

        if (!passedFilter) {
          continue;
        }

        filteredSettNameGuidSet.add(sett.settlementName.properties.global_id);
      }
    }
    return filteredSettNameGuidSet;
  }

  public sort(filteredIdList: Set<string>) {
    if (!this.sortOrder || !this.sortOrder.direction) {
      this.idDisplayList = this.list
        .filter((sett) =>
          filteredIdList.has(sett.settlementName.properties.global_id)
        )
        .map((sett) => sett.settlementName.properties.global_id);
    } else {
      this.idDisplayList = this.list
        .filter(
          (sett) =>
            filteredIdList.has(sett.settlementName.properties.global_id)!
        )
        .sort((sett1, sett2) => {
          let order = this.sortOrder.direction === 'asc' ? 1 : -1;
          switch (this.sortOrder.active) {
            case 'name':
              return (
                sett1.settlementName.properties.name.localeCompare(
                  sett2.settlementName.properties.name
                ) * order
              );
            case 'population':
              return (
                (sett1.settlementPart!.properties.computed_pop! -
                  sett2.settlementPart!.properties.computed_pop!) *
                order
              );
            case 'unclaimed':
              const catchment1 = this.stService.calculateCatchment(
                sett1.settlementPart!,
                sett1.settlementName
              );
              const catchment2 = this.stService.calculateCatchment(
                sett2.settlementPart!,
                sett2.settlementName
              );
              let sett1Unclaimed = 0;
              let sett2Unclaimed = 0;

              //Uninhabited will count as 0 unclaimed
              if (
                !isNil(catchment1) &&
                sett1.settlementName.properties.uninhabited !== true
              ) {
                sett1Unclaimed = catchment1.catchment.unclaimed;
              }
              if (
                !isNil(catchment2) &&
                sett2.settlementName.properties.uninhabited !== true
              ) {
                sett2Unclaimed = catchment2.catchment.unclaimed;
              }
              return (sett1Unclaimed - sett2Unclaimed) * order;
            default:
              return 0;
          }
        })
        .map((sett) => sett.settlementName.properties.global_id);
    }
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
}

function getAllNames(
  stItem: SettlementListItem | SettlementIssueItem
): Array<string> {
  const ret: Array<string> = [];
  ret.push(stItem.settlementName.properties.name.toLocaleLowerCase());

  if (_.isArray(stItem.settlementName.properties.synonyms)) {
    for (const s of stItem.settlementName.properties.synonyms) {
      ret.push(s.toLocaleLowerCase());
    }
  }

  return ret;
}

// True if settlement met the filter criteria
function passedSettlementFilter(
  chosenFilters: ChosenFilters | null,
  sett: SettlementIssueItem | SettlementListItem,
  searchText: string
): boolean {
  if (isNil(chosenFilters)) {
    //no filters mean we pass
    return true;
  }

  const settlementName = sett.settlementName;

  // filters

  for (const [filterKey, filterChoice] of chosenFilters.choices.entries()) {
    //Special case for problematic
    if (filterKey == 'problematic') {
      if (filterChoice.value == ANY_PROBLEM_FILTER) {
        //Any problem means we must have at least one
        if (
          settlementName.properties[filterKey] == null ||
          settlementName.properties[filterKey].length == 0
        ) {
          return false;
        }
      } else {
        //Filter a special problem
        if (
          !settlementName.properties.problematic.includes(
            filterChoice.value as ProblematicOption
          )
        ) {
          return false;
        }
      }
    } else if (settlementName.properties[filterKey] != filterChoice.value) {
      //generalized filterKey / value match
      return false;
    }
  }

  // search text
  if (searchText) {
    const searchItems = getAllNames(sett);
    if (
      searchItems.every((name) => {
        return !name.includes(searchText);
      })
    ) {
      //if search fails all names, skip
      return false;
    }
  }

  //all filters pass
  return true;
}

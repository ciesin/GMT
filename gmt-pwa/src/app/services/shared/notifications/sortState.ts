import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { ChosenFilters } from '@components/microplan-view/microplan-filter/microplan-filter.component';
import {
  GeoJsonHealthFacility,
  GeoJsonSettlementName,
} from '../../../utils/server-interfaces/GeoJson';
import _ from 'lodash';

export const EMPTY_SORT_STATE: ChosenFilters = {
  searchText: '',
  choices: new Map(),
};
/*
Purpose is for the sorts to communicate their state to the relevant cards

As the list uses component injection, this allows a cleaner way to communicate this
from the sorts to the components.

These appear to be filters, not sort info
*/
@Injectable({
  providedIn: 'root',
})
export class SortStateService {
  public hfListSort = new BehaviorSubject<ChosenFilters>(EMPTY_SORT_STATE);
  public stListSort = new BehaviorSubject<ChosenFilters>(EMPTY_SORT_STATE);
  public stListInHfDetailsSort = new BehaviorSubject<ChosenFilters>(
    EMPTY_SORT_STATE
  );
  public hfListInStDetailsSort = new BehaviorSubject<ChosenFilters>(
    EMPTY_SORT_STATE
  );

  constructor() {}
}

export function getSortedDisplayName(
  sortState: ChosenFilters,
  item: GeoJsonSettlementName | GeoJsonHealthFacility
): string {
  if (_.isNil(item)) {
    return '';
  }
  const search = sortState.searchText.trim().toLocaleLowerCase();
  const defaultDisplayName = item.properties.name;
  if (item.properties.name.toLocaleLowerCase().includes(search)) {
    //keep case here
    return defaultDisplayName;
  }

  if (!_.isArray(item.properties.synonyms)) {
    //shouldn't happen so just reset it
    return defaultDisplayName;
  }

  for (const aka of item.properties.synonyms) {
    if (aka.toLocaleLowerCase().includes(search)) {
      return 'AKA ' + aka;
    }
  }

  //If we found nothing reset it (though in that case should not be visible)
  return defaultDisplayName;
}

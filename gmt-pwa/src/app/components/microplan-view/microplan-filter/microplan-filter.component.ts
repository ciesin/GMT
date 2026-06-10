import { Component, Output, EventEmitter, OnInit, ViewChildren, QueryList, Input, ViewChild, ElementRef, OnChanges, SimpleChanges } from '@angular/core';
import { MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatOptionSelectionChange } from '@angular/material/core';
import { MatSelect, MatSelectChange } from '@angular/material/select';
import { debounceTime, distinctUntilChanged, filter, map, Subject, takeUntil, tap } from 'rxjs';
import _ from "lodash";

export const AUTOCOMPLETE_MAX_PROPOSITIONS = 5;
export interface ChosenFilters {
    searchText: string,
    choices: Map<string, MicroplanFilterChoice>
}

export interface MicroplanFilterItem {
    label: string,
    key: string,
    choices: Array<MicroplanFilterChoice>,
    filterFct?: (...args: any[]) => boolean,
}

export type MicroplanFilterValueType = string | null | boolean;

export interface MicroplanFilterChoice {
    label: string
    value: MicroplanFilterValueType,
}

export const EMPTY_CHOICE: MicroplanFilterChoice = {
    label: "--",
    value: null,
}

export const ANY_PROBLEM_FILTER = "any";
export const ANY_PROBLEM_CHOICE: MicroplanFilterChoice = {
    label: "Any",
    value: ANY_PROBLEM_FILTER,
}

export type Propositions = {
    name: string,
    value: any,
    hierarchy?: string[],
}[];


@Component({
    selector: 'gmt-microplan-filter',
    templateUrl: './microplan-filter.component.html',
    styleUrls: ['./microplan-filter.component.less'],
    standalone: false
})
export class MicroplanFilterComponent implements OnInit, OnChanges {
    @Output() chosenFiltersChanged = new EventEmitter<ChosenFilters>();
    @Output() searchTextChanged = new EventEmitter<string>();
    @Output() autocompleteSelection = new EventEmitter<MatAutocompleteSelectedEvent>();
    @Input() searchLabel = '';
    @Input() searchPlaceholder = 'Search';
    @Input() autocomplete: Propositions;
    @Input() searchTextUpdate = new Subject<string>();
    @Input() searchText: string = "";
    @Input() showFilters = false;

    //We need the filters available in the template
    @Input() filters: Array<MicroplanFilterItem> = [];
    filterValues = new Map<string, MicroplanFilterValueType>();

    @ViewChild('searchInput', { static: true }) searchInput: ElementRef<HTMLInputElement>;


    //Our output event interface
    @Input() chosenFilters: ChosenFilters = {
        searchText: "",
        choices: new Map(),
    }

    //Since iterating a map was freezing the browser
    //key, label pairs
    selectedFilters: Array<[string, string]> = [];

    // searchText: string = "";

    private unsubscribe = new Subject();

    @ViewChildren('filterSelect') filterSelectList!: QueryList<MatSelect>;

    onFilterChange(filterKey: string, change: MatSelectChange) {
        //console.log(`onFilterChange ${filterKey}`, change.value);

        //Use the key and value to look up option since we need the label
        const filter = this.filters.find(filter => filter.key === filterKey)!;
        const filterOption = filter.choices.find(choice => choice.value == change.value)!;

        if (filterOption.value === EMPTY_CHOICE.value) {
            this.chosenFilters.choices.delete(filterKey)
        } else {
            this.chosenFilters.choices.set(filterKey, filterOption);
        }

        this.chosenFiltersChanged.next(this.chosenFilters);
    }

    onSearchInputChange(change: Event | MatAutocompleteSelectedEvent) {
        // user validates the search (hitting enter or leaving input)
        this.chosenFilters.searchText = this.searchText;
        this.chosenFiltersChanged.next(this.chosenFilters);
    }

    onSearchInputClear() {
        this.searchText = '';

        // old style input change trigger so that onSearchInputChange gets triggered
        this.searchInput.nativeElement.dispatchEvent(new Event('change'));
    }

    onFilterRemove(filterKey: string) {
        this.chosenFilters.choices.delete(filterKey);

        this.chosenFiltersChanged.next(this.chosenFilters);

        //Also reset UI value
        for (const filterSelect of this.filterSelectList) {
            if (filterSelect.id !== filterKey) {
                continue;
            }
            filterSelect.value = null;
        }
    }

    onAutocompleteOptionSelection(event: MatAutocompleteSelectedEvent) {
        if (!this.autocompleteSelection.observed) {
            // default behavior, select the entry to search
            this.onSearchInputChange(event);
        } else {
            this.autocompleteSelection.next(event);
        }
    }

    ngOnChanges(changes: SimpleChanges) {
        const chng = changes['chosenFilters'];
        if (chng?.currentValue && chng.currentValue !== chng.previousValue) {
            this.chosenFiltersChanged.next(chng.currentValue);
        }
    }

    ngOnInit() {
        this.searchTextUpdate.pipe(
            filter(s => _.isString(s)),  // filter out non strings
            filter(s => s.trim().length >= 1),
            debounceTime(400),
            map(s => s.trim().toLocaleLowerCase()),
            distinctUntilChanged(),
            takeUntil(this.unsubscribe),
            // tap(s => console.log('searching', s)),
        ).subscribe(s => {
            // user types text in search. Triggers autocomplete
            this.searchTextChanged.next(s);
        });

        //Listen to our own event output since we want the choices in array form
        //due to the problem of angular freezing if we try to iterate directly over
        //the changedFilters.choices Map
        this.chosenFiltersChanged.pipe(
            takeUntil(this.unsubscribe),
        ).subscribe(changedFilters => {
            this.selectedFilters = [];
            for (const [filterKey, filterChoice] of changedFilters.choices.entries()) {

                this.selectedFilters.push([filterKey, filterChoice.label]);
                this.filterValues.set(filterKey, filterChoice.value);
            }
            // order selectedFilters to match the filters original order
            this.selectedFilters.sort((a, b) => this.filters.findIndex(f => f.key === a[0]) - this.filters.findIndex(f => f.key === b[0]));
            return;
        })
        // trigger first filter change for default value
        if (this.chosenFilters) {
            this.chosenFiltersChanged.next(this.chosenFilters);
        }
    }

    ngOnDestroy() {

        this.unsubscribe.next(undefined);
        this.unsubscribe.complete();
    }
}

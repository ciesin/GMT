import { MatSelect, MatSelectChange } from '@angular/material/select';

// export abstract class Filter {

//     onFilterChange(filterKey: string, change: MatSelectChange) {
//         console.log(`onFilterChange ${filterKey}`, change.value);

//         //Use the key and value to look up option since we need the label
//         const filter = this.hfFilters.find(filter => filter.key === filterKey)!;
//         const filterOption = filter.choices.find(choice => choice.value == change.value);

//         if (filterOption.value === EMPTY_CHOICE.value) {
//             this.chosenFilters.choices.delete(filterKey)
//         } else {
//             this.chosenFilters.choices.set(filterKey, filterOption);
//         }

//         this.chosenFiltersChanged.next(this.chosenFilters);
//     }

//     onSearchInputChange(change: Event) {
//         console.log(this.searchText);

//         this.chosenFilters.searchText = this.searchText;
//         this.chosenFiltersChanged.next(this.chosenFilters);
//     }

//     onFilterRemove(filterKey: string) {
//         this.chosenFilters.choices.delete(filterKey);

//         this.chosenFiltersChanged.next(this.chosenFilters);

//         //Also reset UI value
//         for (const filterSelect of this.filterSelectList) {
//             if (filterSelect.id !== filterKey) {
//                 continue;
//             }
//             filterSelect.value = null;
//         }
//     }

//     ngOnInit() {

//         //Listen to our own event output since we want the choices in array form
//         //due to the problem of angular freezing if we try to iterate directly over
//         //the changedFilters.choices Map
//         this.chosenFiltersChanged.pipe(
//             takeUntil(this.unsubscribe),
//         ).subscribe(changedFilters => {
//             this.selectedFilters = [];
//             for (const [filterKey, filterChoice] of changedFilters.choices.entries()) {

//                 this.selectedFilters.push([filterKey, filterChoice.label]);
//             }
//             return;
//         })
//     }

//     ngOnDestroy() {

//         this.unsubscribe.next(undefined);
//         this.unsubscribe.complete();
//     }
// }
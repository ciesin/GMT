import { ElementRef } from "@angular/core";
import { firstValueFrom, fromEvent } from "rxjs";
import { debounceTime, first, mapTo } from "rxjs/operators";

export const ROW_PER_PAGE = 40;

/**
 *   @ViewChild("settlementsScroll")
 *   settlementsScroll!: ElementRef;
 *
 *  exemple :
 *     [this.displayedSettlements, this.pageIndex] = computeInfiniteScroll(this.settlementsScroll.nativeElement,
 *       this.pageIndex,
 *       this.sortedSettlements,
 *       this.displayedSettlements,
 *       this.ROW_PER_PAGE,
 *       );
 * @param scrollElement
 * @param pageIndex
 * @param fromList
 * @param toList
 * @param rowPerPage
 */
export function computeInfiniteScroll<ListType>(scrollElement: ElementRef,
    pageIndex: number,
    fromList: ListType[],
    toList: ListType[],
    rowPerPage: number = ROW_PER_PAGE,):
    [ListType[], number] {
    const NUMBER_OF_DISPLAYED_PAGES = 3;
    const heightProportionTriggeringUpdate = 0.25;

    const MAX_PAGE_INDEX = fromList.length / rowPerPage;

    const expandDisplayedElement = (list: ListType[], pageIndex: number): any[] => {
        let minDisplayedItemIndex = Math.max((pageIndex) * rowPerPage, 0);
        let maxDisplayedItemIndex = Math.min((pageIndex + 3) * rowPerPage, list.length);
        return list.slice(minDisplayedItemIndex, maxDisplayedItemIndex);
    }

    if (scrollElement) {
        const { scrollTop, scrollHeight, clientHeight } = scrollElement.nativeElement;
        const padding = clientHeight * heightProportionTriggeringUpdate;
        if ((pageIndex + NUMBER_OF_DISPLAYED_PAGES) < MAX_PAGE_INDEX && scrollTop > scrollHeight - padding - clientHeight) {
            pageIndex++;
            return [expandDisplayedElement(fromList, pageIndex), pageIndex];
        }

        if (pageIndex > 0 && scrollTop < padding) {
            pageIndex--;
            return [expandDisplayedElement(fromList, pageIndex), pageIndex];
        }
    }

    return [expandDisplayedElement(fromList, pageIndex), pageIndex];
}

/**
scrollIntoView with end callback
*/
export const scrollToElementRef = (
    element: HTMLElement,
    options?: ScrollIntoViewOptions
): Promise<boolean | null> => {
    element.scrollIntoView(options);
    return firstValueFrom(fromEvent(window, 'scroll')
        .pipe(debounceTime(100), first(), mapTo(true)));

}

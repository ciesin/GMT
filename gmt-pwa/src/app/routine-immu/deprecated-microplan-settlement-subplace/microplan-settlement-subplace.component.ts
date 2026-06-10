// import {Component, ElementRef, EventEmitter, Input, OnInit, Output, ViewChild} from '@angular/core';
// import {GeoJsonSettlementName} from 'src/app/utils/server-interfaces/GeoJson';
// import {Subject} from "rxjs";
// import {MicroplanMapEventsService, OverlayLayer, ZoomMode} from "../../services/map/MicroplanMapEventsService";
// import {BoundaryVectorLayersService,} from "../../services/boundary-vector-layers.service";
// import {getExtentedBoundingBoxForFeatures} from "../../utils/coords";
// import {CrudLayerService} from "../../services/vector_layer/crud-layer.service";
// import {filter, switchMap, takeUntil} from "rxjs/operators";
// import {v4 as uuidv4} from 'uuid';
// import {computeInfiniteScroll} from "../../utils/server-interfaces/utils/ui.util";
// import {VectorLayerForPermissions} from "../../utils/server-interfaces/VectorLayerName";
// import {PermissionsLayerService} from "../../services/vector_layer/permissions-layer.service";
// import {UserContextService} from "../../services/user-context.service";
//
// @Component({
//   selector: 'gmt-microplan-settlement-subplace',
//   templateUrl: './microplan-settlement-subplace.component.html',
//   styleUrls: ['./microplan-settlement-subplace.component.less']
// })
// export class MicroplanSettlemenSubPlaceComponent implements OnInit {
//
//   @Input() public settlementNameId: string;
//   @Input() public textToHighlight: string = "";
//
//   @Output() public close = new EventEmitter<boolean>();
//
//   public subPlaceList: Array<GeoJsonSettlementName> = [];
//   public filteredSubPlaceList: Array<GeoJsonSettlementName> = [];
//   public displayedSubPlaceList: Array<GeoJsonSettlementName> = [];
//
//   public searchSubPlaceName = "";
//   private clearTimeout: ReturnType<typeof setTimeout> | null = null;
//
//   private unsubscribe = new Subject();
//   private pageIndex: number = 0;
//
//   public showPromoteDialog = false;
//   public promoteSubPlaceNameId = "";
//   public renamingPlace: GeoJsonSettlementName | null = null;
//   public nameToEdit: string = "";
//
//   private editing = false;
//   private userHasPermissionsUpdateSettlementName = false;
//
//   constructor(
//     public mapEvents: MicroplanMapEventsService,
//     public messageService: MessageService,
//     private crudLayerService: CrudLayerService,
//     private confirmationService: ConfirmationService,
//     //used by the page for boundaryParents, so public
//     public bvService: BoundaryVectorLayersService,
//     private permissionsLayerService: PermissionsLayerService,
//     private userContextService: UserContextService,
//   ) {
//   }
//
//   ngOnDestroy() {
//
//     //we don't want to do this because the complete event might have created things
//     //also cancel will take care of this
//     //this.mapEvents.removeAllFeatures(OverlayLayer.NORMAL)
//
//     this.unsubscribe.next(undefined);
//     this.unsubscribe.complete();
//   }
//
//   async ngOnInit() {
//
//     const sn = this.bvService.data.snMap.get(this.settlementNameId)!;
//     const spId = sn.properties.settlement_part!;
//     const boundaryId = sn.properties.boundary_polygon;
//
//     this.bvService.ensureBoundaryLoaded(boundaryId).pipe(
//       switchMap(_ok => {
//         return this.crudLayerService.suppressUserInterfaceUpdates.asObservable();
//       }),
//       filter(suppressUi => !suppressUi),
//       takeUntil(this.unsubscribe),
//     ).subscribe(() => {
//       const subPlaceNames = this.bvService.data.snList.filter(s => s.properties.settlement_part == spId && !s.properties.is_primary);
//
//       this.subPlaceList = subPlaceNames.sort((a, b) => {
//         return a.properties.name.localeCompare(b.properties.name);
//       });
//
//       this.searchSubPlaceName = this.textToHighlight;
//
//       this.updateFilteredList();
//       this.setComponentPermissions();
//     });
//     this.userContextService.getIsEditingObservable().pipe(
//       takeUntil(this.unsubscribe)
//     ).subscribe(pIsEditing => {
//       this.editing = pIsEditing;
//     });
//     this.permissionsLayerService.getPermissionsObservable().pipe(
//       takeUntil(this.unsubscribe)
//     ).subscribe(_ => {
//       this.setComponentPermissions();
//     });
//   }
//
//
//   @ViewChild("subPlacesScroll")
//   subPlacesScroll!: ElementRef;
//
//   updatePaginatedList() {
//     [this.displayedSubPlaceList, this.pageIndex] = computeInfiniteScroll(this.subPlacesScroll,
//       this.pageIndex,
//       this.filteredSubPlaceList,
//       this.displayedSubPlaceList,
//     );
//   }
//
//   handlePromote(s: GeoJsonSettlementName) {
//     this.promoteSubPlaceNameId = s.properties.global_id;
//     this.showPromoteDialog = true;
//   }
//
//   async editName(s: GeoJsonSettlementName) {
//     if (!this.renamingPlace) {
//       this.nameToEdit = s.properties.name;
//       this.renamingPlace = s;
//     } else {
//       if (this.nameToEdit.length <= 2)
//         return;
//
//       const actionId = uuidv4();
//
//       s.properties.name = this.nameToEdit;
//
//       this.crudLayerService.suppressUserInterfaceUpdates.next(true);
//       // What to call here?
//       await this.crudLayerService.updateItem("settlement__name", s, true, true, actionId);
//       this.crudLayerService.suppressUserInterfaceUpdates.next(false);
//
//       this.renamingPlace = null;
//     }
//
//
//   }
//
//   handleDeleteSubPlace(s: GeoJsonSettlementName) {
//     this.confirmationService.confirm({
//       message: 'Are you sure that you want to delete this subplace name?',
//       accept: () => {
//         //Actual logic to perform a confirmation
//         this.crudLayerService.deleteItem("settlement__name", s.properties.global_id, true, true, null).then();
//       }
//     });
//
//     //TODO remove from list, either directly editing subPlaceList and updateFiltered, or using observables
//   }
//
//   handleZoomToSubPlace(s: GeoJsonSettlementName) {
//     this.mapEvents.removeAllFeatures(OverlayLayer.NORMAL);
//
//     const extendedBoundingBox = getExtentedBoundingBoxForFeatures(100, s);
//
//     //Add the settlement name
//     this.mapEvents.addFeature({
//       geo_json: s,
//       style: (feature, resolution) => {
//           return settlementsStyleFunction(feature, resolution, true, false);
//         },
//       layer: OverlayLayer.NORMAL
//     });
//
//
//     this.mapEvents.panToExtent({
//       movementType: "Pan",
//       extent: extendedBoundingBox,
//       zoomMode: ZoomMode.ZOOM_IN_MAX
//     });
//   }
//
//   handleClose() {
//     this.close.next(true);
//   }
//
//   highlightText(text: string, highlight: string) {
//     if (highlight) {
//       return text.replace(new RegExp(highlight, "gi"), match => {
//         return '<span class="highlightText">' + match + '</span>';
//       });
//     }
//
//     return text;
//   }
//
//   handleSearchSubPlaceNameClick(event: MouseEvent) {
//     event.stopPropagation();
//     return true;
//   }
//
//   handleSearchSubPlaceNameChange(newSearch: string) {
//     newSearch = newSearch.trim();
//     if (0 < newSearch.length && newSearch.length < 3) {
//       return;
//     }
//
//     //Cancel the delayed search if there is one
//     if (this.clearTimeout) {
//       clearTimeout(this.clearTimeout);
//     }
//     //Wait a second before executing
//     this.clearTimeout = setTimeout(() => {
//       this.searchSubPlaceName = newSearch;
//       this.textToHighlight = newSearch;
//       this.updateFilteredList();
//     }, 500);
//
//   }
//
//
//   updateFilteredList() {
//     //need a list mapping primary and alternate names
//     //to a primary name guid via settlement part
//     this.filteredSubPlaceList = this.filterSubPlaceList(this.subPlaceList);
//     this.updatePaginatedList();
//   }
//
//   private setComponentPermissions(): void {
//     if (this.bvService.boundaryInfo?.boundary) {
//       this.userHasPermissionsUpdateSettlementName = this.userContextService.userHasPermissions(VectorLayerForPermissions.settlement, "update", this.bvService.boundaryInfo.boundary.properties.global_id);
//     }
//   }
//
//   public settlementNameEditEnabled() {
//     return this.editing && this.userHasPermissionsUpdateSettlementName;
//   }
//
//   private filterSubPlaceList(list: Array<GeoJsonSettlementName>): Array<GeoJsonSettlementName> {
//     const resultList: Array<GeoJsonSettlementName> = new Array<GeoJsonSettlementName>();
//
//     for (const s of list) {
//       if (!s.properties.name) {
//         continue;
//       }
//       if (s.properties.name.toLocaleLowerCase().includes(this.searchSubPlaceName.toLocaleLowerCase()))
//         resultList.push(s);
//     }
//     // this.logger.info("filterSettlementLists :", resultList);
//     return resultList;
//   }
//
// }
//

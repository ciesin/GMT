import { Injectable } from '@angular/core';
import {
  MapEventsService,
  OverlayLayer,
} from '@services/map/base/map-events.service';
import pointOnFeature from '@turf/point-on-feature';
import { isNil } from 'lodash';
import cloneDeep from 'lodash.clonedeep';
import { NGXLogger } from 'ngx-logger';
import { BehaviorSubject, first, Subject, takeUntil } from 'rxjs';
import {
  HealthFacilityItem,
  SettlementIssueItem,
} from 'src/app/routine-immu/microplan-gis/base-data-edit/base-data-edit.component';
import {
  HFProblemTypes,
  Resolution,
} from 'src/app/routine-immu/microplan-gis/microplan-gis.component';
import {
  BoundaryVectorLayersService,
  generateSettlementName,
} from 'src/app/services/boundary-vector-layers.service';
import { WORKER_CLIENT } from 'src/app/services/geo/WorkerClient';
import {
  SettlementNameProblemTypes,
  SettlementProblems,
  WorkerFunction,
} from 'src/app/services/geo/WorkerInterface';
import { MessageService } from 'src/app/services/shared/notifications/message.service';
import { RIRouteService } from 'src/app/services/shared/route/ri-route.service';
import { CrudLayerService } from 'src/app/services/vector_layer/crud-layer.service';
import {
  DefaultGeoJSonSettlementNameProperties,
  GeoJsonBoundary,
  GeoJsonBoundaryEdited,
  GeoJsonSettlementName,
  GeoJsonSettlementPart,
  Point,
  Position,
  SettlementListItem,
} from 'src/app/utils/server-interfaces/GeoJson';
import {
  geometryIntersects,
  isEmpty,
} from 'src/app/utils/server-interfaces/utils/geom.util';
import { settlementHasPopulationDiscrepencyIssue } from 'src/app/utils/server-interfaces/utils/indicator.util';
import { ST_NAME_LAYER } from 'src/app/utils/server-interfaces/VectorLayerName';
import { isNullOrWhitespace } from 'src/app/utils/string-formatting';
import { v4 as uuidv4 } from 'uuid';

@Injectable({
  providedIn: 'root',
})
export class ProblemsService {
  public populationIssues: SettlementListItem[] = [];
  public boundaryIssues: GeoJsonBoundaryEdited[] = [];

  private clickingMap = false;
  public settlementsLoading: boolean = false;
  public stBaseIssues: Map<string, SettlementIssueItem>;
  public stGeometryIssues: Map<string, SettlementIssueItem>;
  public hasAnyIssue = new BehaviorSubject<boolean>(false);
  public noHFs: boolean = false;
  public noSettlements: boolean = false;
  private settlementsMap = new Map<string, SettlementIssueItem>();
  private unsubscribe = new Subject();

  constructor(
    private crudLayerService: CrudLayerService,
    private logger: NGXLogger,
    private bvService: BoundaryVectorLayersService,
    private mapEvents: MapEventsService,
    private messageService: MessageService,
    private riRouterService: RIRouteService
  ) {}

  public hasAnyProblems() {
    const boundaryIssues = this.getAllBoundaryModifications(true);
    if (boundaryIssues && boundaryIssues.length > 0) {
      if (!this.hasAnyIssue.value) {
        this.hasAnyIssue.next(true);
      }
      return;
    }

    const popIssues = this.getPopulationProblems(true);
    if (popIssues.length > 0) {
      if (!this.hasAnyIssue.value) {
        this.hasAnyIssue.next(true);
      }
      return;
    }
    const hfBaseIssues = this.buildHfBaseProblems(true);
    if (hfBaseIssues.length > 0) {
      if (!this.hasAnyIssue.value) {
        this.hasAnyIssue.next(true);
      }
      return;
    }
    this.buildSettlementsBaseProblems((baseStIssues) => {
      if (baseStIssues.size > 0) {
        if (!this.hasAnyIssue.value) {
          this.hasAnyIssue.next(true);
        }
        return;
      } else {
        this.buildSettlementsGeometryProblems((geometryStIssues) => {
          if (geometryStIssues.size > 0) {
            if (!this.hasAnyIssue.value) {
              this.hasAnyIssue.next(true);
            }
            return;
          } else {
            if (this.hasAnyIssue.value) {
              this.hasAnyIssue.next(false);
            }
          }
        });
      }
    }, true);
  }

  public getPopulationProblems(
    earlyStop: boolean = false
  ): SettlementListItem[] {
    this.populationIssues = [];

    this.bvService.data.snList.every((settlementName) => {
      if (
        !settlementName.properties ||
        this.bvService.boundaryInfo.boundary.properties.global_id !==
          settlementName.properties.boundary_polygon ||
        !settlementName.properties.is_primary
      ) {
        return true;
      }
      const settlementPart =
        this.bvService.data.spMap.get(
          settlementName.properties.settlement_part!
        ) || null;
      // just skip null cases
      if (!settlementPart || !settlementName) {
        return true;
      }
      const settlementItem: SettlementListItem = {
        settlementName: settlementName,
        settlementPart,
      };
      if (this.settlementHasPopulationIssue(settlementItem)) {
        this.populationIssues.push(settlementItem);
        if (earlyStop) {
          return false;
        }
      }
      return true;
    });
    this.populationIssues.sort((a, b) => {
      return a.settlementName.properties.name.localeCompare(
        b.settlementName.properties.name
      );
    });
    return this.populationIssues;
  }

  public settlementHasPopulationIssue(
    settlementItem: SettlementListItem
  ): boolean {
    if (
      !settlementItem.settlementPart.properties.computed_pop ||
      settlementItem.settlementName.properties.estimated_pop === null ||
      settlementItem.settlementName.properties.estimated_pop === undefined
    ) {
      return false;
    }
    // const difference = Math.abs(settlementItem.settlementName.properties.estimated_pop / settlementItem.settlementPart.properties.computed_pop);
    // return difference > 2 || difference < 0.5;
    const popIssueExists = settlementHasPopulationDiscrepencyIssue(
      settlementItem.settlementName,
      settlementItem.settlementPart
    );
    // if user entered pop 0, we ask for uninhabited reason as well
    if (
      !popIssueExists &&
      settlementItem.settlementName.properties.estimated_pop === 0 &&
      !settlementItem.settlementName.properties.uninhabited_reason
    ) {
      return true;
    } else {
      return popIssueExists;
    }
  }

  public getAllBoundaryModifications(
    earlyStop: boolean = false
  ): GeoJsonBoundaryEdited[] | null {
    this.boundaryIssues = [];
    let existingEditIds: string[] = [];
    if (!this.bvService.data.bEditedList) {
      //Note this can't return [] because likely of Array.isArray checks later
      return null;
    }
    this.bvService.data.bEditedList.every(
      (editedBoundary: GeoJsonBoundaryEdited) => {
        if (
          editedBoundary.properties.boundary_polygon ==
            this.riRouterService.getBoundaryIdValue() &&
          editedBoundary.properties.resolved === false &&
          !existingEditIds.includes(editedBoundary.properties.global_id)
        ) {
          this.boundaryIssues.push(editedBoundary);
          existingEditIds.push(editedBoundary.properties.global_id);
          if (earlyStop) {
            return false;
          }
        }
        return true;
      }
    );
    return this.boundaryIssues;
  }

  public buildHealthFacilityListWithProblems(
    earlyStop: boolean = false
  ): HealthFacilityItem[] {
    const boundaryId = this.bvService.data.boundaryId;
    const notFilteredHfList: HealthFacilityItem[] = [];

    this.bvService.data.hfList.every((healthFacility) => {
      if (healthFacility.properties.boundary_polygon !== boundaryId) {
        return true;
      }

      let healthFacilityItem: HealthFacilityItem = {
        json: healthFacility,
        coordinates: {},
        problemsUI: [],
      };
      // commented out after the meeting https://github.com/novelt/GMT/issues/1656#issuecomment-1437116259
      //      this.refreshHealthFacilityProblems(healthFacilityItem);
      if (healthFacilityItem.problemsUI.length > 0) {
        notFilteredHfList.push(healthFacilityItem);
        if (earlyStop) {
          return false;
        }
      }

      //continue with every
      return true;
    });
    return notFilteredHfList;
  }

  //callback key is settlement name guid
  public buildSettlementsGeometryProblems(
    callback: (probs: Map<string, SettlementIssueItem>) => void,
    earlyStop: boolean = false
  ) {
    const allSettlementIssueItems = this.buildAllSettlementList();
    this.settlementsLoading = true;
    this.stGeometryIssues = new Map<string, SettlementIssueItem>();
    WORKER_CLIENT.getSettlementProblems({
      data: this.bvService.data.toPlainObj(),
      cacheKey: 0,
      settlementNames: allSettlementIssueItems.map((s) => s.settlementName!),
      problemType: WorkerFunction.GET_SETTLEMENT_PROBLEM_GEOMETRY,
      earlyStop: earlyStop,
    })
      .pipe(takeUntil(this.unsubscribe))
      .subscribe(
        (settlementNameProblems) => {
          if (!settlementNameProblems.problems?.length) {
            return;
          }
          const settlementItem = this.settlementsMap.get(
            settlementNameProblems.settlementNameId
          )!;
          // not sure if we still need to add resolutions here, also, we may want to do that only when user loads the element
          this.setProblemsToSettlement(settlementItem, settlementNameProblems);
          this.stGeometryIssues.set(
            settlementNameProblems.settlementNameId,
            settlementItem
          );
        },
        (e) => {
          this.logger.error(
            'Error in buildSettlementListWithProblems subscribe',
            e
          );
          this.settlementsLoading = false;
        },
        () => {
          this.settlementsLoading = false;
          callback(this.stGeometryIssues);
        }
      );
  }

  // commented out after the meeting https://github.com/novelt/GMT/issues/1656#issuecomment-1437116259
  // private refreshHealthFacilityProblems(healthFacilityItem: HealthFacilityItem) {
  //   healthFacilityItem.problemsUI = [];
  //   const problems = healthFacilityItem.problemsUI;
  //   const healthFacility = healthFacilityItem.json;
  //
  //
  //   if (isEmpty(healthFacility)) {
  //     problems.push({
  //       message: `\"${healthFacility.properties.name}\" has no position. Please edit Health Facility location. `,
  //       type: HFProblemTypes.EMPTY_OR_NULL_GEOMETRY,
  //       resolutions: [{
  //         label: "Choose point on map",
  //         command: () => this.handlePin(healthFacilityItem),
  //         tooltip: "Assign a point by clicking on the map."
  //       }]
  //     });
  //   } else {
  //     //Check boundary coherence
  //     const boundary = this.bvService.data.bMap.get(healthFacility.properties.boundary_polygon);
  //     if (!boundary || !geometryIntersects(boundary!, healthFacility)) {
  //       let problem: ProblemUI = {
  //         message: `\"${healthFacility.properties.name}\" does not intersect its assigned boundary \"${boundary?.properties.name}\"`,
  //         type: HFProblemTypes.HF_OUTSIDE_BOUNDARY,
  //         resolutions: []
  //       };
  //
  //       //Which boundary do we intersect with
  //       const intersectedBoundary = this.bvService.data.bList.find(b => {
  //         if (b.properties.level != this.bvService.boundaryInfo.boundary.properties.level) {
  //           return false;
  //         }
  //         return true;
  //         // return geometryIntersects(b, healthFacility);
  //       });
  //
  //       if (intersectedBoundary && intersectedBoundary!.properties.global_id != healthFacility.properties.boundary_polygon) {
  //         problem.resolutions.push({
  //           label: `Assign geospatial boundary of ${boundary!.properties.name}`,
  //           command: () => this.assignGeospatialBoundary(healthFacilityItem, intersectedBoundary!),
  //         });
  //       }
  //
  //       problems.push(problem)
  //     }
  //   }
  // }

  //issues is sn guid => SettlementIssueItem
  public buildSettlementsBaseProblems(
    callback: (issues: Map<string, SettlementIssueItem>) => void,
    earlyStop: boolean = false
  ) {
    const allSettlementIssueItems = this.buildAllSettlementList();
    this.settlementsLoading = true;
    this.stBaseIssues = new Map<string, SettlementIssueItem>();

    WORKER_CLIENT.getSettlementProblems({
      data: this.bvService.data.toPlainObj(),
      cacheKey: 0,
      settlementNames: allSettlementIssueItems.map((s) => s.settlementName!),
      problemType: WorkerFunction.GET_SETTLEMENT_PROBLEM_NAME_RELATED,
      earlyStop: earlyStop,
    })
      .pipe(takeUntil(this.unsubscribe))
      .subscribe(
        (settlementNameProblems) => {
          if (
            !settlementNameProblems ||
            !settlementNameProblems.problems?.length
          ) {
            return;
          }
          const settlementItem = this.settlementsMap.get(
            settlementNameProblems.settlementNameId
          )!;
          // not sure if we still need to add resolutions here, also, we may want to do that only when user loads the element
          this.setGeographyProblemsToSettlement(
            settlementItem,
            settlementNameProblems
          );
          this.stBaseIssues.set(
            settlementNameProblems.settlementNameId,
            settlementItem
          );
        },
        (e) => {
          this.logger.error(
            'Error in buildSettlementListWithProblems subscribe',
            e
          );
          this.settlementsLoading = false;
        },
        () => {
          callback(this.stBaseIssues);
          this.settlementsLoading = false;
        }
      );
  }

  /*
    Returns a list of HFs that have no name
    */
  public buildHfBaseProblems(
    earlyStop: boolean = false
  ): Array<HealthFacilityItem> {
    const boundaryId = this.bvService.data.boundaryId;
    const notFilteredHfList: Array<HealthFacilityItem> = [];
    let hfCount = 0;
    this.noHFs = false;
    for (const healthFacility of this.bvService.data.hfList) {
      //Only consider HFs in the current boundary that have a lat/lon
      if (healthFacility.properties.boundary_polygon !== boundaryId) {
        continue;
      }

      //We also don't currently report on problems with HFs that don't have a geometry
      if (isEmpty(healthFacility)) {
        continue;
      }

      hfCount++;
      let healthFacilityItem: HealthFacilityItem = {
        json: healthFacility,
        coordinates: {},
        problemsUI: [],
      };

      this.refreshHfBaseProblems(healthFacilityItem);
      if (healthFacilityItem.problemsUI.length > 0) {
        notFilteredHfList.push(healthFacilityItem);
        if (earlyStop) {
          break;
        }
      }
    }

    if (hfCount === 0) {
      this.noHFs = true;
    }
    return notFilteredHfList;
  }

  private buildAllSettlementList(): SettlementIssueItem[] {
    //seed the list with the primary settlement names for the boundary
    const allSettlements: SettlementIssueItem[] = [];
    let stCount = 0;
    this.noSettlements = false;
    for (const settlementName of this.bvService.data.snList) {
      //Only primary inhabited settlement names in current boundary
      if (
        !settlementName.properties ||
        this.bvService.boundaryInfo.boundary.properties.global_id !==
          settlementName.properties.boundary_polygon ||
        !settlementName.properties.is_primary ||
        settlementName.properties.uninhabited
      ) {
        continue;
      }

      //Note the problems tab is about issues that can come up in normal usage.
      //If there is no settlement part, this is a bug that isn't meant to address with the UI
      const settlementPart =
        this.bvService.data.spMap.get(
          settlementName.properties.settlement_part!
        ) || null;

      if (isNil(settlementPart)) {
        this.logger.warn(
          `Settlement part null for ${settlementName.properties.global_id}!`
        );
        continue;
      }

      stCount++;

      const SettlementIssueItem: SettlementIssueItem = {
        problemsUI: [],
        problems: null,
        settlementName: settlementName,
        settlementPart: settlementPart,
      };
      allSettlements.push(SettlementIssueItem);

      this.settlementsMap.set(
        SettlementIssueItem.settlementName.properties.global_id,
        SettlementIssueItem
      );
    }

    //Now we need to add any settlement parts that are not yet named
    // Note IEVA - this has to be handled differently with infinite scroll as we don't have this object in vector data list
    this.bvService.data.spList.forEach((settlementPart) => {
      if (
        !settlementPart.properties ||
        this.bvService.boundaryInfo.boundary.properties.global_id !==
          settlementPart.properties.boundary_polygon ||
        this.bvService.data.getPrimaryNamesForSettlementPart(
          settlementPart.properties.global_id,
          false
        ).length > 0
      ) {
        return;
      }
      //Generate a fake settlementName
      const settlementName: GeoJsonSettlementName = {
        geometry: {
          type: 'Point',
          //empty geometry
          coordinates: [] as unknown as [number, number],
        },
        properties: {
          ...DefaultGeoJSonSettlementNameProperties,
          boundary_polygon: settlementPart.properties.boundary_polygon,
          global_id: settlementPart.properties.global_id,
          name: 'Unnamed Area!',
          settlement_part: settlementPart.properties.global_id,
        },
        type: 'Feature',
      };

      const SettlementIssueItem: SettlementIssueItem = {
        problemsUI: [],
        problems: null,
        settlementName: settlementName,
        settlementPart: settlementPart,
      };
      allSettlements.push(SettlementIssueItem);
      this.settlementsMap.set(
        SettlementIssueItem.settlementName.properties.global_id,
        SettlementIssueItem
      );
    });
    if (stCount === 0) {
      this.noSettlements = true;
    }
    return allSettlements;
  }

  private setProblemsToSettlement(
    settlementIssueItem: SettlementIssueItem,
    settlementNameProblems: SettlementProblems
  ) {
    settlementIssueItem.problemsUI = [];
    settlementIssueItem.problems = settlementNameProblems;

    for (let i = 0; i < settlementNameProblems.problems.length; i++) {
      const type = settlementNameProblems.problems[i];
      const message = settlementNameProblems.messages[i];
      const resolutions: Resolution[] = [];
      const problemUi = {
        message,
        resolutions,
        type,
      };
      settlementIssueItem.problemsUI.push(problemUi);

      if (
        type === SettlementNameProblemTypes.NO_SETTLEMENT_PART ||
        type === SettlementNameProblemTypes.INVALID_SETTLEMENT_PART
      ) {
        if (settlementNameProblems.intersectingPartsWithName.length >= 1) {
          resolutions.push({
            label: 'Assign settlement part',
            command: () =>
              this.actionAssignSettlementPart(
                settlementIssueItem,
                settlementNameProblems.intersectingPartsWithName[0]
              ),
          });
        } else {
          this.logger.info(
            `Cannot propose settlement part assignment to ${settlementIssueItem.settlementName.properties.name} because # intersecting is ${settlementNameProblems.intersectingPartsWithName.length}`
          );
          // const demote = {
          //   label: "Change to sub place name",
          //   command: () => this.handleDemoteName(this.settlementIssueItem.settlementName!)
          // };

          const deleteName = {
            label: 'Delete settlement name point',
            command: () =>
              this.handleDeleteName(settlementIssueItem.settlementName!),
          };

          const generateBuffer = {
            label: 'Generate a buffer around the point',
            command: () => this.handleCreateBuffer(settlementIssueItem),
          };
          resolutions.push(deleteName, generateBuffer); // Deleted for SubPlace names demote,
        }
      }

      if (type === SettlementNameProblemTypes.EMPTY_OR_NULL_GEOMETRY) {
        resolutions.push({
          label: 'Choose point on map',
          command: () =>
            this.actionAssignGeometry(settlementIssueItem.settlementName!),
        });
      }

      if (type === SettlementNameProblemTypes.NAME_OUTSIDE_BOUNDARY) {
        //Which boundary do we intersect with
        const boundary = this.bvService.data.bList.find((b) => {
          if (
            b.properties.level !=
            this.bvService.boundaryInfo.boundary.properties.level
          ) {
            return false;
          }
          return geometryIntersects(b, settlementIssueItem.settlementName!);
        });

        if (
          boundary &&
          boundary.properties.global_id !=
            settlementIssueItem.settlementName!.properties.boundary_polygon
        ) {
          resolutions.push({
            label: `Assign geospatial boundary of ${boundary.properties.name}`,
            command: () =>
              this.assignGeospatialBoundaryForSt(settlementIssueItem, boundary),
          });
        }
      }

      if (type === SettlementNameProblemTypes.NO_INTERSECT_FK_SETTLEMENT_PART) {
        resolutions.push({
          label: `Move name point to inside the settlement border`,
          command: () =>
            this.moveNameOnSurface(
              settlementIssueItem.settlementName!,
              settlementIssueItem.settlementPart!
            ),
        });
      }

      if (
        type === SettlementNameProblemTypes.PART_BOUNDARY_ATTRIBUTE_MISMATCH
      ) {
        resolutions.push({
          label: `Set boundary id of settlement part to that of the settlement name`,
          command: () =>
            this.actionAssignPrimaryNameBoundaryToSettlementPart(
              settlementIssueItem.settlementName
            ),
        });
      }

      if (type === SettlementNameProblemTypes.NO_SETTLEMENT_NAME) {
        const allNames = settlementNameProblems.intersectingNames || [];
        resolutions.push({
          label: `Generate Machine Generated Name`,
          command: () => this.actionCreateGeneratedName(settlementIssueItem),
        });

        for (const name of allNames) {
          //Only allow option to primary names if the name is not being used
          if (
            name.properties.is_primary &&
            (!name.properties.settlement_part ||
              !this.bvService.data.spMap.get(name.properties.settlement_part))
          ) {
            const resolution = {
              label: `Assign Primary Name ${name.properties.name}`,
              command: () =>
                this.actionAssignPrimaryNameToSettlementPart(
                  settlementIssueItem,
                  name
                ),
            };
            resolutions.push(resolution);
          } else if (!name.properties.is_primary) {
            const resolution = {
              label: `Assign and Promote Alternate Name ${name.properties.name}`,
              command: () =>
                this.actionAssignAndPromoteAlternateNameToSettlementPart(
                  settlementIssueItem,
                  name
                ),
            };
            resolutions.push(resolution);
          }
        }
      }
    }
  }

  async actionAssignGeometry(settlementName: GeoJsonSettlementName) {
    if (this.clickingMap) {
      return;
    }

    this.clickingMap = true;
    this.mapEvents.emitInteractions(false);

    this.logger.info('In actionAssignGeometry getClickedObservable');
    this.messageService.add({
      summary: 'Please click the map to create a point for the settlement',
      severity: 'info',
      key: 'small',
      life: 2000,
    });
    const clickedEvent = await this.mapEvents
      .getClickedObservable()
      .pipe(first())
      .toPromise();

    this.logger.info('In handleAddNewSettlementName CLICK', clickedEvent);

    settlementName.geometry = {
      type: 'Point',
      coordinates: clickedEvent!.coordinates as Position,
    };

    const intersectedSettlementPart = this.bvService.data.spList.find((sp) => {
      return geometryIntersects(sp, settlementName);
    });

    if (intersectedSettlementPart) {
      this.logger.info('actionAssignGeometry We have a settlement part');
      settlementName.properties.settlement_part =
        intersectedSettlementPart.properties.global_id;
    }

    await this.crudLayerService.updateItem(
      ST_NAME_LAYER,
      cloneDeep(settlementName),
      true,
      true
    );
  }

  //Creates a CRUD action that assigns the settlement part to the primary name
  private async actionAssignSettlementPart(
    SettlementIssueItem: SettlementIssueItem,
    settlementPart: GeoJsonSettlementPart
  ) {
    const geojson = cloneDeep(SettlementIssueItem.settlementName!);
    geojson.properties.settlement_part = settlementPart.properties.global_id;
    const actionId = uuidv4();
    await this.crudLayerService.updateItem(
      ST_NAME_LAYER,
      geojson,
      true,
      true,
      actionId
    );
    await this.bvService.computeAllCatchmentAssignments(
      [settlementPart],
      actionId,
      new Set()
    );
    this.logger.info('Settlement name updated', geojson);
  }

  async handleDeleteName(name: GeoJsonSettlementName) {
    this.mapEvents.removeAllFeatures(OverlayLayer.NORMAL);

    await this.crudLayerService.deleteItem(
      ST_NAME_LAYER,
      name.properties.global_id
    );
  }

  async handleCreateBuffer(item: SettlementIssueItem) {
    // const name = item.settlementName!;
    // let actionId = uuidv4();
    // let bufferGeom: TurfFeature<TurfPolygon> = buffer(name, 100, {units: "meters"});
    //
    // const global_id = uuidv4();
    //
    // const geometry: MultiPolygon = {
    //   type: "MultiPolygon",
    //   coordinates: [bufferGeom.geometry.coordinates as Array<Array<Position>>]
    // };
    //
    // const bbox = turfBbox(geometry) as BBox2d;
    //
    // //create a new settlement part
    // const settlementPart: GeoJsonSettlementPart = {
    //   type: "Feature",
    //   properties: {
    //     ...DefaultGeoJSonSettlementPartProperties,
    //     global_id,
    //     "boundary_polygon": this.bvService.boundaryInfo.boundary.properties.global_id,
    //     "type": "gmt",
    //     "settlement_name": name.properties.name,
    //     original_guids: [global_id],
    //     bbox,
    //   },
    //   geometry
    // };
    //
    // name.properties.settlement_part = settlementPart.properties.global_id;
    //
    // //create first so raster service has it
    // await this.crudLayerService.createItem("settlement__part", settlementPart, false, false, actionId);
    //
    // await this.crudLayerService.updateItem("settlement__part", settlementPart, true, false, actionId);
    // await this.crudLayerService.updateItem(ST_NAME_LAYER, name, true, true, actionId);
    // this.refreshSettlementProblems(item); //to avoid #1398 > when clicking ' generate buffer...' ...
    //
    // await this.bvService.computeAllCatchmentAssignments([settlementPart], actionId);
  }

  private async assignGeospatialBoundaryForSt(
    item: SettlementIssueItem,
    boundary: GeoJsonBoundary
  ) {
    const geojson = cloneDeep(item.settlementName);
    geojson.properties.boundary_polygon = boundary.properties.global_id;

    await this.crudLayerService.updateItem(ST_NAME_LAYER, geojson);
    await this.actionAssignPrimaryNameBoundaryToSettlementPart(
      item.settlementName
    );
  }

  private async moveNameOnSurface(
    settlementName: GeoJsonSettlementName,
    settlementPart: GeoJsonSettlementPart
  ) {
    const geojson = cloneDeep(settlementName);
    let newGeom = pointOnFeature(settlementPart);

    geojson.geometry.coordinates = newGeom.geometry.coordinates as Position;
    geojson.properties.set_with_gps = false;

    await this.crudLayerService.updateItem('settlement__name', geojson);
  }

  private async actionAssignAndPromoteAlternateNameToSettlementPart(
    SettlementIssueItem: SettlementIssueItem,
    name: GeoJsonSettlementName
  ) {
    const geojson = cloneDeep(name);
    geojson.properties.settlement_part =
      SettlementIssueItem.settlementPart!.properties.global_id;
    geojson.properties.is_primary = true;

    await this.crudLayerService.updateItem(ST_NAME_LAYER, geojson);
  }

  private async actionAssignPrimaryNameToSettlementPart(
    SettlementIssueItem: SettlementIssueItem,
    name: GeoJsonSettlementName
  ) {
    const geojson = cloneDeep(name);
    geojson.properties.settlement_part =
      SettlementIssueItem.settlementPart!.properties.global_id;

    await this.crudLayerService.updateItem(ST_NAME_LAYER, geojson);

    await this.actionAssignPrimaryNameBoundaryToSettlementPart(name);
  }

  private async actionCreateGeneratedName(
    SettlementIssueItem: SettlementIssueItem
  ) {
    const centroid_part = pointOnFeature(SettlementIssueItem.settlementPart!);

    const geojson: GeoJsonSettlementName = {
      type: 'Feature',
      properties: {
        ...DefaultGeoJSonSettlementNameProperties,
        global_id: uuidv4(),
        boundary_polygon:
          SettlementIssueItem.settlementPart!.properties.boundary_polygon,
        name: generateSettlementName(
          SettlementIssueItem.settlementPart!.properties.type,
          centroid_part.geometry.coordinates[0],
          centroid_part.geometry.coordinates[1]
        ),
        settlement_part:
          SettlementIssueItem.settlementPart!.properties.global_id,
      },
      geometry: centroid_part.geometry as Point,
    };

    const actionId = uuidv4();
    await this.crudLayerService.createItem(
      ST_NAME_LAYER,
      geojson,
      true,
      true,
      actionId
    );

    await this.bvService.computeAllCatchmentAssignments(
      [SettlementIssueItem.settlementPart!],
      actionId,
      new Set()
    );
  }

  private async actionAssignPrimaryNameBoundaryToSettlementPart(
    settlementName: GeoJsonSettlementName
  ) {
    const part = this.bvService.data.spMap.get(
      settlementName.properties.settlement_part!
    );

    if (!part) {
      this.logger.info(
        `Settlement ${settlementName.properties.global_id} has no part`
      );
      return;
    }

    if (
      part.properties.boundary_polygon ==
      settlementName.properties.boundary_polygon
    ) {
      this.logger.info(
        `Settlement ${settlementName.properties.global_id}, part ${part.properties.global_id} already has the same boundary_polygon guid`
      );
      return;
    }

    const geojson = cloneDeep(part);
    geojson.properties.boundary_polygon =
      settlementName.properties.boundary_polygon;
    await this.crudLayerService.updateItem('settlement__part', geojson);
  }

  private setGeographyProblemsToSettlement(
    settlementIssueItem: SettlementIssueItem,
    settlementNameProblems: SettlementProblems
  ) {
    settlementIssueItem.problemsUI = [];
    settlementIssueItem.problems = settlementNameProblems;

    for (let i = 0; i < settlementNameProblems.problems.length; i++) {
      const type = settlementNameProblems.problems[i];
      const message = settlementNameProblems.messages[i];
      const resolutions: Resolution[] = [];
      const problemUi = {
        message,
        resolutions,
        type,
      };
      settlementIssueItem.problemsUI.push(problemUi);

      if (
        type === SettlementNameProblemTypes.MACHINE_GENERATED_NAME ||
        type === SettlementNameProblemTypes.EMPTY_NAME
      ) {
        resolutions.push({
          label: `Rename the settlement`,
          command: () => {},
        });
      }
    }
  }

  private refreshHfBaseProblems(healthFacilityItem: HealthFacilityItem) {
    healthFacilityItem.problemsUI = [];
    if (isNullOrWhitespace(healthFacilityItem.json.properties.name)) {
      healthFacilityItem.problemsUI.push({
        message: `Please enter the name for the Health Facility.`,
        type: HFProblemTypes.EMPTY_NAME,
        resolutions: [
          {
            label: `Rename the health facility`,
            command: (options) => {
              // options.disableRefreshProblems();
            },
          },
        ],
      });
    }
    if (
      !healthFacilityItem.json.properties.services ||
      healthFacilityItem.json.properties.services.length === 0
    ) {
      healthFacilityItem.problemsUI.push({
        message: `Please select at least one service for the Health Facility.`,
        type: HFProblemTypes.EMPTY_SERVICES,
        resolutions: [
          {
            label: `Please select at least one service for the Health Facility`,
            command: (options) => {},
          },
        ],
      });
    }
    if (
      !healthFacilityItem.json.properties.level_of_care ||
      healthFacilityItem.json.properties.level_of_care == null
    ) {
      healthFacilityItem.problemsUI.push({
        message: `Please select the type for the Health Facility.`,
        type: HFProblemTypes.EMPTY_TYPE,
        resolutions: [
          {
            label: `Please select the type for the Health Facility.`,
            command: (options) => {},
          },
        ],
      });
    }
    if (
      healthFacilityItem.json.properties.private !== true &&
      healthFacilityItem.json.properties.private !== false
    ) {
      healthFacilityItem.problemsUI.push({
        message: `Please select the ownership for the Health Facility.`,
        type: HFProblemTypes.EMPTY_OWNERSHIP,
        resolutions: [
          {
            label: `Please select the ownership for the Health Facility.`,
            command: (options) => {},
          },
        ],
      });
    }
  }
}

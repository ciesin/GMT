import { Component } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CrudLayerService } from '@services/vector_layer/crud-layer.service';
import { NGXLogger } from 'ngx-logger';
import { filter, map, Subject, switchMap, takeUntil } from 'rxjs';
import { RoutesChunks } from 'src/app/constants/routing.enum';
import { BoundaryVectorLayersService } from 'src/app/services/boundary-vector-layers.service';
import { FIXED_HEALTH_FACILITY_TYPE, OUTREACH_HEALTH_FACILITY_TYPE, PropertyValue } from 'src/app/utils/server-interfaces/GeoJson';
import { getSpComputedPop } from 'src/app/utils/server-interfaces/utils/indicator.util';
import { formatPopulation } from 'src/app/utils/string-formatting';

@Component({
    selector: 'gmt-pop',
    templateUrl: './pop.component.html',
    styleUrls: ['./pop.component.less'],
    standalone: false
})
export class PopComponent {

  private unsubscribe = new Subject();

  fixedPostPopulation: number = 0;
  fixedPostProportion: number = 0;
  outreachPopulation: number = 0;
  outreachProportion: number = 0;
  unclaimedPopulation: number = 0;
  unclaimedProportion: number = 0;

  totalBoundaryPop: number = 0;

  constructor(
    public bvService: BoundaryVectorLayersService,
    private activatedRoute: ActivatedRoute,
    private crudLayerService: CrudLayerService,
    private logger: NGXLogger,
    ) { }

  ngOnInit() {

    this.activatedRoute.params.pipe(
      map(params => params[RoutesChunks.PARAM_BOUNDARY.replace(':', '')]),
      switchMap(boundaryId => {
        console.log("Microplan HF List Boundary id", boundaryId);
        return this.bvService.ensureBoundaryLoaded(boundaryId);
      }),
      switchMap(_ok => {
        return this.crudLayerService.suppressUserInterfaceUpdates.asObservable();
      }),
      filter(suppressUi => !suppressUi),
      takeUntil(this.unsubscribe),
    ).subscribe(() => {
      this.computeAdminPopulation();
    })
  }

  ngOnDestroy() {

    this.unsubscribe.next(undefined);
    this.unsubscribe.complete();
  }

  public formatPopulation(pop: PropertyValue) {
    return formatPopulation(pop);
  }

  computeAdminPopulation() {

    this.fixedPostProportion = 0;
    this.outreachProportion = 0;
    this.unclaimedProportion = 0;
    this.fixedPostPopulation = 0;
    this.outreachPopulation = 0;
    this.unclaimedPopulation = 0;

    const settlementList = this.bvService.data.getBoundaryPrimaryNameSettlementList();
    for (const settlementName of settlementList) {

      const settlementPart = this.bvService.data.spMap.get(settlementName.properties.settlement_part!);
      if (!settlementPart) {
        continue;
      }

      const settlementPopulation = getSpComputedPop(settlementPart);
      const catchments = this.bvService.data.getCatchmentForSp(settlementPart.properties.global_id, true, true);

      let populationClaimedForOneSettlement = 0;
      for (const catchment of catchments) {
        const healthFacility = this.bvService.data.hfMap.get(catchment.properties.health_facility_point);
        if (!healthFacility) {
          return;
        }
        let settlementPop = catchment.properties.population_perc * settlementPopulation / 100;

        if (healthFacility.properties.type === FIXED_HEALTH_FACILITY_TYPE) {
          this.fixedPostPopulation += settlementPop;
          populationClaimedForOneSettlement += settlementPop;
        } else if (healthFacility.properties.type === OUTREACH_HEALTH_FACILITY_TYPE) {
          this.outreachPopulation += settlementPop;
          populationClaimedForOneSettlement += settlementPop;
        }
      }
      this.unclaimedPopulation += (settlementPopulation - populationClaimedForOneSettlement);
    }

    this.totalBoundaryPop  = this.fixedPostPopulation + this.outreachPopulation + this.unclaimedPopulation;
    this.fixedPostProportion = 100.0 * this.fixedPostPopulation / this.totalBoundaryPop;
    this.outreachProportion = 100.0 * this.outreachPopulation / this.totalBoundaryPop;
    this.unclaimedProportion = 100.0 * this.unclaimedPopulation / this.totalBoundaryPop;
  }

}

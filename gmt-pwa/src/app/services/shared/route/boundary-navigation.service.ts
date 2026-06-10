import { Injectable } from '@angular/core';
import { BoundaryFocusService } from '@services/map/DashboardBoundaryService';
import { BoundaryLayerService } from '@services/vector_layer/boundary-layer.service';
import cloneDeep from 'lodash/cloneDeep';
import { AppConfigService } from 'src/app/utils/app-config.service';
import { GeoJsonBoundaryWithIndicators } from 'src/app/utils/server-interfaces/GeoJson';
import {
  HierarchyListEntryBoundary,
  HierarchyListEntryHF,
} from 'src/app/utils/server-interfaces/HierarchyList';

@Injectable({
  providedIn: 'root',
})
export class BoundaryNavigationService {
  public currentLevel: number = 0;
  public hierarchy: string[] = [];
  public boundariesList: GeoJsonBoundaryWithIndicators[];

  constructor(
    private boundaryLayerService: BoundaryLayerService,
    private boundaryFocusService: BoundaryFocusService
  ) {}

  private async getAllParentBoundaryIds(
    boundaryId: string,
    boundaryIds: GeoJsonBoundaryWithIndicators[]
  ) {
    if (!boundaryId) {
      return boundaryIds;
    }
    const boundaryMatch = await this.boundaryLayerService.fetchBoundaryById(
      boundaryId
    );
    if (!boundaryMatch) {
      return boundaryIds;
    }
    boundaryIds.push(boundaryMatch);
    if (boundaryMatch.properties.level == 0) {
      return boundaryIds;
    }
    return this.getAllParentBoundaryIds(
      boundaryMatch.properties.boundary_polygon,
      boundaryIds
    );
  }

  /*
  This is the guid in the url
  */
  public async loadSelectedBoundary(
    boundaryId: string
  ): Promise<(HierarchyListEntryBoundary | HierarchyListEntryHF)[]> {
    this.boundariesList = [];
    if (boundaryId) {
      this.boundariesList = await this.getAllParentBoundaryIds(
        boundaryId,
        this.boundariesList
      );
    }
    this.boundariesList.reverse();
    this.hierarchy = [];
    const fullHierarchyList =
      await this.boundaryLayerService.fetchHierarchyList();
    let targetHierarchyList = fullHierarchyList.list[0].children;
    if (this.boundariesList.length > 1) {
      //We have a parent
      let boundariesList = cloneDeep(this.boundariesList);
      const lastLevel = boundariesList[boundariesList.length - 1];
      this.currentLevel = lastLevel.properties.level;
      targetHierarchyList = this.updateBoundaryHierarchyData(
        cloneDeep(boundariesList.slice(1)),
        targetHierarchyList
      );
    } else if (this.boundariesList.length == 1) {
      //country is selected, this code could do something different than else
      //case if we have more than one country level (multiple boundaries @ level 0)
      this.boundaryFocusService.setFocus({
        name: this.boundariesList[0].properties.name,
        parentBoundaryId: null,
        level: 0,
        boundaryId: this.boundariesList[0].properties.global_id,
      });
      this.currentLevel = 0;
    } else {
      //This shoudn't happen, but we default to 1st entriy in fullHierarchyList which is the countyr one
      this.boundaryFocusService.setFocus({
        name: fullHierarchyList.list[0].name,
        parentBoundaryId: null,
        level: 0,
        boundaryId: fullHierarchyList.list[0].global_id,
      });
      this.currentLevel = 0;
    }

    return targetHierarchyList;
  }

  private updateBoundaryHierarchyData(
    boundariesList: GeoJsonBoundaryWithIndicators[],
    targetHierarchyList: (HierarchyListEntryBoundary | HierarchyListEntryHF)[]
  ) {
    const found = targetHierarchyList.find((b) => {
      return b.global_id == boundariesList[0].properties.global_id;
    });
    if (found) {
      targetHierarchyList = (found as HierarchyListEntryBoundary).children;
      this.hierarchy.push(boundariesList[0].properties.name);
      boundariesList.shift();
      // skip last operational level
      if (
        (this.currentLevel ==
          AppConfigService.conf.generic.operational_boundary_level &&
          boundariesList.length > 1) ||
        (this.currentLevel <
          AppConfigService.conf.generic.operational_boundary_level &&
          boundariesList.length > 0)
      ) {
        return this.updateBoundaryHierarchyData(
          boundariesList,
          targetHierarchyList
        );
      }
    }
    return targetHierarchyList;
  }
}

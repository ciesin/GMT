import _ from 'lodash';
import { buildMap } from 'src/app/utils/container';
import {
  GeoJsonBase,
  GeoJsonBoundary,
  GeoJsonBoundaryEdited,
  GeoJsonCatchmentItem,
  GeoJsonHealthFacility,
  GeoJsonSettlementName,
  GeoJsonSettlementPart,
  HealthFacilityCatchmentStatus,
} from 'src/app/utils/server-interfaces/GeoJson';
import { isEmpty } from 'src/app/utils/server-interfaces/utils/geom.util';

export interface BoundaryDataClassInterface {
  //Note the class version sets defaults for all these
  hfList: Array<GeoJsonHealthFacility>;
  ciList: Array<GeoJsonCatchmentItem>;
  snList: Array<GeoJsonSettlementName>;
  spList: Array<GeoJsonSettlementPart>;
  bList: Array<GeoJsonBoundary>;

  snMap: Map<string, GeoJsonSettlementName>;
  spMap: Map<string, GeoJsonSettlementPart>;
  hfMap: Map<string, GeoJsonHealthFacility>;
  bMap: Map<string, GeoJsonBoundary>;

  spToSnMap: Map<string, Array<GeoJsonSettlementName>>;

  boundaryId: string;
}

/**
 * Get data formed specifically for certain boundary
 */
export class BoundaryDataClass implements BoundaryDataClassInterface {
  //provide defaults in case we have no boundary data

  // All lists are for the surrounding boundaries included
  hfList: Array<GeoJsonHealthFacility> = [];
  ciList: Array<GeoJsonCatchmentItem> = [];
  snList: Array<GeoJsonSettlementName> = [];
  spList: Array<GeoJsonSettlementPart> = [];
  bList: Array<GeoJsonBoundary> = [];
  bEditedList: Array<GeoJsonBoundaryEdited> = [];
  pointList: Array<GeoJsonBase> = [];

  // Same thing but for key lookup on global_id
  snMap: Map<string, GeoJsonSettlementName> = new Map();
  spMap: Map<string, GeoJsonSettlementPart> = new Map();
  hfMap: Map<string, GeoJsonHealthFacility> = new Map();
  bMap: Map<string, GeoJsonBoundary> = new Map();

  //Settlement part associated with a list of names, this is done by attribute settlement.name.settlement_part
  spToSnMap: Map<string, Array<GeoJsonSettlementName>> = new Map();

  hfToCiMap: Map<string, Array<GeoJsonCatchmentItem>> = new Map();
  spToCiMap: Map<string, Array<GeoJsonCatchmentItem>> = new Map();

  //Contains mapping from fixed post health facility global id to it's child outreach facilities
  hfChildMap: Map<string, Array<GeoJsonHealthFacility>> = new Map();

  boundaryId: string = '';

  // constructor(data: Partial<BoundaryDataListsOnlyInterface> = {}) {
  //   Object.assign(this, data);
  // }
  constructor() {}

  toPlainObj(): BoundaryDataClassInterface {
    return Object.assign({}, this);
  }

  static fromPlainObject(data: BoundaryDataClassInterface): BoundaryDataClass {
    const newClass = new BoundaryDataClass();
    Object.assign(newClass, data);
    return newClass;
  }

  setBoundaries(pBList: Array<GeoJsonBoundary>): BoundaryDataClass {
    this.bList = pBList;
    this.bMap = buildMap(this.bList);
    return this;
  }
  setEditedBoundaries(pBList: Array<GeoJsonBoundaryEdited>): void {
    this.bEditedList = pBList;
  }
  setHfs(pHFList: Array<GeoJsonHealthFacility>): BoundaryDataClass {
    this.hfList = pHFList;
    this.hfMap = buildMap(this.hfList);

    this.hfChildMap = new Map<string, Array<GeoJsonHealthFacility>>();

    for (const hfChild of this.getHfChildren()) {
      if (!this.hfChildMap.has(hfChild.properties.parent!)) {
        this.hfChildMap.set(hfChild.properties.parent!, []);
      }

      this.hfChildMap.get(hfChild.properties.parent!)!.push(hfChild);
    }

    return this;
  }

  /**
   * Returns valid fixed post hfs for current boundary
   */
  getHfFixedPost(): Array<GeoJsonHealthFacility> {
    return this.hfList.filter(
      (hf) =>
        hf.properties.type == 'fixed_post' &&
        hf.properties.boundary_polygon == this.boundaryId &&
        !isEmpty(hf)
    );
  }

  getHfChildren(): Array<GeoJsonHealthFacility> {
    return this.hfList.filter(
      (hf) =>
        hf.properties.type != 'fixed_post' &&
        this.hfMap.has(hf.properties.parent || '')
    );
  }

  setSns(pSNList: Array<GeoJsonSettlementName>): BoundaryDataClass {
    this.snList = pSNList;
    this.snMap = buildMap(this.snList);

    //Also build the settlement part => settlement name map; doing this after both names and parts have been saved
    this.spToSnMap = new Map<string, Array<GeoJsonSettlementName>>();

    for (const sn of this.snList) {
      const spId = sn.properties.settlement_part;
      if (!_.isString(spId)) {
        continue;
      }

      if (!this.spToSnMap.has(spId)) {
        //initialize
        this.spToSnMap.set(spId, [sn]);
      } else {
        this.spToSnMap.get(spId)!.push(sn);
      }
    }
    return this;
  }

  setSps(pSPList: Array<GeoJsonSettlementPart>): BoundaryDataClass {
    this.spList = pSPList;
    this.spMap = buildMap(this.spList);

    return this;
  }

  setPoints(pPointList: Array<GeoJsonBase>): BoundaryDataClass {
    this.pointList = pPointList;

    return this;
  }

  setCis(pCIList: Array<GeoJsonCatchmentItem>): BoundaryDataClass {
    this.ciList = pCIList;

    this.setCiMaps();

    return this;
  }

  private setCiMaps() {
    if (!this.ciList) {
      return;
    }

    this.spToCiMap = new Map<string, Array<GeoJsonCatchmentItem>>();
    this.hfToCiMap = new Map<string, Array<GeoJsonCatchmentItem>>();

    for (const ci of this.ciList) {
      //These should always have a value
      const spId = ci.properties.settlement_part;
      const hfId = ci.properties.health_facility_point;

      if (!this.spToCiMap.has(spId)) {
        this.spToCiMap.set(spId, []);
      }

      if (!this.hfToCiMap.has(hfId)) {
        this.hfToCiMap.set(hfId, []);
      }

      this.spToCiMap.get(spId)!.push(ci);
      this.hfToCiMap.get(hfId)!.push(ci);
    }
  }

  /**
   * The main list of settlements, as seen in the settlement list
   * or the excel export.
   *
   * Note includes uninhabited ones
   */
  public getBoundaryPrimaryNameSettlementList(): Array<GeoJsonSettlementName> {
    return (
      this.snList
        .filter((sn) => this.boundaryId == sn.properties.boundary_polygon)
        //Merged settlements can generate non primary names, so we need this filter
        .filter((sn) => sn.properties.is_primary)
        .filter((sn) => !isEmpty(sn))
        //must have a valid settlement part
        .filter((sn) => this.spMap.has(sn.properties.settlement_part!))
    );
  }

  public getBoundaryPrimaryNameSettlementListForAllBoundaries(): Array<GeoJsonSettlementName> {
    return (
      this.snList
        //Merged settlements can generate non primary names, so we need this filter
        .filter((sn) => sn.properties.is_primary)
        .filter((sn) => !isEmpty(sn))
        //must have a valid settlement part
        .filter((sn) => this.spMap.has(sn.properties.settlement_part!))
    );
  }

  public getPrimaryNamesForSettlementPart(
    partId: string,
    filterOutUninhabited = true
  ): Array<GeoJsonSettlementName> {
    const snList = this.spToSnMap.get(partId);
    if (!snList) {
      return [];
    }

    return snList.filter((sn) => {
      if (!sn.properties.is_primary) {
        return false;
      }

      if (filterOutUninhabited && sn.properties.uninhabited) {
        return false;
      }

      return true;
    });
  }

  /**
   * Returns catchment items of all the health facilities within the boundary
   *
   * Note this can point to settlement parts outside the current boundary
   * @param filterInvalid
   * @param filterExcluded
   */
  public getCatchmentForTheBoundary(
    filterInvalid: boolean,
    filterExcluded: boolean
  ): Array<GeoJsonCatchmentItem> {
    const ret = this.ciList.filter((ci) => {
      const hfGuid = ci.properties.health_facility_point as string;
      const hf = this.hfMap.get(hfGuid);

      if (!hf) {
        return false;
      }

      return hf.properties.boundary_polygon == this.boundaryId;
    });

    return this.filterCatchments(ret, filterInvalid, filterExcluded);
  }

  private filterCatchments(
    ciList: Array<GeoJsonCatchmentItem>,
    filterInvalid: boolean,
    onlyGenerated: boolean
  ): Array<GeoJsonCatchmentItem> {
    if (filterInvalid) {
      ciList = this.filterValidCis(ciList);
    }

    if (onlyGenerated) {
      ciList = ciList.filter((ci) => ci.properties.type == 'generated');
    }

    return ciList;
  }
  /**
   *
   * @param spId
   * @param filterInvalid if true, will make sure the ci items have valid hfs and settlement parts
   * @param onlyGenerated if true, will not include the exclude=true nor include=true, which are the ci items which indicate a settlement part<=>hf should
   * not be used in the catchment calculations, or only explicit included hfs will equally split a settlement part
   */
  public getCatchmentForSp(
    spId: string | null,
    filterInvalid: boolean,
    onlyGenerated: boolean
  ): Array<GeoJsonCatchmentItem> {
    if (!spId) {
      return [];
    }

    return this.filterCatchments(
      this.spToCiMap.get(spId) || [],
      filterInvalid,
      onlyGenerated
    );
  }

  public getCatchmentStatus(
    hf: GeoJsonHealthFacility
  ): HealthFacilityCatchmentStatus {
    let catchment_status = hf.properties.mp_status;

    //Outreach status is the same as its fixed post parent
    if (hf.properties.type == 'outreach') {
      const parentId = hf.properties.parent;
      const parent = this.hfMap.get(parentId!);

      if (parent) {
        return parent.properties.mp_status;
      }
    }

    return catchment_status;
  }

  /**
   *
   * @param hfId health facility global id
   * @param filterInvalid
   * @param onlyGenerated if true, exclude/include entries are not returned
   * @returns
   */
  public getCatchmentForHf(
    hfId: string,
    filterInvalid: boolean,
    onlyGenerated: boolean
  ): Array<GeoJsonCatchmentItem> {
    if (!hfId) {
      return [];
    }

    return this.filterCatchments(
      this.hfToCiMap.get(hfId) || [],
      filterInvalid,
      onlyGenerated
    );
  }

  /*
  Fetches all catchment items for fixed post and its children

  Passed in hfId can be a child or the fixed post
  */
  public getIncludeExcludesForAllFp(hfId: string): Array<GeoJsonCatchmentItem> {
    const hf = this.hfMap.get(hfId);

    if (_.isNil(hf)) {
      console.error(`Hf is nil for [${hfId}]`);
      return [];
    }

    let fp = hf;

    if (hf.properties.type != 'fixed_post') {
      if (_.isNil(hf.properties.parent)) {
        console.error(`Hf parent is nil for [${hf.properties.global_id}]`);
        return [];
      }
      const parent = this.hfMap.get(hf.properties.parent);

      if (_.isNil(parent)) {
        console.error(`parent is nil for [${hf.properties.parent}]`);
        return [];
      }

      fp = parent;
    }

    const ret: Array<GeoJsonCatchmentItem> = [];

    const hfs: Array<GeoJsonHealthFacility> = [fp];

    for (const child of this.hfChildMap.get(fp.properties.global_id) || []) {
      hfs.push(child);
    }

    for (const hfItem of hfs) {
      const ciList = this.hfToCiMap.get(hfItem.properties.global_id) || [];
      for (const ci of ciList) {
        if (
          ci.properties.type == 'include' ||
          ci.properties.type == 'exclude'
        ) {
          ret.push(ci);
        }
      }
    }

    return ret;
  }

  private filterValidCis(
    pCiList: Array<GeoJsonCatchmentItem>
  ): Array<GeoJsonCatchmentItem> {
    return pCiList.filter((ci) => {
      const hf = this.hfMap.get(ci.properties.health_facility_point);

      if (!hf) {
        return false;
      }

      const sp = this.spMap.get(ci.properties.settlement_part);

      if (!sp) {
        console.error(
          `Cannot find sp ${ci.properties.settlement_part} for ci ${ci.properties.global_id}`
        );
        return false;
      }

      const spList = this.getPrimaryNamesForSettlementPart(
        sp.properties.global_id,
        true
      );

      if (spList.length == 0) {
        return false;
      }

      return true;
    });
  }

  public getHfsPerformingRI(inWardOnly = true): Array<GeoJsonHealthFacility> {
    return this.hfList.filter((h) => {
      if (inWardOnly && h.properties.boundary_polygon != this.boundaryId) {
        return false;
      }
      return (
        h.properties.services.includes('Routine Immunization') &&
        !isEmpty(h.geometry)
      );
    });
  }

  public getCurrentBoundary(): GeoJsonBoundary {
    return this.bMap.get(this.boundaryId)!;
  }

  /**
   * Returns state/lga/ward in nigeria
   * @param boundaryId
   */
  public getBoundaryLabels(boundaryId: string): Array<string> {
    const labels: Array<string> = [];
    let boundary: GeoJsonBoundary | null = null;
    while (true) {
      boundary = this.bMap.get(boundaryId)!;
      if (!boundary || boundary.properties.level == 0) {
        break;
      }

      labels.push(boundary.properties.name);

      boundaryId = boundary.properties.boundary_polygon;
    }

    labels.reverse();

    return labels;
  }
}

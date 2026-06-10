import {
  Component,
  Input,
  OnChanges,
  OnInit,
  SimpleChanges,
} from '@angular/core';
import {
  faHouseMedical,
  faHouseMedicalFlag,
  faPersonCircleExclamation,
  faUsers,
} from '@fortawesome/free-solid-svg-icons';
import _ from 'lodash';
import { NGXLogger } from 'ngx-logger';
import { PropertyValue } from 'src/app/utils/server-interfaces/GeoJson';
import { formatPercentage } from 'src/app/utils/string-formatting';

/*
Fix attempt for 
https://github.com/novelt/GMT/issues/2776
https://github.com/novelt/GMT/issues/3014

Theory is it could be a rounding error
*/
const FULL_PERC = 100.0;
const EPS = 1e-6;

@Component({
  selector: 'gmt-catchment',
  templateUrl: './catchment.component.html',
  styleUrls: ['./catchment.component.less'],
  standalone: false
})
export class CatchmentComponent implements OnInit, OnChanges {
  @Input() mode = 'detailed';
  @Input() type: 'hf' | 'settlement' | 'boundary';

  /*
    These can either be population numbers or percentages
    In the case of percentages, total would be 100
  
    The reason is to have a consistent inputs so we can
    always recaluclate % on changes
    */
  @Input() fixedPost: number = 0;
  @Input() outreach: number = 0;
  @Input() unclaimed: number = 0;
  //See comment below regarding settlementProblems
  @Input() problematic: number = 0;
  @Input() total: number = 100;

  fixedPostPercent: number;
  outreachPercent: number;
  unclaimedPercent: number;
  problematicPercent: number;

  @Input() settlementCountFixedPost: number;
  @Input() settlementCountOutreach: number;
  @Input() settlementCountProblematic: number;

  //This matches problematic in the settlement name json, but we are using problematic here to mean % or pop of problematic settlements
  @Input() settlementProblems: Array<string> = [];

  fixedPostIcon = faHouseMedical;
  outreachIcon = faHouseMedicalFlag;
  settlementIcon = faUsers;
  hardToReachIcon = faPersonCircleExclamation;

  constructor(private logger: NGXLogger) {}

  ngOnInit(): void {
    if (!this.total) {
      this.logger.error(
        `"total" input is required on component CatchmentComponent: ${this.total}`
      );
      this.total = 1;
    }

    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Nullish_coalescing_assignment
    // Assigns if these are null/undefined
    // console.log(this.fixedPost * 100 / this.total,this.fixedPost,this.total,'this.fixedPost * 100 / this.total');

    //this.logger.info(`EEE ${this.fixedPostPercent} ${this.outreachPercent} ${this.unclaimedPercent} ${this.total}` );

    this.updatePercentages();
  }

  private updatePercentages() {
    /*
    A second layer, ensure that these % sum cannot be more than 
    
    https://github.com/novelt/GMT/issues/2776
    https://github.com/novelt/GMT/issues/3014

    This issue is hard to reproduce; theory is that sometimes the % are more than
    100; causing the overlap
    */
    const rawFixedPostPercent = getClampedPercent(
      (this.fixedPost * 100) / this.total
    );
    const rawOutreachPercent = getClampedPercent(
      (this.outreach * 100) / this.total
    );
    const rawUnclaimedPercent = getClampedPercent(
      (this.unclaimed * 100) / this.total
    );

    //Just in case this.total was off a bit
    const totalRaw =
      rawFixedPostPercent + rawOutreachPercent + rawUnclaimedPercent;
    this.fixedPostPercent = getClampedPercent(
      (rawFixedPostPercent * FULL_PERC) / totalRaw - EPS
    );
    this.outreachPercent = getClampedPercent(
      (rawOutreachPercent * FULL_PERC) / totalRaw - EPS
    );
    this.unclaimedPercent = getClampedPercent(
      (rawUnclaimedPercent * FULL_PERC) / totalRaw - EPS
    );

    //Note this only applies for settlements since problematic is only passed in for them
    //Boundaries and HF will pass in problematicPercent directly
    if (
      Array.isArray(this.settlementProblems) &&
      this.settlementProblems.length > 0
    ) {
      this.problematicPercent = FULL_PERC;
    } else {
      this.problematicPercent = (this.problematic * FULL_PERC) / this.total;
    }
  }

  ngOnChanges(changes: SimpleChanges) {
    this.updatePercentages();
  }
  public formatPercentage(pop: PropertyValue) {
    return formatPercentage(pop, true);
  }
  getProblemStr(): string {
    if (
      !_.isArray(this.settlementProblems) ||
      this.settlementProblems.length <= 0
    ) {
      return 'None';
    }

    return this.settlementProblems.join(', ');
  }
}

//returns 0 to 100
function getClampedPercent(n: number): number {
  if (!_.isNumber(n)) {
    return 0;
  }
  if (!_.isFinite(n)) {
    return 0;
  }
  if (n <= 0) {
    return 0;
  }
  if (n >= 100) {
    return 100;
  }
  return n;
}

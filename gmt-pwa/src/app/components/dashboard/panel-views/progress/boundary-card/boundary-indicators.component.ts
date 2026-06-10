import { Component, Input, OnInit } from '@angular/core';
import { Color, ScaleType } from '@swimlane/ngx-charts';
import { GeoJsonBoundaryWithIndicators } from 'src/app/utils/server-interfaces/GeoJson';
import { getNumberSafe } from 'src/app/utils/server-interfaces/utils/indicator.util';
import {
  coverageLabel,
  dataQualityLabel,
  mpProgressLabel,
  policyLabel,
  qualityIndexHigh,
  qualityIndexLow,
  qualityIndexLowMedium,
  qualityIndexMedium,
} from '../../../../../constants/indicators.constants';
import { AppConfigService } from '../../../../../utils/app-config.service';
import { formatPopulation } from '../../../../../utils/string-formatting';

const LEVEL_OF_CARE_NAME_MAPPING: string[] = [
  'Unknown',
  'Primary',
  'Secondary',
  'Tertiary',
  'Dispensiary',
  'Other',
];
const COLORS = {
  MP_STATUS_COMPLETE: '#0B4171',
  MP_STATUS_PROGRESS: '#1561A4',
  MP_STATUS_NOT_STARTED: '#6AABE4',
  LEVEL_CARE_UNKNOWN: '#cccccc',
  LEVEL_CARE_PRIMARY: '#7FCCB1',
  LEVEL_CARE_SECONDARY: '#68A1E1',
  LEVEL_CARE_TERTIARY: '#8785E2',
  LEVEL_CARE_OTHER: '#D6965A',
  LEVEL_CARE_DISPENSARY: '#EDC25F',
  ORG_PUBLIC: '#1561A4',
  ORG_PRIVATE: '#6AABE4',
  RI_PERFORM: '#1561A4',
  RI_NO: '#6AABE4',
  CATCHMENT_FP: '#2081D6',
  CATCHMENT_OUTREACH: '#80C610',
  CATCHMENT_UNCLAIMED: '#865DA8',
  STL_PROBLEMATIC: '#C44C1C',
  STL_UNINHABITED: '#8C8C8C',
  STL_OTHER: '#FFF3E5',
  SPECIAL_ATTENTION: 'rgb(196, 76, 28)',
  MISSING_BASE_DATA: 'rgb(104, 161, 225)',
  BOUNDARY_CORRECTIONS: 'rgb(237, 194, 95)',
  POPULATION_DISCREPANCIES: 'rgb(135, 133, 226)',
};

interface ChartJSSerie {
  name: string;
  value: number;
}

class ChartJSData {
  series: ChartJSSerie[];
  color: Color;

  constructor(series: ChartJSSerie[] = [], colors: string[] = []) {
    this.series = series;
    this.color = {
      name: 'myScheme',
      selectable: true,
      group: ScaleType.Ordinal,
      domain: colors,
    };
  }
}

@Component({
  selector: 'gmt-boundary-indicators',
  templateUrl: './boundary-indicators.component.html',
  styleUrls: ['./boundary-indicators.component.less'],
  standalone: false
})
export class BoundaryIndicatorsComponent implements OnInit {
  @Input() boundaryItem: Required<GeoJsonBoundaryWithIndicators>;

  levelCareData: ChartJSData = new ChartJSData(
    [],
    [
      COLORS.LEVEL_CARE_UNKNOWN,
      COLORS.LEVEL_CARE_PRIMARY,
      COLORS.LEVEL_CARE_SECONDARY,
      COLORS.LEVEL_CARE_TERTIARY,
      COLORS.LEVEL_CARE_OTHER,
      COLORS.LEVEL_CARE_DISPENSARY,
    ]
  );

  organizationData: ChartJSData = new ChartJSData(
    [],
    [COLORS.ORG_PUBLIC, COLORS.ORG_PRIVATE]
  );

  riData: ChartJSData = new ChartJSData([], [COLORS.RI_PERFORM, COLORS.RI_NO]);

  catchmentData: ChartJSData = new ChartJSData(
    [],
    [COLORS.CATCHMENT_FP, COLORS.CATCHMENT_OUTREACH, COLORS.CATCHMENT_UNCLAIMED]
  );
  stlPropertiesData: ChartJSData = new ChartJSData(
    [],
    [COLORS.STL_PROBLEMATIC, COLORS.STL_UNINHABITED, COLORS.STL_OTHER]
  );

  mpStatusData: ChartJSData = new ChartJSData(
    [],
    [
      COLORS.MP_STATUS_COMPLETE,
      COLORS.MP_STATUS_PROGRESS,
      COLORS.MP_STATUS_NOT_STARTED,
    ]
  );
  issuesData: ChartJSData = new ChartJSData(
    [],
    [
      COLORS.SPECIAL_ATTENTION,
      COLORS.MISSING_BASE_DATA,
      COLORS.BOUNDARY_CORRECTIONS,
      COLORS.POPULATION_DISCREPANCIES,
    ]
  );

  quality: number = 0;
  coverage: number = 0;
  readonly mpProgressLabel = mpProgressLabel;
  readonly policyLabel = policyLabel;
  readonly coverageLabel = coverageLabel;
  readonly dataQualityLabel = dataQualityLabel;

  get targetPop() {
    return (
      getNumberSafe(this.boundaryItem.properties.boundary_pop) *
      AppConfigService.conf.catchment.target_population_perc
    );
  }

  constructor() {}

  ngOnInit(): void {
    this.levelCareData.series = !this.boundaryItem.properties
      .num_fp_level_of_care
      ? []
      : this.boundaryItem.properties.num_fp_level_of_care.map((val, index) => {
          return {
            name: LEVEL_OF_CARE_NAME_MAPPING[index],
            value: val,
          };
        });

    this.riData.series = [
      {
        name: 'Performs RI',
        value: getNumberSafe(this.boundaryItem.properties.num_fp_ri),
      },
      {
        name: 'Non-RI',
        value:
          getNumberSafe(this.boundaryItem.properties.num_fp) -
          getNumberSafe(this.boundaryItem.properties.num_fp_ri),
      },
    ];

    this.catchmentData.series = [
      {
        name: 'Fixed',
        value: getNumberSafe(this.boundaryItem.properties.catchment_pop_fp),
      },
      {
        name: 'Outreach',
        value: getNumberSafe(
          this.boundaryItem.properties.catchment_pop_outreach
        ),
      },
      {
        name: 'Unclaimed',
        value: getNumberSafe(
          this.boundaryItem.properties.catchment_pop_unclaimed
        ),
      },
    ];

    this.organizationData.series = [
      {
        name: 'Public',
        value: getNumberSafe(this.boundaryItem.properties.num_fp_public),
      },
      {
        name: 'Private',
        value: getNumberSafe(this.boundaryItem.properties.num_fp_private),
      },
    ];

    const num_set_uninhabited_total =
      this.boundaryItem.properties.num_set_uninhabited!.reduce(
        (partialSum, a) => partialSum + a,
        0
      );

    this.stlPropertiesData.series = [
      {
        name: 'Special Attention',
        value: getNumberSafe(this.boundaryItem.properties.num_set_prob),
      },
      {
        name: 'Uninhabited',
        value: num_set_uninhabited_total | 0,
      },
      {
        name: '',
        value:
          getNumberSafe(this.boundaryItem.properties.num_set_total) -
          getNumberSafe(this.boundaryItem.properties.num_set_prob) -
          num_set_uninhabited_total,
      },
    ];

    this.mpStatusData.series = [
      {
        name: 'Complete',
        value: this.boundaryItem.properties.num_fp_mp_status[3],
      },
      {
        name: 'In Progress',
        value: this.boundaryItem.properties.num_fp_mp_status[2],
      },
      {
        name: 'Not started',
        value: this.boundaryItem.properties.num_fp_mp_status[1],
      },
    ];
    this.calculateDataQualityIndicator();
    // this.quality = (this.boundaryItem.properties.num_set_total && this.boundaryItem.properties.num_set_total > 0) ? (this.boundaryItem.properties.num_set_mgn / this.boundaryItem.properties.num_set_total) : 0;

    const catchmentPopFp = getNumberSafe(
      this.boundaryItem.properties.catchment_pop_fp
    );
    const catchmentPopOutreach = getNumberSafe(
      this.boundaryItem.properties.catchment_pop_outreach
    );
    const catchmentPopUnclaimed = getNumberSafe(
      this.boundaryItem.properties.catchment_pop_unclaimed
    );
    const totalCoveragePop =
      catchmentPopFp + catchmentPopOutreach + catchmentPopUnclaimed;
    let percentageCovered = -1;
    if (totalCoveragePop) {
      percentageCovered =
        (catchmentPopFp + catchmentPopOutreach) / totalCoveragePop;
    }
    this.coverage = percentageCovered > 0 ? percentageCovered : 0;

    this.issuesData.series = [
      {
        name: 'SPECIAL ATTENTION', //(this.getAttentionCount()) ? this.getAttentionCount().toString() : "",
        value: getNumberSafe(this.getAttentionCount()),
      },
      {
        name: 'MISSING BASE DATA', //(this.getMissingBaseDataCount()) ? this.getMissingBaseDataCount().toString() : "",
        value: getNumberSafe(this.getMissingBaseDataCount()),
      },
      {
        name: 'BOUNDARY CORRECTIONS', //(this.getBoundaryCorrectionsCount()) ? this.getBoundaryCorrectionsCount().toString() : "",
        value: getNumberSafe(this.getBoundaryCorrectionsCount()),
      },
      {
        name: 'POPULATION DISCREPANCIES', //(this.getPopulationIssuesCount()) ? this.getPopulationIssuesCount().toString() : "",
        value: getNumberSafe(this.getPopulationIssuesCount()),
      },
    ];
  }

  calculateDataQualityIndicator() {
    if (
      this.boundaryItem.properties.level ==
      AppConfigService.conf.generic.operational_boundary_level
    ) {
      const totalStCount = this.boundaryItem.properties.num_set_total;
      const stWithGeneratedNames = getNumberSafe(
        this.boundaryItem.properties.num_set_mgn
      );
      if (!totalStCount) {
        return;
      }
      this.quality = (totalStCount - stWithGeneratedNames) / totalStCount;
    } else {
      const dataQualityNumbers =
        this.boundaryItem.properties.boundary_data_quality;
      if (!dataQualityNumbers) {
        return;
      }
      const maxQualityLevel = dataQualityNumbers.reduce(
        (a, b) => Math.max(a, b),
        0
      );
      if (maxQualityLevel == 0) {
        return;
      }
      if (maxQualityLevel == dataQualityNumbers[qualityIndexLow]) {
        this.quality = 0.1;
      } else if (maxQualityLevel == dataQualityNumbers[qualityIndexLowMedium]) {
        this.quality = 0.3;
      } else if (maxQualityLevel == dataQualityNumbers[qualityIndexMedium]) {
        this.quality = 0.6;
      } else if (maxQualityLevel == dataQualityNumbers[qualityIndexHigh]) {
        this.quality = 0.9;
      }
    }
  }

  private getAttentionCount(): number {
    return this.boundaryItem.properties.num_set_prob || 0;
  }

  private getMissingBaseDataCount() {
    //For now this only includes the # of settlements with a machine generated name
    return this.boundaryItem.properties.num_set_mgn;
  }

  private getBoundaryCorrectionsCount() {
    return this.boundaryItem.properties.num_boundary_corrections;
  }

  private getPopulationIssuesCount() {
    return this.boundaryItem.properties.num_set_pop_diff;
  }

  hasData(chartSerie: ChartJSSerie[]): boolean {
    return (
      chartSerie.reduce(
        (total, currentValue): number => total + currentValue.value,
        0
      ) > 0
    );
  }

  public formatPopulation(pop: number | null) {
    return formatPopulation(pop);
  }

  public formatPopulationAsInt(pop: number | null) {
    return formatPopulation(pop, undefined, false);
  }
}

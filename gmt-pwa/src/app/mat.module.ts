/** Module to regroup all ng-material and font awesome imports */

import { NgModule } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';

// Fontawesome
import {
  FaIconLibrary,
  FontAwesomeModule,
} from '@fortawesome/angular-fontawesome';

import {
  faCircle as farCircle,
  faCircleXmark as farCircleXmark,
} from '@fortawesome/free-regular-svg-icons';
import {
  faAngleRight,
  faAnglesLeft,
  faAnglesRight,
  faArrowDown,
  faArrowLeft,
  faArrowPointer,
  faArrowRight,
  faArrowUp,
  faBan,
  faBarsProgress,
  faCalendarCheck,
  faCalendarDays,
  faCaretDown,
  faChartPie,
  faCheck,
  faCircle,
  faCircleArrowLeft,
  faCircleArrowRight,
  faCircleCheck,
  faCircleExclamation,
  faCircleInfo,
  faCircleMinus,
  faCirclePlus,
  faCircleXmark,
  faClipboard,
  faClose,
  faCopy,
  faDatabase,
  faDownload,
  faDrawPolygon,
  faEarthAfrica,
  faEject,
  faFileExport,
  faFilter,
  faFloppyDisk,
  faHandPointer,
  faHourglassHalf,
  faHouseMedical,
  faHouseMedicalCircleExclamation,
  faHouseMedicalCircleXmark,
  faHouseMedicalFlag,
  faKey,
  faLayerGroup,
  faListCheck,
  faLocationCrosshairs,
  faLocationDot,
  faLocationPin,
  faLock,
  faMagnifyingGlass,
  faMap,
  faMinus,
  faObjectUngroup,
  faPen,
  faPeopleLine,
  faPerson,
  faPersonChalkboard,
  faPersonCircleExclamation,
  faPersonCircleQuestion,
  faPersonDigging,
  faPlayCircle,
  faPlus,
  faRightFromBracket,
  faRightToBracket,
  faRoad,
  faRotateLeft,
  faRotateRight,
  faScissors,
  faShare,
  faSliders,
  faSpinner,
  faStar,
  faSync,
  faTable,
  faTableList,
  faThumbTack,
  faTrashCan,
  faTriangleExclamation,
  faUpDownLeftRight,
  faUpload,
  faUserDoctor,
  faUserPlus,
  faUsers,
  faUsersRays,
  faVectorSquare,
  faWarning,
  faX,
} from '@fortawesome/free-solid-svg-icons';

// Material
import { DragDropModule } from '@angular/cdk/drag-drop';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatBottomSheetModule } from '@angular/material/bottom-sheet';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialogModule } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatExpansionModule } from '@angular/material/expansion';
import {
  MatFormFieldModule,
  MAT_FORM_FIELD_DEFAULT_OPTIONS,
} from '@angular/material/form-field';
import { MatGridListModule } from '@angular/material/grid-list';
import { MatIconModule, MatIconRegistry } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatMenuModule } from '@angular/material/menu';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSliderModule } from '@angular/material/slider';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatSortModule } from '@angular/material/sort';
import { MatStepperModule } from '@angular/material/stepper';
import { MatTableModule } from '@angular/material/table';
import { MatTabsModule } from '@angular/material/tabs';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { closeChildExpansionOnClose } from './directives/custom-expansion.directive';
import { getMarkerSVGPath } from './_shared/map/styles/map-design';

const importsExports = [
  FontAwesomeModule,
  DragDropModule,
  MatAutocompleteModule,
  MatBottomSheetModule,
  MatButtonModule,
  MatButtonToggleModule,
  MatCardModule,
  MatCardModule,
  MatCheckboxModule,
  MatChipsModule,
  MatDialogModule,
  MatExpansionModule,
  MatFormFieldModule,
  MatGridListModule,
  MatIconModule,
  MatInputModule,
  MatListModule,
  MatMenuModule,
  MatPaginatorModule,
  MatProgressBarModule,
  MatProgressSpinnerModule,
  MatRadioModule,
  MatSelectModule,
  MatSidenavModule,
  MatSlideToggleModule,
  MatSliderModule,
  MatSnackBarModule,
  MatSortModule,
  MatStepperModule,
  MatTabsModule,
  MatTableModule,
  MatToolbarModule,
  MatTooltipModule,
  ScrollingModule,
  MatDividerModule,
];

@NgModule({
  declarations: [closeChildExpansionOnClose],
  imports: [...importsExports],
  exports: [...importsExports, closeChildExpansionOnClose],
  providers: [
    {
      provide: MAT_FORM_FIELD_DEFAULT_OPTIONS,
      useValue: {
        // appearance: 'outline',
        floatLabel: 'always',
      },
    },
  ],
})
export class MatModule {
  constructor(
    library: FaIconLibrary,
    private matIconRegistry: MatIconRegistry,
    private domSanitizer: DomSanitizer
  ) {
    this.matIconRegistry.addSvgIcon(
      `boundary-edit-union`,
      this.domSanitizer.bypassSecurityTrustResourceUrl(
        '../assets/icons/boundary/boundary-edit-union.svg'
      )
    );
    this.matIconRegistry.addSvgIcon(
      `boundary-edit-difference`,
      this.domSanitizer.bypassSecurityTrustResourceUrl(
        '../assets/icons/boundary/boundary-edit-difference.svg'
      )
    );
    this.matIconRegistry.addSvgIcon(
      `boundary-mp-status1`,
      this.domSanitizer.bypassSecurityTrustResourceUrl(
        '../assets/icons/boundary/mpStatus1.svg'
      )
    );
    this.matIconRegistry.addSvgIcon(
      `boundary-mp-status2`,
      this.domSanitizer.bypassSecurityTrustResourceUrl(
        '../assets/icons/boundary/mpStatus2.svg'
      )
    );
    this.matIconRegistry.addSvgIcon(
      `boundary-mp-status3`,
      this.domSanitizer.bypassSecurityTrustResourceUrl(
        '../assets/icons/boundary/mpStatus3.svg'
      )
    );
    this.matIconRegistry.addSvgIcon(
      `boundary-policy1`,
      this.domSanitizer.bypassSecurityTrustResourceUrl(
        '../assets/icons/boundary/policy1.svg'
      )
    );
    this.matIconRegistry.addSvgIcon(
      `boundary-policy2`,
      this.domSanitizer.bypassSecurityTrustResourceUrl(
        '../assets/icons/boundary/policy2.svg'
      )
    );
    this.matIconRegistry.addSvgIcon(
      `boundary-policy3`,
      this.domSanitizer.bypassSecurityTrustResourceUrl(
        '../assets/icons/boundary/policy3.svg'
      )
    );
    this.matIconRegistry.addSvgIcon(
      `boundary-policy4`,
      this.domSanitizer.bypassSecurityTrustResourceUrl(
        '../assets/icons/boundary/policy4.svg'
      )
    );
    this.matIconRegistry.addSvgIcon(
      `boundary-coverage1`,
      this.domSanitizer.bypassSecurityTrustResourceUrl(
        '../assets/icons/boundary/coverage1.svg'
      )
    );
    this.matIconRegistry.addSvgIcon(
      `boundary-coverage2`,
      this.domSanitizer.bypassSecurityTrustResourceUrl(
        '../assets/icons/boundary/coverage2.svg'
      )
    );
    this.matIconRegistry.addSvgIcon(
      `boundary-coverage3`,
      this.domSanitizer.bypassSecurityTrustResourceUrl(
        '../assets/icons/boundary/coverage3.svg'
      )
    );
    this.matIconRegistry.addSvgIcon(
      `boundary-coverage4`,
      this.domSanitizer.bypassSecurityTrustResourceUrl(
        '../assets/icons/boundary/coverage4.svg'
      )
    );
    this.matIconRegistry.addSvgIcon(
      `boundary-quality1`,
      this.domSanitizer.bypassSecurityTrustResourceUrl(
        '../assets/icons/boundary/quality1.svg'
      )
    );
    this.matIconRegistry.addSvgIcon(
      `boundary-quality2`,
      this.domSanitizer.bypassSecurityTrustResourceUrl(
        '../assets/icons/boundary/quality2.svg'
      )
    );
    this.matIconRegistry.addSvgIcon(
      `boundary-quality3`,
      this.domSanitizer.bypassSecurityTrustResourceUrl(
        '../assets/icons/boundary/quality3.svg'
      )
    );
    this.matIconRegistry.addSvgIcon(
      `boundary-quality4`,
      this.domSanitizer.bypassSecurityTrustResourceUrl(
        '../assets/icons/boundary/quality4.svg'
      )
    );
    this.matIconRegistry.addSvgIcon(
      `hf`,
      this.domSanitizer.bypassSecurityTrustResourceUrl(
        getMarkerSVGPath('fixed_default')
      )
    );
    this.matIconRegistry.addSvgIcon(
      `outreach`,
      this.domSanitizer.bypassSecurityTrustResourceUrl(
        getMarkerSVGPath('outreach_default')
      )
    );
    this.matIconRegistry.addSvgIcon(
      `settlement`,
      this.domSanitizer.bypassSecurityTrustResourceUrl(
        getMarkerSVGPath('settlement_default')
      )
    );
    this.matIconRegistry.addSvgIcon(
      `church`,
      this.domSanitizer.bypassSecurityTrustResourceUrl(
        getMarkerSVGPath('poi_church_default')
      )
    );
    this.matIconRegistry.addSvgIcon(
      `mosque`,
      this.domSanitizer.bypassSecurityTrustResourceUrl(
        getMarkerSVGPath('poi_mosque_default')
      )
    );
    this.matIconRegistry.addSvgIcon(
      `market`,
      this.domSanitizer.bypassSecurityTrustResourceUrl(
        getMarkerSVGPath('poi_market_default')
      )
    );
    this.matIconRegistry.addSvgIcon(
      `school`,
      this.domSanitizer.bypassSecurityTrustResourceUrl(
        getMarkerSVGPath('poi_school_default')
      )
    );
    this.matIconRegistry.addSvgIcon(
      `roads`,
      this.domSanitizer.bypassSecurityTrustResourceUrl(
        getMarkerSVGPath('settlement_default')
      )
    );
    this.matIconRegistry.addSvgIcon(
      `catchment`,
      this.domSanitizer.bypassSecurityTrustResourceUrl(
        getMarkerSVGPath('catchments')
      )
    );
    this.matIconRegistry.addSvgIcon(
      `catchment_single`,
      this.domSanitizer.bypassSecurityTrustResourceUrl(
        getMarkerSVGPath('catchment_single')
      )
    );
    this.matIconRegistry.addSvgIcon(
      `boundaries`,
      this.domSanitizer.bypassSecurityTrustResourceUrl(
        getMarkerSVGPath('boundaries')
      )
    );
    this.matIconRegistry.addSvgIcon(
      `buffer`,
      this.domSanitizer.bypassSecurityTrustResourceUrl(
        getMarkerSVGPath('buffer')
      )
    );
    this.matIconRegistry.addSvgIcon(
      `voronoi`,
      this.domSanitizer.bypassSecurityTrustResourceUrl(
        getMarkerSVGPath('voronoi')
      )
    );
    this.matIconRegistry.addSvgIcon(
      `popdens`,
      this.domSanitizer.bypassSecurityTrustResourceUrl(
        getMarkerSVGPath('pop_legend')
      )
    );

    // add fa icons
    for (let icon of new Set([
      faAngleRight,
      faAnglesLeft,
      faAnglesRight,
      faArrowDown,
      faArrowLeft,
      faArrowUp,
      faArrowPointer,
      faArrowRight,
      faBan,
      faCalendarCheck,
      faCaretDown,
      faCircle,
      faCircleArrowLeft,
      faCircleArrowRight,
      faCircleCheck,
      faCircleInfo,
      faCircleMinus,
      faCirclePlus,
      faCircleXmark,
      faClose,
      faCopy,
      faDatabase,
      faDownload,
      faDrawPolygon,
      faEject,
      faFileExport,
      faFilter,
      faHandPointer,
      faHouseMedical,
      faHouseMedicalCircleExclamation,
      faHouseMedicalCircleXmark,
      faHouseMedicalFlag,
      faLayerGroup,
      faListCheck,
      faLocationCrosshairs,
      faLocationDot,
      faLocationPin,
      faMagnifyingGlass,
      faMap,
      faEarthAfrica,
      faMinus,
      faObjectUngroup,
      faPen,
      faPerson,
      faPersonChalkboard,
      faPersonCircleExclamation,
      faPersonCircleQuestion,
      faPersonDigging,
      faPlayCircle,
      faPlus,
      faRightFromBracket,
      faRightToBracket,
      faRoad,
      faRotateLeft,
      faRotateRight,
      faScissors,
      faShare,
      faSpinner,
      faStar,
      faSync,
      faThumbTack,
      faTable,
      faTableList,
      faTrashCan,
      faUpDownLeftRight,
      faUpload,
      faUserDoctor,
      faUsers,
      faUsersRays,
      faWarning,
      faX,
      farCircle,
      farCircleXmark,
      faSliders,
      faBarsProgress,
      faPeopleLine,
      faChartPie,
      faCalendarDays,
      faVectorSquare,
      faUserPlus,
      faLock,
      faTriangleExclamation,
      faCircleExclamation,
      faCheck,
      faHourglassHalf,
      faKey,
      faClipboard,

      faFloppyDisk,
    ])) {
      library.addIcons(icon);
    }
  }
}

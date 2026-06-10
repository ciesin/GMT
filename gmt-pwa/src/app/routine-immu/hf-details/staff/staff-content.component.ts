import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnInit,
} from '@angular/core';
import {
  FormBuilder,
  FormControl,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { NGXLogger } from 'ngx-logger';
import { Subject, take, takeUntil } from 'rxjs';
import { DEFAULT_WIZARD_DIALOG_OPTIONS } from 'src/app/components/wizard/health-facility-wizard/health-facility-wizard.component';
import {
  staffPositionOptions,
  staffTypeOptions,
} from 'src/app/constants/hf.constants';

import { CommonModule } from '@angular/common';
import _ from 'lodash';
import { BoundaryVectorLayersService } from 'src/app/services/boundary-vector-layers.service';
import { UserContextService } from 'src/app/services/user-context.service';
import { CrudLayerService } from 'src/app/services/vector_layer/crud-layer.service';
import { SingleHfService } from 'src/app/services/vector_layer/single-hf.service';
import {
  ALL_HEALTH_FACILITY_STAFF_POSITION,
  ALL_HEALTH_FACILITY_STAFF_TYPE,
  GeoJsonHealthFacility,
  HealthFacilityStaffPosition,
  HealthFacilityStaffType,
  UNKNOWN,
} from 'src/app/utils/server-interfaces/GeoJson';
import { MatModule } from '../../../mat.module';
import {
  StaffDialogData,
  StaffDialogInput,
  StaffPopupComponent,
} from './staff-popup/staff-popup.component';

@Component({
  selector: 'staff-content',
  templateUrl: './staff-content.component.html',
  styleUrls: ['./staff-content.component.less'],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatModule,
    CommonModule,
    ReactiveFormsModule,
  ],
})
export class StaffContentComponent implements OnInit {
  public hf: GeoJsonHealthFacility;
  public staffPositionOptions = staffPositionOptions;
  public staffTypeOptions = staffTypeOptions;
  public userCanEdit: boolean = false;
  public FORM_KEY_NAME = 'name';
  public FORM_KEY_TYPE = 'type';
  public FORM_KEY_POSITION = 'position';
  public staffInfoFormGroup = this.formBuilder.group({
    [this.FORM_KEY_NAME]: ['', Validators.required],
    [this.FORM_KEY_TYPE]: new FormControl<HealthFacilityStaffType>(UNKNOWN),
    [this.FORM_KEY_POSITION]: new FormControl<HealthFacilityStaffPosition>(
      UNKNOWN
    ),
  });
  private userHasPermissionsUpdateHf: boolean = false;
  private editing: boolean = false;

  private unsubscribe = new Subject();

  constructor(
    private crudLayerService: CrudLayerService,

    private dialog: MatDialog,
    private formBuilder: FormBuilder,
    private logger: NGXLogger,
    private userContextService: UserContextService,
    private singleHfService: SingleHfService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.singleHfService.hf
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((hf: GeoJsonHealthFacility | null) => {
        if (!hf) {
          return;
        }
        // this.staffInfoFormGroup.reset();
        this.userHasPermissionsUpdateHf =
          this.singleHfService.userHasPermissionsUpdateHf;
        this.updateComponentPermissions();

        this.hf = hf;
        this.cdr.detectChanges();
        // causes reactive form mess
        // this.sortStaffNames();
      });
    // subscribe to edit mode
    this.subscribeToEditMode();
  }

  ngOnDestroy() {
    this.unsubscribe.next(undefined);
    this.unsubscribe.complete();
  }

  getStaffPosition(index: number): string {
    if (this.hf.properties.staff_positions[index] == 'Other') {
      if (!_.isArray(this.hf.properties.staff_positions_other)) {
        return '';
      }
      return this.hf.properties.staff_positions_other[index] || '';
    } else {
      return this.hf.properties.staff_positions[index];
    }
  }

  async deleteStaffMember(index: number) {
    this.hf.properties.staff_names.splice(index, 1);
    this.hf.properties.staff_positions.splice(index, 1);
    this.hf.properties.staff_types.splice(index, 1);
    //As this is backed by json, we check first
    if (_.isArray(this.hf.properties.staff_positions_other)) {
      this.hf.properties.staff_positions_other.splice(index, 1);
    }
    await this.crudLayerService.updateItem(
      'health_facility__point',
      this.hf,
      true
    );
  }

  async editStaffMember(index: number) {
    const dialogData: StaffDialogInput = {
      isEdit: true,
      staffData: {
        name: this.hf.properties.staff_names[index],
        position: this.hf.properties.staff_positions[index],
        position_other: _.isArray(this.hf.properties.staff_positions_other)
          ? this.hf.properties.staff_positions_other[index] || null
          : null,
        type: this.hf.properties.staff_types[index],
        index: index,
      },
    };
    this.openStaffDialog(dialogData);
  }

  public addStaffMember() {
    const dialogData: StaffDialogInput = {
      isEdit: false,
      staffData: {
        name: '',
        position: ALL_HEALTH_FACILITY_STAFF_POSITION[0],
        position_other: null,
        type: ALL_HEALTH_FACILITY_STAFF_TYPE[0],
        //a new one to be added at end
        index: this.hf.properties.staff_names.length,
      },
    };
    this.openStaffDialog(dialogData);
  }

  private openStaffDialog(dialogData: StaffDialogInput) {
    let dialogRef = this.dialog.open(StaffPopupComponent, {
      ...DEFAULT_WIZARD_DIALOG_OPTIONS,
      data: dialogData,
    });
    dialogRef
      .afterClosed()
      .pipe(take(1))
      .subscribe(async (staffData: StaffDialogData) => {
        //If they cancel, staffData will be nil
        if (!_.isNil(staffData)) {
          await this.createOrEditStaffMember(staffData);
        }
        dialogRef.close();
      });
  }

  private async createOrEditStaffMember(staffData: StaffDialogData) {
    const index = staffData.index;
    //index can be a new item
    this.hf.properties.staff_names[index] = staffData.name;
    this.hf.properties.staff_positions[index] = staffData.position;
    this.hf.properties.staff_types[index] = staffData.type;
    if (!_.isArray(this.hf.properties.staff_positions_other)) {
      this.hf.properties.staff_positions_other = [];
    }
    this.hf.properties.staff_positions_other[index] = staffData.position_other;
    await this.crudLayerService.updateItem(
      'health_facility__point',
      this.hf,
      true
    );
  }

  private subscribeToEditMode() {
    this.userContextService
      .getIsEditingObservable()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((isEditing) => {
        this.editing = isEditing;
        this.updateComponentPermissions();
      });
  }

  private updateComponentPermissions() {
    for (const fieldKey in this.staffInfoFormGroup.controls) {
      if (this.editing && this.userHasPermissionsUpdateHf) {
        this.staffInfoFormGroup.get(fieldKey)!.enable();
      } else {
        this.staffInfoFormGroup.get(fieldKey)!.disable();
      }
    }
    this.userCanEdit = this.userHasPermissionsUpdateHf && this.editing;
    this.cdr.detectChanges();
  }
}

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Inject,
  OnInit,
} from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  FormControl,
  FormsModule,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
} from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { addWizardCssClassToCdkOverlayWrapper } from '@components/wizard/health-facility-wizard/health-facility-wizard.component';
import _ from 'lodash';
import {
  staffPositionOptions,
  staffTypeOptions,
} from 'src/app/constants/hf.constants';
import {
  HealthFacilityStaffPosition,
  HealthFacilityStaffType,
  UNKNOWN,
} from 'src/app/utils/server-interfaces/GeoJson';
import { MatModule } from '../../../../mat.module';

//Used for both input and output

export interface StaffDialogInput {
  staffData: StaffDialogData;
  isEdit: boolean;
}
export interface StaffDialogData {
  name: string;
  type: HealthFacilityStaffType;
  position: HealthFacilityStaffPosition;
  position_other: string | null;
  index: number;
}

@Component({
  selector: 'staff-popup',
  templateUrl: './staff-popup.component.html',
  styleUrls: ['./staff-popup.component.less'],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatModule, CommonModule, ReactiveFormsModule],
})
export class StaffPopupComponent implements OnInit {
  public staffPositionOptions = staffPositionOptions;
  public staffTypeOptions = staffTypeOptions;

  public FORM_KEY_NAME = 'name';
  public FORM_KEY_TYPE = 'type';
  public FORM_KEY_POSITION = 'position';
  //If other chosen, what is the freeform text
  public FORM_KEY_POSITION_OTHER = 'position_other';
  public staffInfoFormGroup = this.formBuilder.group(
    {
      [this.FORM_KEY_NAME]: [''],
      [this.FORM_KEY_TYPE]: new FormControl<HealthFacilityStaffType>(UNKNOWN),
      [this.FORM_KEY_POSITION]: new FormControl<HealthFacilityStaffPosition>(
        UNKNOWN
      ),
      [this.FORM_KEY_POSITION_OTHER]: new FormControl<string | null>(null),
    },
    {
      validators: this.otherPositionValidator(),
    }
  );

  constructor(
    private formBuilder: FormBuilder,
    private dialogRef: MatDialogRef<StaffPopupComponent>,
    @Inject(MAT_DIALOG_DATA) public data: StaffDialogInput
  ) {}

  ngOnInit() {
    const staff = this.data.staffData;
    this.staffInfoFormGroup.get(this.FORM_KEY_NAME)!.setValue(staff.name);
    this.staffInfoFormGroup.get(this.FORM_KEY_TYPE)!.setValue(staff.type);
    this.staffInfoFormGroup
      .get(this.FORM_KEY_POSITION)!
      .setValue(staff.position);
    this.staffInfoFormGroup
      .get(this.FORM_KEY_POSITION_OTHER)!
      .setValue(staff.position_other);

    addWizardCssClassToCdkOverlayWrapper(true);
  }

  handleSaveAndClose() {
    this.staffInfoFormGroup.markAllAsTouched();
    if (!this.staffInfoFormGroup.valid) {
      return;
    }

    const nameVal: string = this.staffInfoFormGroup.get(
      this.FORM_KEY_NAME
    )!.value;
    const posOther: string | null =
      this.staffInfoFormGroup.get(this.FORM_KEY_POSITION_OTHER)!.value || null;
    const retData: StaffDialogData = {
      name: nameVal.trim(),
      type: this.staffInfoFormGroup.get(this.FORM_KEY_TYPE)!.value,
      position: this.staffInfoFormGroup.get(this.FORM_KEY_POSITION)!.value,
      position_other: _.isString(posOther) ? posOther.trim() : null,
      index: this.data.staffData.index,
    };

    this.dialogRef.close(retData);
  }

  handleCancelDialog() {
    addWizardCssClassToCdkOverlayWrapper(false);
    this.dialogRef.close();
  }

  private otherPositionValidator(): ValidatorFn {
    return (group: AbstractControl): ValidationErrors | null => {
      const position: HealthFacilityStaffPosition = group.get(
        this.FORM_KEY_POSITION
      )?.value;
      const positionOther = group.get(this.FORM_KEY_POSITION_OTHER)!;
      const name = group.get(this.FORM_KEY_NAME)!;

      let hasError = false;

      // Reset errors first
      positionOther.setErrors(null);
      name.setErrors(null);

      if (
        _.isNil(name.value) ||
        !_.isString(name.value) ||
        name.value.trim().length == 0
      ) {
        name.setErrors({ required: true });
      }

      if (position == 'Other') {
        if (
          _.isNil(positionOther.value) ||
          !_.isString(positionOther.value) ||
          positionOther.value.trim().length == 0
        ) {
          positionOther.setErrors({ required: true });
          hasError = true;
        }
      }

      return hasError ? { validationErrors: true } : null;
    };
  }
}

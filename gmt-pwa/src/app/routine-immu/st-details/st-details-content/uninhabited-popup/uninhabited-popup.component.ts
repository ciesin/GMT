import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component, Inject,
  OnDestroy,
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
  Validators,
} from '@angular/forms';
import {MAT_DIALOG_DATA, MatDialogRef} from '@angular/material/dialog';
import { NGXLogger } from 'ngx-logger';
import { uninhabitedReasonsOptions } from 'src/app/constants/st.constants';
import { MatModule } from 'src/app/mat.module';
import { Unsubscribe } from 'src/app/_shared/mixins/unsubscribe';
import {
  GeoJsonSettlementNameProperties,
  UninhabitedOption,
  UNKNOWN,
} from '../../../../utils/server-interfaces/GeoJson';
import { SelectOption } from '../../../../utils/ui/ui-component-interfaces';
import {SettlementWizardDialogData} from "@components/wizard/settlement-wizard/settlement-wizard.component";

export class BaseComponent {
  getLogger(): NGXLogger {
    throw new Error('Component must override this');
  }
}
//See comments in dataset-map.component.ts
const MixedComponent = Unsubscribe(BaseComponent);

export type UninhabitedPopupDialogData = Pick<
  GeoJsonSettlementNameProperties,
  'uninhabited' | 'uninhabited_reason' | 'uninhabited_other_detail'
>;

@Component({
  selector: 'gmt-uninhabited-popup',
  templateUrl: './uninhabited-popup.component.html',
  styleUrls: ['./uninhabited-popup.component.less'],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatModule, CommonModule, ReactiveFormsModule],
})
export class UninhabitedPopupComponent
  extends MixedComponent
  implements OnInit, OnDestroy
{
  public FORM_KEY_UNINHABITED = 'uninhabited';
  public FORM_KEY_UNINHABITED_REASON = 'uninhabited_reason';
  public FORM_KEY_OTHER_DETAIL = 'uninhabited_other_detail';
  public formGroup = this.formBuilder.group(
    {
      [this.FORM_KEY_UNINHABITED]: new FormControl<boolean>(true, [
        Validators.required,
      ]),
      [this.FORM_KEY_UNINHABITED_REASON]:
        new FormControl<UninhabitedOption | null>(null),
      [this.FORM_KEY_OTHER_DETAIL]: new FormControl<string | null>(null),
    },
    {
      validators: this.uninhabitedConditionalValidator(),
    }
  );

  public uninhabitedReasonsOptions: Array<SelectOption> =
    uninhabitedReasonsOptions.filter((x) => x.value !== UNKNOWN);
  constructor(
    //private loadingService: IsLoadingService,
    private dialogRef: MatDialogRef<UninhabitedPopupComponent>,
    private formBuilder: FormBuilder,
    @Inject(MAT_DIALOG_DATA) private data: UninhabitedPopupDialogData,
    private logger: NGXLogger //private messageService: MessageService, //private cdr: ChangeDetectorRef,
  ) {
    super();
  }

  override getLogger(): NGXLogger {
    return this.logger;
  }

  ngOnInit() {
    this.formGroup.get(this.FORM_KEY_UNINHABITED)!.setValue(this.data.uninhabited);
      this.formGroup.get(this.FORM_KEY_UNINHABITED_REASON)!.setValue(this.data.uninhabited_reason);
      this.formGroup.get(this.FORM_KEY_OTHER_DETAIL)!.setValue(this.data.uninhabited_other_detail);
  }

  private uninhabitedConditionalValidator(): ValidatorFn {
    return (group: AbstractControl): ValidationErrors | null => {
      const uninhabited = group.get(this.FORM_KEY_UNINHABITED)?.value;
      const reasonControl = group.get(this.FORM_KEY_UNINHABITED_REASON)!;
      const otherDetailControl = group.get(this.FORM_KEY_OTHER_DETAIL)!;

      const otherOption: UninhabitedOption = 'Other';

      let hasError = false;

      // Reset errors first
      reasonControl.setErrors(null);
      otherDetailControl.setErrors(null);

      if (uninhabited) {
        if (!reasonControl.value) {
          reasonControl.setErrors({ required: true });
          hasError = true;
        }

        if (reasonControl.value === otherOption && !otherDetailControl.value) {
          otherDetailControl.setErrors({ required: true });
          hasError = true;
        }
      }

      return hasError ? { uninhabitedValidation: true } : null;
    };
  }

  async handleSaveAndClose() {
    this.formGroup.markAllAsTouched();
    if (!this.formGroup.valid) {
      return;
    }
    const uninhabited = this.formGroup.get(this.FORM_KEY_UNINHABITED)?.value;
    const reason = this.formGroup.get(this.FORM_KEY_UNINHABITED_REASON)?.value;
    const otherDetail = this.formGroup.get(this.FORM_KEY_OTHER_DETAIL)?.value;

    const retData: UninhabitedPopupDialogData = {
      uninhabited,
      uninhabited_other_detail: otherDetail,
      uninhabited_reason: reason,
    };
    this.dialogRef.close(retData);
  }
}

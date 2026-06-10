import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Inject,
  OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { addWizardCssClassToCdkOverlayWrapper } from '@components/wizard/health-facility-wizard/health-facility-wizard.component';
import { MatModule } from '../../../../mat.module';

//Used for both input and output

export interface AssignmentOption {
  hfId: string;
  displayName: string;
  fixedPostName: string;
  outreachName: string | null;
  is_outreach: boolean;
}

export interface ExplicitAssignInput {
  options: Array<AssignmentOption>;
}
export interface ExplicitAssignData {
  //If populated, we should create an explicit include
  option: AssignmentOption | null;
}

@Component({
  selector: 'explicit-assign-popup',
  templateUrl: './explicit-assign-popup.component.html',
  styleUrls: ['./explicit-assign-popup.component.less'],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatModule, CommonModule],
})
export class ExplicitAssignPopupComponent implements OnInit {
  public selectedAssignment: AssignmentOption | null = null;

  constructor(
    private dialogRef: MatDialogRef<ExplicitAssignPopupComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ExplicitAssignInput
  ) {}

  ngOnInit() {
    addWizardCssClassToCdkOverlayWrapper(true);
  }

  handleSaveAndClose() {
    const retData: ExplicitAssignData = {
      option: this.selectedAssignment,
    };

    this.dialogRef.close(retData);
  }

  handleCancelDialog() {
    addWizardCssClassToCdkOverlayWrapper(false);
    this.dialogRef.close();
  }
}

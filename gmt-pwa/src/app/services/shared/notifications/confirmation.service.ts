import { Injectable } from '@angular/core';
import {
  ConfirmationMessageComponent
} from "src/app/_shared/components/confirmation-message/confirmation-message.component";
import {
  DEFAULT_WIZARD_DIALOG_OPTIONS
} from "src/app/components/wizard/health-facility-wizard/health-facility-wizard.component";
import { MatDialog } from '@angular/material/dialog';

export interface ConfirmationType {
  message: string;
  header?: string;
  icon?: string;
  rejectLabel?: string;
  acceptLabel?: string;
  showRejectButton: boolean;
  accept?: () => void;
  reject?: () => void;
}

@Injectable({
  providedIn: 'root'
})
export class ConfirmationService {

  constructor(private dialog: MatDialog) {
  }

  confirm(confirmation: ConfirmationType) {
    if (confirmation) {
      this.dialog.open(ConfirmationMessageComponent, {
        ...DEFAULT_WIZARD_DIALOG_OPTIONS,
        data: confirmation
      });
    }
  }
}

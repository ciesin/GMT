import { Component, Inject } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { ConfirmationType } from 'src/app/services/shared/notifications/confirmation.service';

@Component({
  selector: 'gmt-confirmation-message',
  templateUrl: './confirmation-message.component.html',
  styleUrls: ['./confirmation-message.component.less'],
  standalone: false
})
export class ConfirmationMessageComponent {
  constructor(
    @Inject(MAT_DIALOG_DATA) public data: ConfirmationType,
    private dialogRef: MatDialogRef<ConfirmationMessageComponent>
  ) {}

  handleCancelDialog() {
    this.dialogRef.close();
  }

  handleAccept() {
    if (this.data.accept) {
      this.data.accept();
    }
    this.dialogRef.close();
  }

  handleReject() {
    if (this.data.reject) {
      this.data.reject();
    }

    this.dialogRef.close();
  }
}

import { Component, Inject } from '@angular/core';
import { MatSnackBarRef, MAT_SNACK_BAR_DATA } from '@angular/material/snack-bar';
import { MessageType } from 'src/app/services/shared/notifications/message.service';

@Component({
    selector: 'gmt-snackbar-message',
    templateUrl: './snackbar-message.component.html',
    styleUrls: ['./snackbar-message.component.less'],
    standalone: false
})
export class SnackbarMessageComponent {
  constructor(@Inject(MAT_SNACK_BAR_DATA) public data: { message: MessageType },
               public snackBarRef: MatSnackBarRef<SnackbarMessageComponent>
  ) { }

  copy() {
    // copy message detail to clipboard
    const type = "text/plain";
    const blob = new Blob([this.data.message.detail || ''], { type });
    const data = [new ClipboardItem({ [type]: blob })];
    navigator.clipboard.write(data);
  }
}

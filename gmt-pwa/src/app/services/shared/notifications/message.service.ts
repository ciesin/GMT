import { Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SnackbarMessageComponent } from 'src/app/_shared/components/snackbar-message/snackbar-message.component';

// const MESSAGE_SEVERITY = [
//   'info',
//   "success",
//   "warning",
//   "error",
// ] as const;
// type MessageSeverityType = typeof MESSAGE_SEVERITY;
export interface MessageType {
  summary: string;
  detail?: string;
  severity?: string;
  sticky?: boolean;
  key?: string;
  life?: number;
}

@Injectable({
  providedIn: 'root'
})
export class MessageService {
  // messageSource: Subject<MessageType> = new Subject();

  constructor(private _snackBar: MatSnackBar) { }
  add(message: MessageType) {
    if (message) {
      this._snackBar.openFromComponent(SnackbarMessageComponent, {
        data: { message },
        announcementMessage: message.summary,
        duration: message.life ? message.life : 20000
      });
    }
  }
}

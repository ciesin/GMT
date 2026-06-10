import { Injectable, ErrorHandler, Injector } from '@angular/core';
import {isString} from "./string-formatting";
import {OAuthErrorEvent} from "angular-oauth2-oidc";
import {AuthService} from "../services/user/auth.service";
import { NGXLogger } from 'ngx-logger';
import { MessageService } from 'src/app/services/shared/notifications/message.service';

@Injectable({ providedIn: 'root' })
export class AppErrorHandler implements ErrorHandler {
  constructor(private injector: Injector,
              private messageService: MessageService,
              private authService: AuthService,
              private logger: NGXLogger) {}

  handleError(error: any): void {
    this.logger.error(error);

    let summary = "";
    let detail = "";
    if (isString(error)) {
      summary = error;
      detail = error;
    } else if (error.promise && error.rejection && error?.rejection?.message) {
      summary = error.rejection.message;
      detail = error.rejection.stack;
    } else {
      summary = error.message.replace('Uncaught (in promise):', '');
      detail = error.stack;
    }
    if(error instanceof OAuthErrorEvent || error?.rejection instanceof OAuthErrorEvent){
      this.authService.handleRefreshTokenError(error);
    } else{
      this.messageService.add({
          summary,
          detail,
          severity: 'error',
          sticky: true,
          key: 'error-details'
        });
    }

  }
}

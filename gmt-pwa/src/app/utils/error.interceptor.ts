import {Injectable} from '@angular/core';
import { HttpRequest, HttpHandler, HttpEvent, HttpInterceptor, HttpResponse, HttpErrorResponse } from '@angular/common/http';
import {Observable, throwError, EMPTY} from 'rxjs';
import {catchError, map} from 'rxjs/operators';
import {AppErrorHandler} from 'src/app/utils/app-error.handler';
import {IsOnlineService} from "../services/is-online.service";
import {IsLoadingService} from '../services/is-loading.service';
import {AuthService} from "../services/user/auth.service";
import { NGXLogger } from 'ngx-logger';


@Injectable()
export class ErrorInterceptor implements HttpInterceptor {
  constructor(private appErrorHandler: AppErrorHandler,
              private isOnlineService: IsOnlineService,
              private isLoadingService: IsLoadingService,
              private authService: AuthService,
              private logger: NGXLogger
  ) {
  }

  intercept(request: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    return next.handle(request).pipe(
      map(val => {
        if (val instanceof HttpResponse) {
          if (val.body?.errors && val.body?.errors.length > 0) {
            console.info("HTTP returned 200 but errors in the body", val.body.errors);
          } else if (val.body?.error && val.body?.error.length > 0) {
            console.info("HTTP returned 200 but error in the body", val.body.error);
          }
        }
        return val;
      }),
      catchError((error: HttpErrorResponse) => {
        // For the following cases, do not show error notification
        if (error.url && error.url.endsWith("/is_online")) {
          //don't show an error
          return throwError("You are offline");
        } else if (error.url && error.url.endsWith("protocol/openid-connect/token") ||
          error.status == 401
        ){// token retrieve and token refresh errors should be handled only by auth.service
          this.authService.handleRefreshTokenError(error?.error);
          return EMPTY;
        }

        // These are errors we want to notify
        let errorMsg = '';
        if (error.error instanceof ErrorEvent) {
          this.logger.info('this is client side error');
          errorMsg = `Error: ${error.error.message}`;
        } else if (error.error instanceof ProgressEvent) {
          this.logger.info('progress event error', error);
          return EMPTY;
        } else {
          this.logger.info('this is server side error');
          this.logger.info(error, error.error?.errors);
          if (error.error?.errors) {
            for (let err of error.error?.errors) {
              errorMsg += err;
            }
          } else {
            errorMsg = `${error.message}`;
          }

        }

        //Some 504 / gateway timeouts are showing up, so we only log it, but don't throw
        if([401, 400, 403].includes(error?.status)){
          this.isLoadingService.setLoading(false);
          return throwError(errorMsg);
        }else{
          return EMPTY;
        }
      })
    );
  }
}

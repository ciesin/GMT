import { BaseError } from './errors';


export function logError(err){
    // TODO get env to know if the real full error should be logged and where
    if(err.response){
        console.log(err.response, "err.response in logError function");
    }else{
        console.log(err, "err in log_error function");
    }

}

class ErrorHandler {
 public handleError(err): void {
   // await logger.error(
   //   'Error message from the centralized error-handling component',
   //   err,
   // );
   // if critical await sendEmailToAdmin();
     logError(err);
 }

 public isKnownError(error: Error): boolean {
   if (error instanceof BaseError) {
     return error.isKnown;
   }
   return false;
 }
}
export const errorHandler = new ErrorHandler();

import { Context } from 'koa';

export enum HttpStatusCode {
 BAD_REQUEST = 400,
 UNAUTHENTICATED = 401,
 FORBIDDEN_CLIENT_ERROR = 403,
 NOT_FOUND = 404,
 INTERNAL_SERVER = 500,
}

export enum HttpStatusDefaultMessage {
 UNAUTHENTICATED = "Unauthorized",
 FORBIDDEN_CLIENT_ERROR = "User has not enough rights to perform this action",
 INTERNAL_SERVER = "Internal Server Error",
}

export enum HttpStatusName {
 BAD_REQUEST = 'Bad request',
 UNAUTHENTICATED = "Unauthorized",
 FORBIDDEN_CLIENT_ERROR = "Forbidden Client Error",
 INTERNAL_SERVER = "Internal Server Error",
}

export class BaseError extends Error {
 public readonly name: HttpStatusName;
 public readonly httpCode: HttpStatusCode;
 public readonly isKnown: boolean;

 constructor(ctx: Context,
             name: HttpStatusName,
             httpCode: HttpStatusCode,
             description: string | string[],
             isKnown: boolean) {
   if (description.constructor.name == "Array") {
     super(description[0]);
   }else{
     super(description as string);
   }

   Object.setPrototypeOf(this, new.target.prototype);
   this.name = name;
   this.httpCode = httpCode;
   this.isKnown = isKnown;

   Error.captureStackTrace(this);

   ctx.body = {errors: [description]};
   ctx.status = httpCode;
   console.log(`${httpCode}: ` + JSON.stringify({errors: [description]}));
   ctx.throw(httpCode, JSON.stringify({errors: [description]}));
 }
}

export class BadRequestError extends BaseError {
 constructor(ctx: Context, description: string | string[] = 'bad request') {
   super(ctx, HttpStatusName.BAD_REQUEST, HttpStatusCode.BAD_REQUEST, description, true);
 }
}

export class APIError extends BaseError {
 constructor(ctx: Context,
             name: HttpStatusName = HttpStatusName.INTERNAL_SERVER,
             httpCode: HttpStatusCode = HttpStatusCode.INTERNAL_SERVER,
             isKnown: boolean = true,
             description: string | string[] = HttpStatusDefaultMessage.INTERNAL_SERVER) {
   super(ctx, name, httpCode, description, isKnown);
 }
}

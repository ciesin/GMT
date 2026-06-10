import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot } from '@angular/router';
import { AuthService } from "../services/user/auth.service";
import { Observable, of } from "rxjs";
import { catchError, filter, map } from "rxjs/operators";

@Injectable({
    providedIn: 'root'
})
export class LoggedInGuard  {
    constructor(private router: Router, private authService: AuthService) { }

    canActivate(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<boolean> | boolean {
        return this.authService.loggedIn()
            .pipe(filter((loggedIn, _) => loggedIn !== null))// skip null case
            .pipe(
                map((loggedIn: boolean | null) => {
                    if (loggedIn === true) {
                        return true;
                    } else if (loggedIn === false) {
                        this.router.navigate(['/']);

                    }
                    return false;
                }),
                catchError((err) => {
                    console.log('auth: err', err);
                    this.router.navigate(['/']);
                    return of(false);
                })
            );
    }
}

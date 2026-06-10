import {Component, OnInit} from '@angular/core';
import {RoutesChunks} from "src/app/constants/routing.enum";
import {Subject} from "rxjs";
import {AuthService} from "../services/user/auth.service";
import {takeUntil} from "rxjs/operators";
@Component({
    selector: 'gmt-landing-page',
    templateUrl: './landing-page.component.html',
    styleUrls: ['./landing-page.component.less'],
    standalone: false
})
export class LandingPageComponent implements OnInit {
  routes = {
    map: RoutesChunks.ROUTINE_IMMUNIZATION,
    immunization: RoutesChunks.ROUTINE_IMMUNIZATION,
    polio: RoutesChunks.ROUTINE_IMMUNIZATION,
  }

  show: boolean = true;
  loggedIn: boolean | null = null;
  private unsubscribe = new Subject();

  constructor(private authService: AuthService) {
  }

  ngOnInit(): void {
    this.authService.loggedIn().pipe(takeUntil(this.unsubscribe)).subscribe((loggedIn: boolean | null) => {
      this.loggedIn = loggedIn;
    });
  }

  ngOnDestroy() {
    this.unsubscribe.next(undefined);
    this.unsubscribe.complete();
  }

  scrollToInfos() {
    document.getElementById('infos')?.scrollIntoView({behavior: 'smooth'});
  }

  scrollToWelcome() {
    document.getElementById('welcome')?.scrollIntoView({behavior: 'smooth'});
  }
}

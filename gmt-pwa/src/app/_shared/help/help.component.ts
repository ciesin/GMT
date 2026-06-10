import {Component, OnInit, Input} from '@angular/core';
import {ActivatedRoute, ActivatedRouteSnapshot, ActivationEnd, Router, RouterEvent} from '@angular/router';
import { NGXLogger } from 'ngx-logger';
import {filter, map} from 'rxjs/operators';
import {AppConfigService} from "../../utils/app-config.service";

export const HELP_TAB_NAME = '_gmt_help';

export function getHelpRoot() {
  return AppConfigService.conf.api_url + "/help";
}

/**
 * Usage
 * <app-help index="home">Documentation</app-help>
 * OR <app-help index="home"></app-help> to get just an icon
 * And you have to add the url of below
 * eg: helpTOC.set('example',`${helpRoot}/docs/example.html`);
 *
 * We can also use a generic button that select documentation using current page route
 * const routes: RouteWithData[] = [{
    ..., data: {
      ..., helpIndex: "fieldDataCollection"
    }
  },...]
 */
@Component({
    selector: 'app-help',
    templateUrl: 'help.component.html',
    styleUrls: ['help.component.less'],
    standalone: false
})
export class HelpComponent implements OnInit {

  @Input() index: string;
  public currentPageHelpIndex: string;

  constructor(private router: Router,
              private activatedRoute: ActivatedRoute,
              private logger: NGXLogger) {
  }

  ngOnInit(): void {
    this.initHelpTOC();

    // initialize help index
    this.currentPageHelpIndex = this.expandHelpIndex(this.activatedRoute.snapshot.root.firstChild, this.activatedRoute.snapshot.root.firstChild?.data.helpIndex)

    // changes help index on route change
    this.router.events
      .pipe(filter(evt => evt instanceof ActivationEnd), map(evt => evt as ActivationEnd))
      .subscribe(evt => {
        this.currentPageHelpIndex = this.expandHelpIndex(evt.snapshot, evt.snapshot.data.helpIndex);
        //console.debug('help idx changed', this.currentPageHelpIndex);
      });
  }

  private expandHelpIndex(snp: ActivatedRouteSnapshot | null, routeHelpIndex: Function | string | null) {
    if (!snp || !routeHelpIndex) {
      return;
    }
    if (typeof routeHelpIndex === 'function') {
      return routeHelpIndex(snp);
    }
    return routeHelpIndex;
  }

  getHelpUrl(): string {
   var link = helpTOC.get(this.index || this.currentPageHelpIndex);
    if (link == undefined) {
      if (this.index)
        this.logger.warn(`help index not found with index: ${this.index} and currentPageHelpIndex: ${this.currentPageHelpIndex}`);
      link = helpTOC.get('home');
    }
    return link;
  }


  openHelp(): void {
    var link = this.getHelpUrl();
    window.open(link, HELP_TAB_NAME)!.focus();
  }

  initHelpTOC(): void {
    const helpRoot = getHelpRoot();

    //add your doc below
    helpTOC.set('home', `${helpRoot}/index.html`);
    helpTOC.set('example', `${helpRoot}/docs/example.html`);


  }
}

// Table Of Contents
const helpTOC = new Map();

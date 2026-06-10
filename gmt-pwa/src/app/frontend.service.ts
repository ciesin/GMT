import { Injectable } from '@angular/core';
import { DomSanitizer, Title } from '@angular/platform-browser';
import { AppConfigService } from './utils/app-config.service';


@Injectable({
  providedIn: 'root'
})
export class FrontendService {

  constructor(
    protected titleSvc: Title,
  ) { }

  /**
   * Set the browser tab title
   */
  setTitle(newTitle: string): void {
    this.titleSvc.setTitle(newTitle + ' | GMT ' + AppConfigService.conf.environment?.toUpperCase());
  }


}

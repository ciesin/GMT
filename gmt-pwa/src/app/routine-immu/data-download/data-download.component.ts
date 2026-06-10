import {Component, OnDestroy, OnInit} from '@angular/core';
import {ActivatedRoute} from '@angular/router';
import {Subject, Subscription} from 'rxjs';
import {takeUntil} from "rxjs/operators";
import {IsLoadingService} from "src/app/services/is-loading.service";
import {IsOnlineService} from "src/app/services/is-online.service";
import {DataExportService} from "src/app/services/export/data-export.service";
import {AuthService} from "src/app/services/user/auth.service";
import { NGXLogger } from 'ngx-logger';


@Component({
    selector: 'data-download',
    templateUrl: './data-download.component.html',
    styleUrls: ['./data-download.component.less'],
    standalone: false
})
export class DataDownloadComponent implements OnInit, OnDestroy {

  routeSubscription$: Subscription;

  public loggedIn: boolean | null = null;
  public isOnline: boolean | null = null;
  public jobId: number | null = null;
  public fileDownloaded: boolean = false;
  public errorMessage: string = "";
  public messageForTheUser: string = "Your download should start in a second ...";
  private unsubscribe = new Subject();

  constructor(private route: ActivatedRoute,
              private activatedRoute: ActivatedRoute,
              public loadingService: IsLoadingService,
              private dataExportService: DataExportService,
              private isOnlineService: IsOnlineService,
              private authService: AuthService,
              private logger: NGXLogger
  ) { }

  ngOnInit(): void {
    this.routeSubscription$ = this.route.params
      .pipe(takeUntil(this.unsubscribe))
      .subscribe(params => {
        this.jobId = params.jobId;
        this.validateAndDownloadExportedData();
      });

    this.isOnlineService.isOnlineStream().pipe(takeUntil(this.unsubscribe)).subscribe(isOnline => {
      this.isOnline = isOnline as boolean;
      if(!isOnline){
        this.errorMessage = "You are offline. Please connect to download the file."
      }else{
        this.validateAndDownloadExportedData();
      }
    });
    // download is available only for logged in users
    this.authService.loggedIn().pipe(takeUntil(this.unsubscribe)).subscribe(
      (loggedIn: boolean | null) => {
        this.loggedIn = loggedIn;
        if(loggedIn){
          this.validateAndDownloadExportedData();
        }
    });
  }

  ngOnDestroy() {
    this.unsubscribe.next(undefined);
    this.unsubscribe.complete();
  }

  private validateAndDownloadExportedData() {
     if(this.fileDownloaded){
       return;
     }
     if(!this.isOnline){
        this.errorMessage = "You are offline. Please connect to download the file."
        return;
      }
      if(!this.loggedIn){
        this.errorMessage = "You are not logged in. Please log in to be able to download the file."
        return;
      }
      if(!this.jobId || this.jobId <= 0){
        this.errorMessage = "No export id provided."
      } else{
        this.errorMessage = ""
        this.fileDownloaded = true;
        this.messageForTheUser = "Downloading ...";
        this.downloadExportedData();
      }
  }

  private downloadExportedData() {
    this.dataExportService.downloadDataExport(this.jobId!).then(
      _ => { this.messageForTheUser = "Data is downloaded."; },
      err => {
        this.errorMessage = "Error while downloading the file.";
        this.logger.error(err);
      }
    );
  }

}

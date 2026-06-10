import {Component, OnInit} from '@angular/core';
import { CrudComponent } from "@components/dev-tools/crud/crud.component";
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { MatDialogRef } from '@angular/material/dialog';
import { MessageService } from '@services/shared/notifications/message.service';
import {AppConfigService} from "src/app/utils/app-config.service";

@Component({
    selector: 'confirmation-pin',
    templateUrl: './confirmation-pin.component.html',
    styleUrls: ['./confirmation-pin.component.less'],
    standalone: false
})
export class ConfirmationPinComponent implements OnInit {
  public enteredPinCode: string = "";

  public gitCommit: string = "Loading...";
  public appVersion: string = "Loading...";

  constructor(
    private _bottomSheet: MatBottomSheet,
    public dialogRef: MatDialogRef<ConfirmationPinComponent>,
    private messageService: MessageService,
  ) { }

  ngOnInit() {
    AppConfigService.fetchGitHash().then(gitHash => {
      this.gitCommit = gitHash;
    });

    this.appVersion = AppConfigService.conf.app_version;
  }

  handleCancelDialog() {
    this.dialogRef.close();
  }

  public checkPinCode() {
    console.log(AppConfigService.conf.generic.dev_tools_pin_code);
    if (this.enteredPinCode == AppConfigService.conf.generic.dev_tools_pin_code) {
      this.enteredPinCode = "";
      this.handleCancelDialog();
      this._bottomSheet.open(CrudComponent);
    } else {
      this.messageService.add({summary: "Warning", detail: "Wrong pin code", severity: 'info'});
    }
  }
}



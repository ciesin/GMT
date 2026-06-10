import { Component } from "@angular/core";
import { MatDialogRef } from "@angular/material/dialog";


export type ExcludeDialogResult = "both" | "fp_only" | "outreach_only";

@Component({
    selector: 'gmt-exclude-dialog',
    templateUrl: 'exclude-dialog.component.html',
    styleUrls: ['./exclude-dialog.component.less'],
    standalone: false
})
export class ExcludeDialog {
  constructor(
    public dialogRef: MatDialogRef<ExcludeDialog>,
  ) {}


  handleExcludeDialog(result: ExcludeDialogResult) {
    this.dialogRef.close(result);
  }
}
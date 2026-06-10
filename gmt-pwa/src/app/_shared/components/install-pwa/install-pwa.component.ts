import { Component } from '@angular/core';
import { MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { PwaInstallationService } from "@services/pwa-installation.service";

@Component({
    selector: 'install-pwa',
    templateUrl: './install-pwa.component.html',
    styleUrls: ['./install-pwa.component.less'],
    standalone: false
})
export class InstallPwaComponent {

  constructor(
    private _bottomSheetRef: MatBottomSheetRef<InstallPwaComponent>,
    private pwaInstallService: PwaInstallationService,
  ) { }

  handleCancelDialog() {
    this._bottomSheetRef.dismiss();
  }

  public installPwa() {
    this.pwaInstallService.install();
  }
}



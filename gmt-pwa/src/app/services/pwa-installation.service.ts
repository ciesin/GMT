import { Injectable } from '@angular/core';
import { NGXLogger } from 'ngx-logger';
import { getHelpRoot, HELP_TAB_NAME } from "../_shared/help/help.component";
import { InstallPwaComponent } from "src/app/_shared/components/install-pwa/install-pwa.component";
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { AppConfigService } from "src/app/utils/app-config.service";

@Injectable({
  providedIn: 'root'
})
export class PwaInstallationService {
  private deferredPrompt: any = null;

  constructor(private logger: NGXLogger,
              private _bottomSheet: MatBottomSheet) {
  }

  onbeforeinstallprompt(e: any) {
    this.logger.info(e);
    //prevent default popup
    e.preventDefault();
    this.deferredPrompt = e;
  }

  isInstalled() {

    //https://github.com/novelt/GMT/issues/2271
    //note since the Install option only works on Chrome, we report the app as Installed on any non chrome browser

    if (!isChrome()) {
      return true;
    }

    let isInstalled = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
      // @ts-ignore
      || window.navigator.standalone // Fallback for iOS
      || sessionStorage.getItem('has_been_standalone_mode');
    if (this.deferredPrompt !== null) {
      isInstalled = false;
    }

    if (isInstalled) {
      sessionStorage.setItem('has_been_standalone_mode', 'true');
    }


    return isInstalled;
  }


  promptInstall() {
    //const bottomSheetRef =
    this._bottomSheet.open(InstallPwaComponent, { autoFocus: 'dialog' });
  }

  install() {
    if (this.deferredPrompt !== null) {
      console.log("Deferred prompt not null, prompting...");
      // Show the prompt
      this.deferredPrompt.prompt();
      // Wait for the user to respond to the prompt
      this.deferredPrompt.userChoice
        .then((choiceResult: any) => {
          if (choiceResult.outcome === 'accepted') {
            this.logger.info('User accepted the A2HS prompt');
            sessionStorage.setItem('has_been_standalone_mode', 'true');

            //close the existing dialog
            this._bottomSheet.dismiss();
          } else {
            this.logger.info('User dismissed the A2HS prompt');
          }
          this.deferredPrompt = null;
        });
    } else {
      console.log("Deferred prompt null, calling window.open");
      //blank is needed to open the PWA if it was already installed
      //From https://stackoverflow.com/questions/70925950/how-to-open-pwa-from-a-button-within-the-web-app
      //we need a target
      window.open("/", "_blank")
    }
  }
}
function isChrome() : boolean {
  // https://stackoverflow.com/questions/4565112/javascript-how-to-find-out-if-the-user-browser-is-chrome/13348618#13348618

  // please note,
  // that IE11 now returns undefined again for window.chrome
  // and new Opera 30 outputs true for window.chrome
  // but needs to check if window.opr is not undefined
  // and new IE Edge outputs to true now for window.chrome
  // and if not iOS Chrome check
  // so use the below updated condition

  // @ts-ignore
  var isChromium = window.chrome;
  var winNav = window.navigator;
  var vendorName = winNav.vendor;
  // @ts-ignore
  var isOpera = typeof window.opr !== "undefined";
  var isIEedge = winNav.userAgent.indexOf("Edg") > -1;
  var isIOSChrome = winNav.userAgent.match("CriOS");

  if (isIOSChrome) {
    // is Google Chrome on IOS
    return true;
  } else if(
    isChromium !== null &&
    typeof isChromium !== "undefined" &&
    vendorName === "Google Inc." &&
    isOpera === false &&
    isIEedge === false
  ) {
    // is Google Chrome
    return true;
  } else {
    // not Google Chrome
    return false;
  }
}

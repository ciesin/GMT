import { Component } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { MicroplanMapEventsService } from "src/app/services/map/MicroplanMapEventsService";

// @Component({
//   selector: 'show-single-catchment',
//   templateUrl: './show-single-catchment.component.html',
//   styleUrls: ['./show-single-catchment.component.less'],
//   providers: []
// })
// export class ShowSingleCatchmentComponent {
//   public singleCatchment: boolean = true;
//   // disabled if HF or outreach is not selected/in focus
//   public disabled: boolean = true;
//   public labelPosition: 'before' | 'after' = 'before';
//   private unsubscribe = new Subject();
//
//   constructor(private microplanMapEvents: MicroplanMapEventsService) {
//     // this.subscribeToHfSelection();
//   }
//
//   // handleSingleCatchmentChange(showSingleCatchment: boolean) {
//   //   this.singleCatchment = showSingleCatchment;
//   //   this.microplanMapEvents.setShowSingleCatchment(showSingleCatchment);
//   // }
//   //
//   // subscribeToHfSelection(){
//   //   this.microplanMapEvents.disableSingleCatchmentObs()
//   //     .pipe(takeUntil(this.unsubscribe))
//   //     .subscribe((disabledSingleCatchment: any) => {
//   //     this.disabled = disabledSingleCatchment;
//   //   });
//   // }
// }

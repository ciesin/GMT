import { CommonModule } from "@angular/common";
import { ChangeDetectionStrategy, Component, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { NGXLogger } from "ngx-logger";
import { MatModule } from "src/app/mat.module";
import { Unsubscribe } from "src/app/_shared/mixins/unsubscribe";
import { HfMapComponent } from "../hf-map/hf-map.component";
import { MobileMapComponent } from "../mobile-map/mobile-map.component";
import { OverviewMapComponent } from "../overview-map/overview-map.component";

export class BaseComponent {


    getLogger(): NGXLogger {
        throw new Error('Component must override this');
    }
}
//See comments in dataset-map.component.ts
const MixedComponent = Unsubscribe(BaseComponent);


@Component({
    selector: 'gmt-hf-map-loader',
    templateUrl: './hf-map-loader.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        FormsModule,
        MatModule,
        CommonModule,
        HfMapComponent,
        OverviewMapComponent,
    ],
	standalone: true
})
export class HfMapLoaderComponent extends MixedComponent implements OnInit {

    //Should load from url too
    boundaryGuid = "2e88e0bc-b108-446c-85c4-30ae5c05a843"
    hfGuid = "ce7eb496-19c1-4ba4-9b1e-492e18ffed3f"

    constructor(
        private logger: NGXLogger,
    ) {
        super();
    }
    override getLogger(): NGXLogger {
        return this.logger;
    }
    ngOnInit(): void {

    }
}

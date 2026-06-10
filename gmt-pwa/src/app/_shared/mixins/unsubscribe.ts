import { OnDestroy } from '@angular/core';
import { NGXLogger } from 'ngx-logger';
import { Subject } from 'rxjs';

// See comment in extent_listener
interface BaseClassRequirements {
    getLogger(): NGXLogger;
}

// Mixin definition
// eslint-disable-next-line @typescript-eslint/ban-types, @typescript-eslint/no-explicit-any
type Constructor<T = {}> = new (...args: any[]) => T;

export function Unsubscribe<TBase extends Constructor<BaseClassRequirements>>(
    Base: TBase,
) {
    return class extends Base implements OnDestroy {
        protected unsubscribe$ = new Subject<void>();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        constructor(...args: any[]) {
            super(...args);
        }
        ngOnDestroy() {
            this.getLogger().debug('ngOnDestroy in unsubscribe');
            // Emit a value, which causes any Observable using takeUntil(this.destroyed$) to complete
            this.unsubscribe$.next();
            this.unsubscribe$.complete();
        }

        getUnsubscribe(): Subject<void> {
            return this.unsubscribe$;
        }
    };
}

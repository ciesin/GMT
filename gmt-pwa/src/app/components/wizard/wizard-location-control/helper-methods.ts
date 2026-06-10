import { ElementRef } from '@angular/core';
import { MapEventsService } from '@services/map/base/map-events.service';
import { MicroplanMapEventsService } from '@services/map/MicroplanMapEventsService';
import * as _ from 'lodash';
import { NGXLogger } from 'ngx-logger';
import { BoundaryVectorLayersService } from 'src/app/services/boundary-vector-layers.service';
import { IsLoadingService } from 'src/app/services/is-loading.service';
import { UserContextService } from 'src/app/services/user-context.service';
import { CrudLayerService } from 'src/app/services/vector_layer/crud-layer.service';
import {
  GeoJsonCatchmentItem,
  GeoJsonSettlementName,
  GeoJsonSettlementPart,
} from 'src/app/utils/server-interfaces/GeoJson';
import { geometryIntersects } from 'src/app/utils/server-interfaces/utils/geom.util';
import { v4 as uuidv4 } from 'uuid';
import {
  addWizardCssClassToCdkOverlayWrapper,
  enableWizardsOverlay,
  switchWizardCssClass,
} from '../health-facility-wizard/health-facility-wizard.component';

const WINDOW_MARGIN = 10;
const LOCATOR_MARGIN = 30;

export interface WizardComponent {
  //remember if the left panel was opened or not
  leftPanelOpenedBeforeSetPoint: boolean;
  //Css variable to show/hide the list of steps in the header
  matStepperHeaderDisplay: string;
  //Used to get current size of the popup
  elementRef: ElementRef;
  //used to talk to left panel
  userContextService: UserContextService;

  //used to check geometry
  bvService: BoundaryVectorLayersService;

  crudLayerService: CrudLayerService;
  isLoadingService: IsLoadingService;

  mapEvents: MapEventsService;
  microplanMapEvents: MicroplanMapEventsService;

  logger: NGXLogger;
}

// export function ensureValidWizardPosition(me: WizardComponent) {

//     //we keep the wizards at the top
//     return;

//   const wizardRect = me.elementRef.nativeElement.getBoundingClientRect();
//   let [moveX, moveY] = [0, 0];
//   if (wizardRect.left < 0) {
//     moveX = -wizardRect.left + WINDOW_MARGIN;
//   }
//   if (wizardRect.bottom > window.innerHeight) {
//     moveY = window.innerHeight - (wizardRect.bottom + WINDOW_MARGIN);
//   }
//   if (wizardRect.top < 0) {
//     moveY = -wizardRect.top + WINDOW_MARGIN;
//   }
//   if (wizardRect.right > window.innerWidth) {
//     moveX = window.innerWidth - (wizardRect.right + WINDOW_MARGIN);
//   }
//   moveWizard(me, { moveX, moveY })
//   // const p = this.drag.getFreeDragPosition();
//   // this.drag.setFreeDragPosition({x: p.x + moveX, y: p.y + moveY})
// }

// export function moveWizardOutOftheWay(wizard: WizardComponent, target: HTMLElement) {
//   const targetRect: DOMRect = target.getBoundingClientRect();
//   const wizardRect: DOMRect = wizard.elementRef.nativeElement.getBoundingClientRect();

//   if (targetRect.left <= wizardRect.right
//     && targetRect.right >= wizardRect.left
//     && targetRect.top <= wizardRect.bottom
//     && targetRect.bottom >= wizardRect.top) {
//     // overlapping

//     const distanceToLeft = -(wizardRect.left - targetRect.right);
//     const distanceToRight = wizardRect.right - targetRect.left;
//     const distanceToTop = -(wizardRect.top - targetRect.bottom);
//     const distanceToBottom = wizardRect.bottom - targetRect.top;

//     const closestIndex = [distanceToTop, distanceToBottom, distanceToLeft, distanceToRight]
//       .reduce((acc, value, index, array) => array[acc] > value ? index : acc, 0);
//     switch (closestIndex) {
//       case 0:
//         moveWizard(wizard, { moveY: distanceToTop + LOCATOR_MARGIN });
//         break;
//       case 1:
//         moveWizard(wizard, { moveY: -(distanceToBottom + LOCATOR_MARGIN) });
//         break;
//       case 2:
//         moveWizard(wizard, { moveX: distanceToLeft + LOCATOR_MARGIN });
//         break;
//       case 3:
//         moveWizard(wizard, { moveX: -(distanceToRight + LOCATOR_MARGIN) });
//         break;
//     }
//   }
// }

// export function moveWizard(wizard: WizardComponent, { moveX = 0, moveY = 0 }) {
//   const p = wizard.drag.getFreeDragPosition();
//   wizard.drag.setFreeDragPosition({ x: p.x + moveX, y: p.y + moveY })
// }

export function enableMapFullScreen(me: WizardComponent) {
  //Disable routing in map
  me.mapEvents.emitInteractions(false);

  me.mapEvents.emitWizardMode(true);

  // hide app header
  (
    document.querySelector('mat-drawer-content > .header') as HTMLDivElement
  ).style.display = 'None';

  // This can hide the stepper
  // me.matStepperHeaderDisplay = "none";

  //Move the dialog to the upper right
  //How wide are we?
  /*
  const dialogWidth = me.elementRef.nativeElement.offsetWidth;
  const dialogHeight = me.elementRef.nativeElement.offsetHeight;

  //Move to 20 pixels from right edge
  const browserWindowWidth = window.innerWidth;
  const browserWindowHeight = window.innerHeight;

  //We can't use the host bind trick because the hostbinded css variables are scoped to this component, and we need to move the mat dialog

  //Move the center of the dialog to the right
  const moveDialogX: number = ((browserWindowWidth / 2) - (dialogWidth / 2) - 20);
  //Negative since moving up
  const moveDialogY: number = - ((browserWindowHeight / 2) - (dialogHeight / 2) - 20);



  const dialogPanel = window.document.getElementsByClassName("wizard-mat-dialog-panel");
  // (dialogPanel[0] as HTMLElement).style["transform"] = `translate3d(${moveDialogX}px, ${moveDialogY}px, 0px)`;
  */

  //And also hide the left pane
  me.leftPanelOpenedBeforeSetPoint =
    me.userContextService.leftPanelIsOpened.value;
  me.userContextService.leftPanelIsOpened.next(false);
}

export function disableMapFullScreen(me: WizardComponent) {
  me.mapEvents.emitInteractions(true);

  me.mapEvents.emitWizardMode(false);

  addWizardCssClassToCdkOverlayWrapper(false);

  //Default to user interaction
  switchWizardCssClass(false);

  //But we don't want the overlay to be enabled
  enableWizardsOverlay(false);

  // show app header
  (
    document.querySelector('mat-drawer-content > .header') as HTMLDivElement
  ).style.display = 'flex';

  //Show step header again
  //me.matStepperHeaderDisplay = "flex";

  //Change left panel to how it was
  me.userContextService.leftPanelIsOpened.next(
    me.leftPanelOpenedBeforeSetPoint
  );

  //Recenter wizard dialog
  //const dialogPanel = window.document.getElementsByClassName("wizard-mat-dialog-panel");
  //(dialogPanel[0] as HTMLElement).style.removeProperty("transform");
}

export function isInsideBoundary(
  me: WizardComponent,
  newLonLat: [number, number]
): boolean {
  const boundary = me.bvService.boundaryInfo.boundary;

  //Ensure it is within this boundary ?
  return geometryIntersects(boundary, {
    type: 'Point',
    coordinates: newLonLat,
  });
}

//Save all changes we need for complex, multistep changes
//This way we can wait until everything is calculated before changing anything
export interface SettlementChanges {
  namesToDelete: Array<GeoJsonSettlementName>;
  namesToUpdate: Array<GeoJsonSettlementName>;
  namesToCreate: Array<GeoJsonSettlementName>;

  partsToDelete: Array<GeoJsonSettlementPart>;
  partsToUpdate: Array<GeoJsonSettlementPart>;
  partsToCreate: Array<GeoJsonSettlementPart>;

  riToDelete: Array<GeoJsonCatchmentItem>;
}

export async function saveSettlementChanges(
  me: WizardComponent,
  changes: SettlementChanges,
  actionId: string | null = null
): Promise<boolean> {
  if (!actionId) {
    actionId = uuidv4();
  }

  const settlementPartsForUpdateCatchment: Array<GeoJsonSettlementPart> = [];

  for (const nameToDelete of changes.namesToDelete) {
    await me.crudLayerService.deleteItem(
      'settlement__name',
      nameToDelete.properties.global_id,
      false,
      false,
      actionId
    );
  }
  for (const nameToCreate of changes.namesToCreate) {
    await me.crudLayerService.createItem(
      'settlement__name',
      nameToCreate,
      false,
      false,
      actionId
    );
  }
  // for (const nameToUpdate of changes.namesToUpdate) {
  //   await me.crudLayerService.updateItem("settlement__name", nameToUpdate, false, false, actionId);
  // }
  await me.crudLayerService.bulkUpdateItem(
    'settlement__name',
    changes.namesToUpdate,
    false,
    false,
    actionId,
    false
  );

  for (const partToDelete of changes.partsToDelete) {
    await me.crudLayerService.deleteItem(
      'settlement__part',
      partToDelete.properties.global_id,
      false,
      false,
      actionId
    );

    //Also do a check to make sure any explicit includes that pointed to these settlement parts are switched
    await handleDeletedSettlementPart(me, changes, partToDelete, actionId);
  }
  for (const partToCreate of changes.partsToCreate) {
    await me.crudLayerService.createItem(
      'settlement__part',
      partToCreate,
      false,
      false,
      actionId
    );
    settlementPartsForUpdateCatchment.push(partToCreate);
  }

  await me.crudLayerService.bulkUpdateItem(
    'settlement__part',
    changes.partsToUpdate,
    false,
    false,
    actionId,
    false
  );

  for (const partToUpdate of changes.partsToUpdate) {
    settlementPartsForUpdateCatchment.push(partToUpdate);
  }

  await me.crudLayerService.bulkDeleteCatchmentItems(
    changes.riToDelete,
    false,
    actionId
  );

  await me.crudLayerService.updateObservableAfterCrud('settlement__part');
  await me.crudLayerService.updateObservableAfterCrud('settlement__name');
  await me.crudLayerService.updateObservableAfterCrud('ri__catchment_item');

  await me.bvService.computeAllCatchmentAssignments(
    settlementPartsForUpdateCatchment,
    actionId,
    new Set()
  );
  me.microplanMapEvents.triggerCatchmentRendering();

  return true;
}

//Also do a check to make sure any explicit includes/excludes that pointed to these settlement parts are switched
async function handleDeletedSettlementPart(
  me: WizardComponent,
  changes: SettlementChanges,
  partToDelete: GeoJsonSettlementPart,
  actionId: string
) {
  const ciList = (
    me.bvService.data.spToCiMap.get(partToDelete.properties.global_id) || []
  ).filter(
    (ci) =>
      ci.properties.type != 'generated' &&
      ci.properties.settlement_part == partToDelete.properties.global_id
  );

  if (ciList.length <= 0) {
    return;
  }

  me.logger.debug(
    `Moving existing settlement parts for deleted part ${partToDelete.properties.global_id}`
  );
  const snOfDeletedPart = me.bvService.data.getPrimaryNamesForSettlementPart(
    partToDelete.properties.global_id,
    false
  );

  if (snOfDeletedPart.length != 1) {
    me.logger.warn(
      `Expected 1 primary name for ${partToDelete.properties.global_id} but found ${snOfDeletedPart.length}`
    );
    return;
  }

  const sn = snOfDeletedPart[0];

  //find which of the new settlement parts intersect with the name
  const newIntersectingSps = changes.partsToCreate.filter((p) =>
    geometryIntersects(p.geometry, sn.geometry)
  );

  if (newIntersectingSps.length != 1) {
    me.logger.warn(
      `Expected 1 intersecting sp, but found ${newIntersectingSps.length}`
    );
    return;
  }

  me.logger.debug(
    'Updating include/exclude cis to point to new settlement part'
  );
  //now change the ci list to point to the new part
  for (const ciItem of ciList) {
    const newCiItem = _.cloneDeep(ciItem);
    newCiItem.properties.settlement_part =
      newIntersectingSps[0].properties.global_id;
    await me.crudLayerService.updateItem(
      'ri__catchment_item',
      newCiItem,
      false,
      false,
      actionId,
      false
    );
  }
}

interface BlockingUiComponent {
  crudLayerService: CrudLayerService;
  isLoadingService: IsLoadingService;
  microplanMapEvents: MicroplanMapEventsService;
}

/**
 * Common pattern of blocking the ui,
 * doing some calculations/crud actions,
 * then re-enabling
 * @param component
 * @param func
 * @param extraCleanup
 */
export async function callBlockingUiUntilDone(
  component: BlockingUiComponent,
  //should be an async function, use boolean to force use of async
  func: () => Promise<boolean>,
  triggerCatchmentRendering: boolean = true
): Promise<boolean> {
  let r = false;
  try {
    //Setting up loading before calling func
    component.isLoadingService.setLoading(true);
    component.crudLayerService.suppressUserInterfaceUpdates.next(true);
    r = await func();
  } finally {
    //Intentionally not catching exceptions.  Those should be seen by the user
    component.crudLayerService.suppressUserInterfaceUpdates.next(false);
    if (triggerCatchmentRendering) {
      //This needs to be after suppressUserInterfaceUpdates is done
      component.microplanMapEvents.triggerCatchmentRendering();
    }
    component.isLoadingService.setLoading(false);
  }

  return r;
}

export async function callBlockingUiUntilDoneWithCleanup(
  component: BlockingUiComponent,
  //should be an async function, use boolean to force use of async
  func: () => Promise<boolean>,
  extraCleanup: () => Promise<void>
): Promise<boolean> {
  let r = false;
  try {
    //Setting up loading before calling func
    component.crudLayerService.suppressUserInterfaceUpdates.next(true);
    component.isLoadingService.setLoading(true);
    r = await func();
  } finally {
    //Intentionally not catching exceptions.  Those should be seen by the user
    await extraCleanup();
    component.crudLayerService.suppressUserInterfaceUpdates.next(false);
    //This needs to be after suppressUserInterfaceUpdates is done
    component.microplanMapEvents.triggerCatchmentRendering();
    component.isLoadingService.setLoading(false);
  }

  return r;
}

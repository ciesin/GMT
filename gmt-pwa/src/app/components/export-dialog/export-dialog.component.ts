import { CommonModule } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    Inject,
    OnDestroy,
    OnInit,
    ViewChild,
    ViewContainerRef,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { DataExportService } from '@services/export/data-export.service';
import { BoundaryDataClass } from '@services/geo/BoundaryDataClass';
import { TreeNodeCheckable } from '@services/interfaces/boundary-tree.service.interface';
import { IsLoadingService } from '@services/is-loading.service';
import { IsOnlineService } from '@services/is-online.service';
import { BaselineService } from '@services/map/BaselineService';
import { ConfirmationService } from '@services/shared/notifications/confirmation.service';
import { AuthService } from '@services/user/auth.service';
import { VectorLayerService } from '@services/vector_layer/vector-layers.service';
import { Buffer } from 'exceljs';
import saveAs from 'file-saver';
import JSZip from 'jszip';
import _ from 'lodash';
import { NGXLogger } from 'ngx-logger';
import { GeoJSON } from 'ol/format';
import { PDFDocument } from 'pdf-lib';
import { TreeNode } from 'primeng/api';
import {
    filter,
    interval,
    Subscription,
    switchMap,
    take,
    takeUntil,
    timeout,
} from 'rxjs';
import { Unsubscribe } from 'src/app/_shared/mixins/unsubscribe';
import { MatModule } from 'src/app/mat.module';
import {
    createBoundaryExcel,
    createSingleExcel,
} from 'src/app/routine-immu/print-microplan/excel-export/workbook';
import {
    createRewExcelSheets,
    RewExportSheet,
} from 'src/app/routine-immu/print-microplan/rew-export/workbook';
import { AppConfigService } from 'src/app/utils/app-config.service';
import {
    createIndexDbDatabase,
    retrieveItem,
    storeItem,
} from 'src/app/utils/container';
import { saveFileName } from 'src/app/utils/export/pdf';
import { PdfBuilder } from 'src/app/utils/export/pdf-builder';
import {
    JobStatusResponse,
    JobStatusState,
} from 'src/app/utils/server-interfaces/JobStatus';
import { ExportOptions } from './export-options';
import { PdfDataService } from './pdf-maps/pdf-data-service';

export class BaseComponent {
  getLogger(): NGXLogger {
    throw new Error('Component must override this');
  }
}
//See comments in dataset-map.component.ts
const MixedComponent = Unsubscribe(BaseComponent);

const SINGLE_EXPORT_FILENAME = 'Microplan';

@Component({
  selector: 'gmt-export-dialog',
  templateUrl: './export-dialog.component.html',
  styleUrls: ['./export-dialog.component.less'],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatModule,
    CommonModule,
    //PdfDataService
  ],
})
export class ExportDialogComponent
  extends MixedComponent
  implements OnInit, OnDestroy
{
  wards: Array<TreeNodeCheckable> = [];

  includeImagery: boolean = false;

  //Export dialog options
  exportOptions: ExportOptions = new ExportOptions();

  settlementLabels = true;

  isOnline: boolean = true;
  onlineSubscription!: Subscription;

  // Progress
  printProgress: number = 0;
  printTasks: number = 0;
  printTasksDone: number = 0;

  public loggedIn: boolean | null = false;

  // Throttle settings
  private maxParallelPdfTasks: number = 2;

  private jsonReader: GeoJSON = new GeoJSON({
    dataProjection: `EPSG:${AppConfigService.map.data_projection}`,
    featureProjection: `EPSG:${AppConfigService.map.map_projection}`,
  });

  private debugIndexDb: IDBDatabase;
  private debugMapImageIndexDb: IDBDatabase;

  @ViewChild('dynamicContainer', { read: ViewContainerRef })
  container!: ViewContainerRef;
  //componentRef!: ComponentRef<HfMapComponent>;

  constructor(
    @Inject(MAT_DIALOG_DATA) private data: { wards: Array<TreeNodeCheckable> },
    private isOnlineService: IsOnlineService,
    private authService: AuthService,
    private loadingService: IsLoadingService,
    private vectorLayerService: VectorLayerService,
    private baselineService: BaselineService,
    private dataExportService: DataExportService,
    private confirmationService: ConfirmationService,
    private logger: NGXLogger,
    private dialogRef: MatDialogRef<ExportDialogComponent>,
    private pdfDataService: PdfDataService
  ) {
    super();
    this.onlineSubscription = this.isOnlineService
      .isOnlineStream()
      .pipe(takeUntil(this.unsubscribe$))
      .subscribe((isOnline) => {
        this.isOnline = isOnline as boolean;
      });
    if (!this.data.wards) {
      throw new Error('Missing wards in export dialog injected data');
    }
  }

  override getLogger(): NGXLogger {
    return this.logger;
  }

  async ngOnInit() {
    this.wards = this.data.wards;
    if (AppConfigService.ENABLE_PDF_DEBUG_CACHE) {
      this.debugIndexDb = await createIndexDbDatabase('print-microplans');
    }
    if (AppConfigService.ENABLE_PDF_DEBUG_MAP_IMAGE_CACHE) {
      this.debugMapImageIndexDb = await createIndexDbDatabase('pdf-map-images');
    }
    this.authService
      .loggedIn()
      .pipe(takeUntil(this.unsubscribe$))
      .subscribe((loggedIn: boolean | null) => {
        this.loggedIn = loggedIn;
      });

    if (AppConfigService.ENABLE_EXPORT_REW_DEBUG) {
      this.exportOptions.generateExcel = false;
      this.exportOptions.generateRew = true;
      this.exportOptions.boundariesSingle = true;
    }
    if (AppConfigService.ENABLE_EXPORT_DEBUG) {
      this.exportOptions.boundariesSingle = true;
      this.exportOptions.generatePdf = false;
      this.exportOptions.generateExcel = false;
      this.exportOptions.generateExcelServerSide = true;
      this.exportOptions.generateRewServerSide = true;
      this.exportOptions.generateRew = false;
      this.exportOptions.hfPage = false;
    }
  }

  getWardHierarchy(ward: TreeNodeCheckable): Array<string> {
    let parent: TreeNodeCheckable = ward.parent!;
    const hierarchy: Array<string> = [];
    while (parent) {
      hierarchy.unshift(parent.label);
      parent = parent.parent!;
    }
    return hierarchy;
  }

  override ngOnDestroy(): void {
    super.ngOnDestroy();
  }

  addTasks(taskCount: number): void {
    this.printTasks += taskCount;
  }

  resetTasks(): void {
    this.printProgress = 0;
    this.printTasks = 0;
    this.printTasksDone = 0;
  }

  updateTasks(taskCount: number): void {
    this.printTasksDone += taskCount;
    this.printProgress = Math.min(
      Math.round((this.printTasksDone / this.printTasks) * 100),
      100
    );
    this.logger.info(`==> PDF Export ${this.printProgress}% done ...`);
  }

  reportProgress(percentage: number) {
    this.logger.info(`--> ${percentage}% pages rendered!`);
  }

  private buildParentAndBoundaryNodes(): [
    Array<TreeNodeCheckable>,
    Array<TreeNodeCheckable>
  ] {
    const parentNodes: Array<TreeNodeCheckable> = [];
    const boundaryNodes: Array<TreeNodeCheckable> = [];

    const parentLevel =
      AppConfigService.conf.generic.operational_boundary_level - 1;

    for (const n of this.wards) {
      //We ignore nodes of level higher than parent, because the children should be in the selected set
      if (n.level == parentLevel && !parentNodes.includes(n)) {
        parentNodes.push(n);
        //Children nodes should already be selected, because checking the parent should have done so
      } else if (
        n.level === AppConfigService.conf.generic.operational_boundary_level &&
        !boundaryNodes.includes(n)
      ) {
        boundaryNodes.push(n);
        if (n.parent && !parentNodes.includes(n.parent)) {
          parentNodes.push(n.parent);
        }
      }
    }

    return [parentNodes, boundaryNodes];
  }

  /**
   * Returns only parent selected nodes. FOr example If admin3 is selected,
   * it will be added to the list, but if it's parent is also selected, then only parent will be returned
   * @private
   */
  private getHierarchicalSelectedNodes(): Array<string> {
    const parentSelectedNodes: Set<string> = new Set();

    for (const selectedNode of this.wards) {
      let parentNode = '';
      parentSelectedNodes.add(
        findCheckedParentRecursive(parentNode, selectedNode)
      );
    }

    return Array.from(parentSelectedNodes);
  }

  close() {
    this.dialogRef.close();
  }

  async handleExportClicked() {
    this.loadingService.setProgressBarInfo(
      'Generating documents for printing...',
      1,
      true,
      2
    );

    //Need the dynamic container to stick around...
    // Close dialog
    //this.close();

    // async
    if (
      this.exportOptions.gdbExport ||
      this.exportOptions.generateExcelServerSide
    ) {
      //This will also call exportDocuments as needed
      this.triggerServerSideDataExport().then();
    } else {
      await this.exportDocuments();
    }
  }

  /*
    This handles everything except the GDB export, so

    * spreadsheet export
    * REW spreadsheet export
    * Pdf
    */
  private async exportDocuments() {
    // Show progress spinner
    this.loadingService.setLoading(true);

    // Get all related LGA and Boundary nodes
    const [parentNodes, boundaryNodes] = this.buildParentAndBoundaryNodes();

    // avoid downloading data when it is not needed
    if (!this.exportOptions.atLeastOneDocumentExportSelected) {
      this.loadingService.setProgressBarInfo(
        'Generating documents for printing...',
        100,
        false,
        2
      );
      this.loadingService.setLoading(false);
      return;
    }

    this.logger.info(
      `buildParentAndBoundaryNodes done.  len parentNodes: ${parentNodes.length} len boundaryNodes ${boundaryNodes.length} selected nodes`,
      this.wards
    );

    this.loadingService.setProgressBarInfo(
      'Generating documents for printing...',
      5,
      true,
      2
    );
    // Generate PDF documents
    try {
      // 1) Reset progress/counters and calculate how many tasks we have to perform

      const boundaryGuidsToLoad = await this.printInitTasks(boundaryNodes);

      this.logger.info(
        `printInitTasks done.  Loading : ${boundaryGuidsToLoad.length} boundaries`
      );

      // 2) Gather boundary data from indexdb or from API. The result is a dictionary with vector sources per boundary and schema
      const allBoundaryData = await this.printGatherBoundaryData(
        boundaryGuidsToLoad
      );

      if (null == allBoundaryData) {
        return;
      }
      this.loadingService.setProgressBarInfo(
        'Generating documents for printing...',
        10,
        true,
        2
      );
      this.logger.info(`printGatherBoundaryData done.`, allBoundaryData);

      const boundaryIds: Array<string> = boundaryNodes
        .map((boundaryNode) => boundaryNode.data.global_id)
        .filter((bId) => allBoundaryData.has(bId));

      boundaryIds.sort((b1, b2) =>
        allBoundaryData
          .get(b1)!
          .bMap.get(b1)!
          .properties.name.localeCompare(
            allBoundaryData.get(b2)!.bMap.get(b2)!.properties.name
          )
      );

      const excelSpreadsheets = this.exportOptions.boundariesSingle
        ? await createBoundaryExcel(allBoundaryData, boundaryIds, this.logger)
        : await createSingleExcel(allBoundaryData, boundaryIds, this.logger);

      //For the REWs regardless of the boundaries single option, we have 1 excel per HF
      const rewSheets = new Map();
      if (this.exportOptions.generateRew) {
        await createRewExcelSheets(
          allBoundaryData,
          boundaryIds,
          this.logger,
          rewSheets
        );
      }

      this.loadingService.setProgressBarInfo(
        'Generating documents for printing...',
        20,
        true,
        2
      );

      // 3) Create boundary pages (parallel)
      const boundaryPages = await this.printCreateBoundaryPages(
        allBoundaryData,
        boundaryIds
      );
      this.loadingService.setProgressBarInfo(
        'Generating documents for printing...',
        70,
        true,
        2
      );

      //console.assert(excelSpreadsheets.length == boundaryPages.length);
      await this.createExportPerBoundary(
        boundaryIds,
        allBoundaryData,
        boundaryPages,
        excelSpreadsheets,
        rewSheets
      );
      this.loadingService.setProgressBarInfo(
        'Generating documents for printing...',
        90,
        true,
        2
      );

      // Set loading to false when done
      this.loadingService.setLoading(false);
      this.loadingService.setProgressBarInfo(
        'Generating documents for printing...',
        100,
        false,
        2
      );
    } catch (error) {
      this.logger.info(error);
      // Remove progress spinner
      this.loadingService.setLoading(false);
    }
  }

  /*
    Returns boundary ids to load
    */
  private async printInitTasks(
    //lgaNodes: Array<TreeNode>,
    boundaryNodes: Array<TreeNode>
  ): Promise<Array<string>> {
    this.resetTasks();
    const boundaryGuidsToLoad: string[] = [];

    boundaryNodes.forEach((boundaryNode) => {
      // Get data from indexdb
      boundaryGuidsToLoad.push(boundaryNode.data.global_id);
    });
    const boundaryCount = boundaryGuidsToLoad.length;

    //Miight get rid of tasks...
    boundaryNodes.forEach((boundaryNode) => {
      this.addTasks(1); // Boundary page
      this.addTasks(1); // Page merging or zipping
      if (this.exportOptions.hfPage) {
        this.addTasks(boundaryNode.children?.length || 0); // HF pages per boundary
      }
    });

    this.addTasks(this.exportOptions.boundariesSingle ? boundaryCount : 1); // Page enumeration

    this.logger.info('==> PDF Tasks to perform:', this.printTasks);

    return boundaryGuidsToLoad;
  }

  private async printGatherBoundaryData(
    boundaryGuidsToLoad: Array<string>
  ): Promise<Map<string, BoundaryDataClass>> {
    //key is a boundary id
    const allBoundaryData = new Map<string, BoundaryDataClass>();

    for (const bGuid of boundaryGuidsToLoad) {
      const bd = await this.pdfDataService.getBoundaryData(bGuid, true);
      allBoundaryData.set(bGuid, bd);
    }

    return allBoundaryData;
  }

  private async printCreateBoundaryPages(
    allBoundaryData: Map<string, BoundaryDataClass>,
    boundaryIds: Array<string>
  ): Promise<Array<PDFDocument | null>> {
    this.logger.info(`Creating pdfs for ${boundaryIds.length} boundaries`);

    if (!this.exportOptions.generatePdf) {
      return boundaryIds.map((_boundaryId) => {
        return null;
      });
    }

    const pdfPromises: Array<Promise<PDFDocument | null>> = [];

    let progressBarPercentage = 20;
    let progressBarPercentageStep =
      50 / (boundaryIds.length > 0 ? boundaryIds.length : 1);
    for (const boundaryId of boundaryIds) {
      if (AppConfigService.ENABLE_PDF_DEBUG_CACHE) {
        this.logger.info(`Checking pdf cache for ${boundaryId}`);
        const pdfData: Uint8Array | null = await retrieveItem(
          boundaryId,
          this.debugIndexDb
        );

        if (pdfData != null) {
          pdfPromises.push(PDFDocument.load(pdfData));
          continue;
        }
      }

      const boundaryData = allBoundaryData.get(boundaryId)!;

      const pdfBuilder = new PdfBuilder(
        boundaryData,
        boundaryId,
        this.pdfDataService,
        this.logger,
        this.container,
        this.debugMapImageIndexDb,
        this.exportOptions,
        this.updateTasks
      );

      // Create the boundary document
      let createBoundaryPromise = pdfBuilder.createBoundaryDocument();
      createBoundaryPromise.then(() => {
        progressBarPercentage += progressBarPercentageStep;
        this.loadingService.setProgressBarInfo(
          'Generating documents for printing...',
          progressBarPercentage,
          true,
          2
        );
      });
      pdfPromises.push(createBoundaryPromise);

      if (AppConfigService.ENABLE_PDF_DEBUG_CACHE) {
        this.logger.info(`Storing pdf cache for ${boundaryId}`);
        const pdf = await pdfPromises[pdfPromises.length - 1];
        const pdfData = await pdf!.save();
        await storeItem(boundaryId, pdfData, this.debugIndexDb);
      }
    }

    return await Promise.all(pdfPromises);
  }

  //Note the arrays are all in the same order
  private async createExportPerBoundary(
    boundaryIds: Array<string>,
    allBoundaryData: Map<string, BoundaryDataClass>,
    boundaryPages: Array<PDFDocument | null>,
    excelSpreadsheets: Array<Buffer>,
    rewSheets: Map<string, Array<RewExportSheet>>
  ) {
    //Special case where we don't need a zip
    if (
      this.exportOptions.onlyExcelExport &&
      this.exportOptions.boundariesSingle
    ) {
      console.assert(!this.exportOptions.generateRew);
      //Just the spreadsheet with all the boundaries
      const blob = new Blob([excelSpreadsheets[0]], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      saveAs(blob, saveFileName(`${SINGLE_EXPORT_FILENAME}.xlsx`));

      return;
    }

    //Only 1 pdf
    if (
      this.exportOptions.onlyPdfExport &&
      boundaryPages.length == 1 &&
      !_.isNil(boundaryPages[0])
    ) {
      const pdfBytes = await boundaryPages[0].save();
      saveAs(
        new Blob([pdfBytes as BlobPart]),
        saveFileName(`${SINGLE_EXPORT_FILENAME}.pdf`)
      );
      return;
    }

    const zip = new JSZip();
    const pdfPromises: Array<Promise<Uint8Array | null>> = [];

    let progressBarPercentage = 70;
    let progressBarPercentageStep =
      20 / (boundaryIds.length > 0 ? boundaryIds.length : 1);

    if (
      !this.exportOptions.boundariesSingle &&
      this.exportOptions.generateExcel
    ) {
      const xlsxBlob = new Blob([excelSpreadsheets[0]], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

      zip.file(saveFileName(`${SINGLE_EXPORT_FILENAME}.xlsx`), xlsxBlob);
    }

    for (const [bIdx] of boundaryIds.entries()) {
      const pdfData = boundaryPages[bIdx];
      if (!pdfData) {
        pdfPromises.push(Promise.resolve(null));
        continue;
      }

      this.updateTasks(1);
      pdfPromises.push(pdfData.save());
      progressBarPercentage += progressBarPercentageStep;
      this.loadingService.setProgressBarInfo(
        'Generating documents for printing...',
        progressBarPercentage,
        true,
        2
      );
    }

    const pdfArrays: Array<Uint8Array | null> = await Promise.all(pdfPromises);

    for (const [bIdx, boundaryId] of boundaryIds.entries()) {
      const excelBuffer = excelSpreadsheets[bIdx];

      const boundaryData = allBoundaryData.get(boundaryId);

      if (_.isNil(boundaryData)) {
        throw new Error('boundaryData null');
      }

      const bNames = boundaryData.getBoundaryLabels(boundaryId);
      //lga / ward
      const dirs = `${bNames[1]}/${bNames[2]}/`;

      const boundaryName = boundaryData.bMap.get(boundaryId)!.properties.name;

      const pdfBytes = pdfArrays[bIdx];

      //This will happen if we don't generate the pdfs
      if (pdfBytes) {
        zip.file(
          dirs + `${saveFileName(boundaryName)}_${SINGLE_EXPORT_FILENAME}.pdf`,
          new Blob([pdfBytes as BlobPart])
        );
      }

      if (
        this.exportOptions.generateExcel &&
        this.exportOptions.boundariesSingle
      ) {
        const xlsxBlob = new Blob([excelBuffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });

        zip.file(
          dirs + `${saveFileName(boundaryName)}_${SINGLE_EXPORT_FILENAME}.xlsx`,
          xlsxBlob
        );
      }

      if (this.exportOptions.generateRew) {
        const rewSheetsArray = rewSheets.get(boundaryId);
        if (!_.isArray(rewSheetsArray)) {
          continue;
        }
        const bNames = boundaryData.getBoundaryLabels(boundaryId);

        for (const rew of rewSheetsArray) {
          const sName = `${dirs}${rew.fileName}`;
          const xlsxBlob = new Blob([rew.excelData], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          });

          zip.file(sName, xlsxBlob);
        }
      }

      this.updateTasks(1);
    }
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    saveAs(zipBlob, saveFileName(`${SINGLE_EXPORT_FILENAME}.zip`));
  }

  private async handleServerSideDataExport() {
    // together export pdf and excel documents if needed
    await this.exportDocuments();

    const boundaryIds: Array<string> = this.getHierarchicalSelectedNodes();
    let jobId = await this.dataExportService.submitDataExportRequest(
      boundaryIds,
      this.exportOptions.gdbExport,
      this.exportOptions.generateExcelServerSide,
      this.exportOptions.generateRewServerSide,
      this.exportOptions.boundariesSingle
    );

    if (jobId == -1) {
      this.loadingService.setLoading(false);

      return;
    }
    // Create an Observable that emits every 5 seconds
    interval(5000)
      .pipe(
        switchMap(() => this.dataExportService.getExportJobStatus(jobId)),

        // Filter only the successful http responses
        filter((data: JobStatusResponse) => {
          this.logger.info(JSON.stringify(data));
          return [JobStatusState.completed, JobStatusState.failed].includes(
            data?.state
          );
        }),

        // Emit only the first value emitted by the source
        take(1),

        // Time out after 20 minutes
        timeout(1.2e6)
      )
      .subscribe(
        async (result: JobStatusResponse) => {
          // ResponseModel<any>

          if ([JobStatusState.completed].includes(result?.state)) {
            this.dataExportService.downloadDataExport(jobId);
            this.logger.info('Data download done');
          } else {
            this.logger.error('Data download failed');

            //this.loadingService.setLoading(false);
            throw new Error('Something failed while downloading data.');
          }
        },
        (error) => {
          this.logger.info('Error: ' + error);
        }
      );
  }

  private async triggerServerSideDataExport() {
    this.confirmationService.confirm({
      message: `\
Note that this export may take time.

You will receive an email once the export is ready.
Please beware that you can have one export running at any given time.

If you require several exports at once, please combine them by selecting all of the Wards/LGAs/States required.
Also, note that you should sync any current changes for the exported data to be up to date.`,
      header: `Information`,
      icon: 'noicon',
      rejectLabel: 'Cancel',
      acceptLabel: 'Ok',
      showRejectButton: true,
      accept: async () => {
        //we keep dialog open only for doc. export because view container is needed for maps
        if (!this.exportOptions.atLeastOneDocumentExportSelected) {
          this.close();
        }

        await this.handleServerSideDataExport();
      },
      reject: async () => {
        //Do nothing (before this still generated client side one)
        this.close();
      },
    });
  }
  indentifyWard(index: number, ward: TreeNodeCheckable) {
    return ward.global_id;
  }
}

function findCheckedParentRecursive(
  parentNode: string,
  selectedNode: TreeNodeCheckable
) {
  parentNode = selectedNode.data.global_id;
  if (selectedNode.parent?.checked === true) {
    parentNode = findCheckedParentRecursive(parentNode, selectedNode.parent);
  }
  return parentNode;
}

const HF_INDEX_SORT_REGEX = /^(\d*)(\D*)$/;

export function compareHfIndex(index1: string, index2: string): number {
  //this.logger.info(`Sorting [${hf1.properties.index}] and [${hf2.properties.index}]`);
  const [, numStr1, outreachStr1] = Array.from(
    HF_INDEX_SORT_REGEX.exec(index1)!
  );
  const [, numStr2, outreachStr2] = Array.from(
    HF_INDEX_SORT_REGEX.exec(index2)!
  );

  const num1 = parseInt(numStr1);
  const num2 = parseInt(numStr2);

  //Sort 1st by Fixed post number
  if (num1 != num2) {
    return num1 - num2;
  }

  const lenOs1 = outreachStr1.length;
  const lenOs2 = outreachStr2.length;

  //aa is after a, bac as after any 2 letters
  if (lenOs1 != lenOs2) {
    return lenOs1 - lenOs2;
  }

  return outreachStr1.localeCompare(outreachStr2);
}

export class ExportOptions {
  //If true,  one excel export per boundary
  private _boundariesSingle: boolean = false;
  //map settings
  //generate map
  private _generatePdf: boolean = false;
  //1 page per hf
  private _hfPage: boolean = false;

  //Data settings checkboxses

  //boundary level summaries/stats
  private _generateExcel: boolean = false;

  private _generateExcelServerSide: boolean = true;

  // export gdb
  private _gdbExport: boolean = false;
  //Note these are also excel but is seperate from the excel export
  private _generateRew: boolean = false;

  private _generateRewServerSide = false;

  private _addMobile: boolean = true;

  get addMobile(): boolean {
    return this._addMobile;
  }

  set addMobile(value: boolean) {
    this._addMobile = value;
  }

  // Getter and Setter for boundariesSingle
  get boundariesSingle(): boolean {
    return this._boundariesSingle;
  }

  set boundariesSingle(value: boolean) {
    this._boundariesSingle = value;

    if (value) {
      this._generateExcelServerSide = true;
    }
  }

  // Getter and Setter for generatePdf
  get generatePdf(): boolean {
    return this._generatePdf;
  }

  set generatePdf(value: boolean) {
    this._generatePdf = value;
    if (!value) {
      this.hfPage = false;
    }
  }

  // Getter and Setter for hfPage
  get hfPage(): boolean {
    return this._hfPage;
  }

  set hfPage(value: boolean) {
    this._hfPage = value;
    if (value) {
      this._generatePdf = true;
    }
  }

  // Getter and Setter for generateExcel
  get generateExcel(): boolean {
    return this._generateExcel;
  }

  set generateExcel(value: boolean) {
    
    this._generateExcel = value;
  }

  get generateExcelServerSide(): boolean {
    return this._generateExcelServerSide;
  }

  set generateExcelServerSide(value: boolean) {
    
    if (!value) {
      this._boundariesSingle = false;
    }
    this._generateExcelServerSide = value;
  }


  get generateRewServerSide(): boolean {
    return this._generateRewServerSide;
  }

  set generateRewServerSide(value: boolean) {
    if (value) {
      this.generateRew = false;
    }
    this._generateRewServerSide = value;
  }

  // Getter and Setter for gdbExport
  get gdbExport(): boolean {
    return this._gdbExport;
  }

  set gdbExport(value: boolean) {
    this._gdbExport = value;
  }

  // Getter and Setter for generateRew
  get generateRew(): boolean {
    return this._generateRew;
  }

  set generateRew(value: boolean) {
    this._generateRew = value;
  }

  //A document the browser can open
  get atLeastOneDocumentExportSelected(): boolean {
    return this.generatePdf || this.generateRew || this.generateExcel  ;
  }

  get atLeastOneDataExportSelected(): boolean {
    return (
      this.atLeastOneDocumentExportSelected ||
      this.gdbExport ||
      this.generateExcelServerSide ||
      this.generateRewServerSide 

    );
  }

  get onlyExcelExport(): boolean {
    return (
      !this.generatePdf &&
      !this.generateRew &&
      this.generateExcel &&
      !this.gdbExport
    );
  }

  get onlyPdfExport(): boolean {
    return (
      this.generatePdf &&
      !this.generateRew &&
      !this.generateExcel &&
      !this.gdbExport
    );
  }
}

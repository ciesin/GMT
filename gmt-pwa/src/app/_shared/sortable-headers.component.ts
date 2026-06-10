import {Component, EventEmitter, Input, OnInit, Output, TemplateRef} from "@angular/core";

interface ColumnSorted {
  name: string,
  ascending: boolean
}

@Component({
    selector: 'sortable-headers',
    template: `
    <ng-container *ngFor="let col of columns">
      <div [class]="'col '+col.classZ" (click)="col.sort && toggleSort(col.name)">
        <ng-container *ngIf="col.sort">
          <div class="arrows">
            <img src="assets/icons/arrow-up.svg"
                 [class.selected]="isSortIconSelected(col.name,true)">
            <img src="assets/icons/arrow-down.svg"
                 [class.selected]="isSortIconSelected(col.name, false)">
          </div>
        </ng-container>
        <ng-container [ngTemplateOutlet]="col.template"></ng-container>
      </div>
    </ng-container>
  `,
    styles: [`
    @import "src/shared";
    :host {
      display: flex;
      align-items: center;
      column-gap: 1rem;

      .col {
        display: flex;
        align-items: center;

        .arrows {
          .arrows();
        }
      }
    }`],
    standalone: false
})
export class SortableHeadersComponent implements OnInit {

  @Input() templates: { [name: string]: TemplateRef<any> }
  //Could be enum or string array
  @Input() colNames: any
  names: string[] = []
  @Output() onSort  = new EventEmitter<ColumnSorted>();

  public columns: {
    name: string,
    template: TemplateRef<any>,
    sort: boolean,
    classZ: string,
  }[] = [];

  columnSorted: ColumnSorted;

  ngOnInit(): void {

    if (Array.isArray(this.colNames)){
      this.colNames.forEach(name => {
        if (typeof name === 'string')
          this.names.push(name);
      })
    }else{
      Object.values(this.colNames).forEach(name => {
        if (typeof name === 'string')
          this.names.push(name);
      })
    }

    Object.entries(this.templates).forEach(([name, template]) => {
      this.columns.push({
        name,
        template,
        sort: this.names.includes(name),
        classZ: name.toLowerCase(),
      })
    });
    if (this.columns.length > 0)
    this.columnSorted = {
        name: this.columns[0].name,
        ascending: true
    }
  }

  isSortIconSelected(columnName: string, order: boolean) {
    return this.columnSorted.name === columnName && this.columnSorted.ascending === order;
  }

  toggleSort(columnName: string) {
    if (this.columnSorted.name === columnName) {
      this.columnSorted.ascending = !this.columnSorted.ascending;
    } else {
      this.columnSorted.name = columnName;
      this.columnSorted.ascending = true;
    }
    this.onSort.emit(this.columnSorted);
  }

}

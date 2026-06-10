import { CommonModule, JsonPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Input,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
//import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import _ from 'lodash';
import { formatPopulation } from 'src/app/utils/string-formatting';

interface Data {
  jsonVisible: boolean;
  data: object;
}

@Component({
  selector: 'able-json-table',
  templateUrl: './json-table.component.html',
  styleUrls: ['./json-table.component.less'],
  standalone: true,
  imports: [
    MatSelectModule,
    MatFormFieldModule,
    ReactiveFormsModule,
    JsonPipe,
    CommonModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JsonTableComponent implements OnChanges {
  @Input() colList: Array<string> = [];
  @Input() data: Array<object> = [];

  sortKey: string = '';
  sortedData: Array<Data> = [];
  sortAsc = true;

  detailsVisible: Array<boolean> = [];
  otherData: Array<object> = [];

  constructor(private cdr: ChangeDetectorRef) {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes.data) {
      this.sortedData = this.data.map((data) => {
        return {
          data,

          jsonVisible: false,
        };
      });
      this.detailsVisible = this.sortedData.map(() => false);
    }
  }

  private sortData() {
    if (this.sortKey) {
      this.sortedData.sort((a, b) => {
        const aVal = a.data[this.sortKey] ?? '';
        const bVal = b.data[this.sortKey] ?? '';
        return this.sortAsc
          ? aVal.toString().localeCompare(bVal.toString())
          : bVal.toString().localeCompare(aVal.toString());
      });
    }
  }

  toggleSort(col: string) {
    if (this.sortKey === col) {
      this.sortAsc = !this.sortAsc;
    } else {
      this.sortKey = col;
      this.sortAsc = true;
    }

    this.sortData();
  }

  showOther(row: Data) {
    row.jsonVisible = !row.jsonVisible;
    this.cdr.detectChanges();
  }

  formatCol(col: string) {
    const cols = col.split('.');
    return cols[cols.length - 1];
  }

  formatValue(row: Data, col: string): string {
    let value = row.data[col];
    if (col.includes('.')) {
      const cols = col.split('.');
      value = row.data[cols[0]];
      for (const c of cols.slice(1)) {
        value = value[c];
      }
    }
    if (col.includes('pop')) {
      return formatPopulation(value);
    }
    if (_.isNumber(value)) {
      return _.round(value, 2).toLocaleString();
    }

    return value;
  }
}

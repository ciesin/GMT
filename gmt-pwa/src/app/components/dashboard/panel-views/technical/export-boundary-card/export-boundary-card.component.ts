import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnInit, Output, ViewChild } from '@angular/core';
import { MatCheckbox, MatCheckboxChange } from '@angular/material/checkbox';
import { TreeNodeCheckable } from '@services/interfaces/boundary-tree.service.interface';
import { mixedSelection, selection } from '../technical.component';

@Component({
    selector: 'export-boundary-card',
    templateUrl: './export-boundary-card.component.html',
    styleUrls: ['./export-boundary-card.component.less'],
    standalone: false
})
export class ExportBoundaryCardComponent implements OnInit {
  @Input() node: TreeNodeCheckable;
  @Input() checked: selection | mixedSelection;
  @Output() select: EventEmitter<{ global_id: string, select: boolean }> = new EventEmitter();
  @Output() drillDown: EventEmitter<string> = new EventEmitter();

  @ViewChild('checkbox') checkbox: MatCheckbox;

  public hierarchy: string[] = [];
  public canDrillDown: boolean;

  ngOnInit(): void {
    // get hierarchy
    let parent = this.node.parent;
    while (parent) {
      this.hierarchy.unshift(parent.label);
      parent = parent.parent;
    }

    // has sub level boundaries ?
    this.canDrillDown = this.node.children?.at(0)?.data.type === 'boundary';
  }

  public checkedChanged(event: MatCheckboxChange) {
    // console.log('checkbox event', event.checked, this.checked);
    // if (!event.checked) {
    //   if (this.checked === 'all-mixed') {
    //     this.checkbox.indeterminate = true;
    //   }
    // }

    this.select.emit({
      global_id: this.node.global_id,
      select: event.checked
    });
  }

  handleBoundaryClick(global_id: string) {
    if (this.canDrillDown) {
      this.drillDown.emit(global_id);
    } else {
      this.checkbox._onInputClick();
    }
  }
}

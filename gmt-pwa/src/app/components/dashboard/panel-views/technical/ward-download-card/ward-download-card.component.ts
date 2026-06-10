import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { TreeNodeCheckable } from '@services/interfaces/boundary-tree.service.interface';
import { RoutesChunks } from 'src/app/constants/routing.enum';
import { routeFromChunks } from 'src/app/utils/route-helper';

@Component({
    selector: 'ward-download-card',
    templateUrl: './ward-download-card.component.html',
    styleUrls: ['./ward-download-card.component.less'],
    standalone: false
})
export class WardDownloadCardComponent implements OnInit {
  @Input() node: TreeNodeCheckable;
  @Input() modified: boolean;
  @Output() removeOfflineData: EventEmitter<string> = new EventEmitter();
  
  public hierarchy: string[] = [];

  ngOnInit(): void {
    let parent = this.node.parent;
    while (parent) {
      this.hierarchy.unshift(parent.label);
      parent = parent.parent;
    }
  }

  immunizationRoute(id: string) {
    return routeFromChunks([RoutesChunks.ROUTINE_IMMUNIZATION, id], true);
  }
}

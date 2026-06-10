import { COMMA, ENTER } from '@angular/cdk/keycodes';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { MatChipEditedEvent, MatChipInputEvent } from '@angular/material/chips';
import { MessageService } from "src/app/services/shared/notifications/message.service";

@Component({
    selector: 'gmt-wizard-list-control',
    templateUrl: './wizard-list-control.component.html',
    styleUrls: ['./wizard-list-control.component.less'],
    standalone: false
})
export class WizardListControlComponent {
  @Input() listItems: Array<string> = [];
  @Output() listItemsOutput =new EventEmitter<Array<string>>();
  @Input() label: string = "";
  @Input() canEdit: boolean = true;
  addOnBlur = true;
  readonly separatorKeysCodes = [ENTER, COMMA] as const;
  constructor(private messageService: MessageService) { }

  add(event: MatChipInputEvent): void {
    const value = (event.value || '').trim();
    if (this.listItems.includes(value)) {
      this.messageService.add({
        summary: `Name ${value} has already been added`,
        severity: "error",
        key: 'small', life: 2000
      });
      return;
    }
    // Add a string
    if (value) {
      this.listItems.push(value);
      this.listItemsOutput.emit(this.listItems);
    }
    // Clear the input value
    event.chipInput!.clear();
  }

  remove(index: number): void {
    if (index >= 0) {
      this.listItems.splice(index, 1);
      this.listItemsOutput.emit(this.listItems);
    }
  }

  edit(index: number, event: MatChipEditedEvent) {
    const value = event.value;

    // Remove fruit if it no longer has a name
    if (!value) {
      this.remove(index);
      return;
    }

    if (index >= 0) {
      this.listItems[index] = value;
      this.listItemsOutput.emit(this.listItems);
    }
  }
}

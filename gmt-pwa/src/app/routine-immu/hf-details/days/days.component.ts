import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';

export const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

@Component({
  selector: 'days',
  templateUrl: './days.component.html',
  styleUrls: ['./days.component.less'],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
})
export class DaysComponent {
  days = DAY_LABELS;

  @Input()
  selectedDays: boolean[] = this.days.map(() => false);

  @Input()
  disabled: boolean = false;

  @Output() selectedDaysChange = new EventEmitter<boolean[]>();

  toggleDay(dayIndex: number) {
    if (this.disabled) {
      return;
    }
    this.selectedDays[dayIndex] = !this.selectedDays[dayIndex];
    //emit a shallow copy to make sure ref changes
    this.selectedDaysChange.emit(this.selectedDays.slice());
  }

  isSelected(dayIndex: number): boolean {
    return this.selectedDays[dayIndex];
  }
}

import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ExportBoundaryCardComponent } from './export-boundary-card.component';

describe('ExportBoundaryCardComponent', () => {
  let component: ExportBoundaryCardComponent;
  let fixture: ComponentFixture<ExportBoundaryCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ ExportBoundaryCardComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ExportBoundaryCardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

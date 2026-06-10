import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CatchmentChipComponent } from './catchment-chip.component';

describe('CatchmentChipComponent', () => {
  let component: CatchmentChipComponent;
  let fixture: ComponentFixture<CatchmentChipComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ CatchmentChipComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CatchmentChipComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

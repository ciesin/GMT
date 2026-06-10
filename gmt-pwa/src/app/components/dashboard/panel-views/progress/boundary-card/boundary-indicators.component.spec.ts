import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BoundaryIndicatorsComponent } from './boundary-indicators.component';

describe('BoundaryIndicatorsComponent', () => {
  let component: BoundaryIndicatorsComponent;
  let fixture: ComponentFixture<BoundaryIndicatorsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ BoundaryIndicatorsComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(BoundaryIndicatorsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

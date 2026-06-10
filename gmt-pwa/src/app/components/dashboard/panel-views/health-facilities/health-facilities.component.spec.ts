import { ComponentFixture, TestBed } from '@angular/core/testing';

import { HealthFacilitiesComponent } from './health-facilities.component';

describe('HealthFacilitiesComponent', () => {
  let component: HealthFacilitiesComponent;
  let fixture: ComponentFixture<HealthFacilitiesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ HealthFacilitiesComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(HealthFacilitiesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

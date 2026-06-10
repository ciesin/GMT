import { ComponentFixture, TestBed } from '@angular/core/testing';

import { HealthFacilitiesViewComponent } from './health-facilities-view.component';

describe('MicroplanListComponent', () => {
  let component: HealthFacilitiesViewComponent;
  let fixture: ComponentFixture<HealthFacilitiesViewComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ HealthFacilitiesViewComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(HealthFacilitiesViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

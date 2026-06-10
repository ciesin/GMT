import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ToggleIndicatorsComponent } from './toggle-indicators.component';

describe('ToggleIndicatorsComponent', () => {
  let component: ToggleIndicatorsComponent;
  let fixture: ComponentFixture<ToggleIndicatorsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ ToggleIndicatorsComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ToggleIndicatorsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

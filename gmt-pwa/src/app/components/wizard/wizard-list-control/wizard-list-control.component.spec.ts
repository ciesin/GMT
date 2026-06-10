import { ComponentFixture, TestBed } from '@angular/core/testing';

import { WizardListControlComponent } from './wizard-list-control.component';

describe('WizardListControlComponent', () => {
  let component: WizardListControlComponent;
  let fixture: ComponentFixture<WizardListControlComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ WizardListControlComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(WizardListControlComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

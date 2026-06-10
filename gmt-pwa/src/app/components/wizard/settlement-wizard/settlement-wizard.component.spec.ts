import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SettlementWizardComponent } from './settlement-wizard.component';

describe('SettlementWizardComponent', () => {
  let component: SettlementWizardComponent;
  let fixture: ComponentFixture<SettlementWizardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ SettlementWizardComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SettlementWizardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

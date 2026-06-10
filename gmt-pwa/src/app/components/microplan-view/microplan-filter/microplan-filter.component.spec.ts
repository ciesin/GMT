import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MicroplanFilterComponent } from './microplan-filter.component';

describe('MicroplanFilterComponent', () => {
  let component: MicroplanFilterComponent;
  let fixture: ComponentFixture<MicroplanFilterComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ MicroplanFilterComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MicroplanFilterComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

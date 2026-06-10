import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MaterialOverridesComponent } from './material-overrides.component';

describe('MaterialOverridesComponent', () => {
  let component: MaterialOverridesComponent;
  let fixture: ComponentFixture<MaterialOverridesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ MaterialOverridesComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MaterialOverridesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

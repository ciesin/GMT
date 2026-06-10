import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GmtNewComponent } from './gmt-new.component';

describe('NewComponent', () => {
  let component: GmtNewComponent;
  let fixture: ComponentFixture<GmtNewComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ GmtNewComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(GmtNewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

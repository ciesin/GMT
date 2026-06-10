import { ComponentFixture, TestBed } from '@angular/core/testing';

import { WardDownloadCardComponent } from './ward-download-card.component';

describe('WardDownloadCardComponent', () => {
  let component: WardDownloadCardComponent;
  let fixture: ComponentFixture<WardDownloadCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ WardDownloadCardComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(WardDownloadCardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

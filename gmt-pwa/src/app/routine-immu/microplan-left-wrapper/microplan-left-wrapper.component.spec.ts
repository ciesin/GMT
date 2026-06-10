import {ComponentFixture, TestBed} from '@angular/core/testing';
import {RouterTestingModule} from '@angular/router/testing';

import {MicroplanLeftWrapperComponent} from './microplan-left-wrapper.component';
import { provideHttpClientTesting } from "@angular/common/http/testing";
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';

describe('MicroplanLeftWrapperComponent', () => {
  let component: MicroplanLeftWrapperComponent;
  let fixture: ComponentFixture<MicroplanLeftWrapperComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
    declarations: [MicroplanLeftWrapperComponent],
    imports: [RouterTestingModule],
    providers: [provideHttpClient(withInterceptorsFromDi()), provideHttpClientTesting()]
})
      .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(MicroplanLeftWrapperComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

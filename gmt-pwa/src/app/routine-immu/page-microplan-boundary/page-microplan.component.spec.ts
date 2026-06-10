import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';

import { PageMicroplanComponent } from './page-microplan.component';
import {OAuthModule} from "angular-oauth2-oidc";
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';

describe('PageMicroplanComponent', () => {
  let component: PageMicroplanComponent;
  let fixture: ComponentFixture<PageMicroplanComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
    declarations: [PageMicroplanComponent],
    imports: [RouterTestingModule,
        OAuthModule.forRoot()],
    providers: [provideHttpClient(withInterceptorsFromDi()), provideHttpClientTesting()]
})
      .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(PageMicroplanComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

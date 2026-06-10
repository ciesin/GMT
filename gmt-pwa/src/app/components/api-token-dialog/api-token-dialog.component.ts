import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { IsLoadingService } from '@services/is-loading.service';
import { AuthService, ApiToken } from '@services/user/auth.service';
import { NGXLogger } from 'ngx-logger';
import {
  AbstractControl,
  FormBuilder,
  FormControl,
  FormsModule,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { MatModule } from 'src/app/mat.module';
import { CommonModule } from '@angular/common';
import { MatSelectChange } from '@angular/material/select';
import { Unsubscribe } from 'src/app/_shared/mixins/unsubscribe';
import { Clipboard } from '@angular/cdk/clipboard';
import _ from 'lodash';
import { MessageService } from 'src/app/services/shared/notifications/message.service';
import { takeUntil } from 'rxjs';
import { MatDialogRef } from '@angular/material/dialog';

export class BaseComponent {
  getLogger(): NGXLogger {
    throw new Error('Component must override this');
  }
}
//See comments in dataset-map.component.ts
const MixedComponent = Unsubscribe(BaseComponent);

interface ExpirationDate {
  label: string;
  days: number;
}

@Component({
    selector: 'gmt-api-token-dialog',
    templateUrl: './api-token-dialog.component.html',
    styleUrls: ['./api-token-dialog.component.less'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        FormsModule,
        MatModule,
        CommonModule,
        ReactiveFormsModule,
        //PdfDataService
    ],
	standalone: true
})
export class ApiTokenDialogComponent
  extends MixedComponent
  implements OnInit, OnDestroy
{
  public FORM_KEY_NAME = 'name';
  public FORM_KEY_EXPIRE_DATE = 'expire_date';
  public formGroup = this.formBuilder.group({
    [this.FORM_KEY_NAME]: new FormControl<string | null>(null, [
      Validators.required,
      this.tokenNameValidator(),
    ]),
    [this.FORM_KEY_EXPIRE_DATE]: new FormControl<ExpirationDate | null>(
      null,
      Validators.required
    ),
  });
  expirationDates: ExpirationDate[] = [
    { label: '1 Day', days: 1 },
    { label: '1 Week', days: 7 },
    { label: '1 Month', days: 30 },
    { label: '3 Months', days: 90 },
    { label: '6 Months', days: 180 },
    { label: '1 Year', days: 365 },
  ];
  public expireMessage = '';
  public generatePressed = false;
  public tokenGenerated = false;
  public token = '';
  private tokens: Array<ApiToken> = [];
  constructor(
    private authService: AuthService,
    private loadingService: IsLoadingService,

    private clipboard: Clipboard, // Inject Clipboard service
    private formBuilder: FormBuilder,
    private logger: NGXLogger,
    private messageService: MessageService,
    private cdr: ChangeDetectorRef,
    private dialogRef: MatDialogRef<ApiTokenDialogComponent>
  ) {
    super();
  }

  override getLogger(): NGXLogger {
    return this.logger;
  }

  async ngOnInit() {
    this.authService.userApiTokens
      .pipe(takeUntil(this.unsubscribe$))
      .subscribe((tokens) => {
        this.tokens = tokens;
      });
    this.tokens = await this.authService.listTokens();
    /*
    this.formGroup.get(this.FORM_KEY_NAME)!.setValue("Eric's API Token" + new Date().getTime());
    this.formGroup
      .get(this.FORM_KEY_EXPIRE_DATE)!
      .setValue(this.expirationDates[2]);
    setTimeout(() => {
      this.handleGenerateToken().then()
    }, 500);

    this.formGroup.markAllAsTouched();*/
  }

  private tokenNameValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      if (!control.value) {
        return null; // If no value, no validation error
      }

      const tokenExists = this.tokens.some(
        (token) => token.name === control.value
      );
      return tokenExists ? { tokenNameExists: true } : null;
    };
  }

  onExpireDateChange(event: MatSelectChange): void {
    const selectedValue = event.value;

    // Calculate the expiration date
    const currentDate = new Date();
    const expirationDate = new Date(currentDate);
    expirationDate.setDate(currentDate.getDate() + selectedValue.days);

    // Format the expiration date as a readable string
    const formattedDate = expirationDate.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    // Update the expireMessage
    this.expireMessage = `Token will expire on ${formattedDate}`;
  }

  copyToClipboard(token: string): void {
    if (this.clipboard.copy(token)) {
      this.logger.debug('Token copied to clipboard');
    } else {
      this.logger.warn('Failed to copy token to clipboard');
    }
  }

  async handleGenerateToken() {
    this.loadingService.setLoading(true);

    try {
      //show validation errors
      this.generatePressed = true;
      this.formGroup.markAllAsTouched();

      if (!this.formGroup.valid) {
        return;
      }

      const name: string = this.formGroup.get(this.FORM_KEY_NAME)?.value;
      const expirationDate: ExpirationDate = this.formGroup.get(
        this.FORM_KEY_EXPIRE_DATE
      )?.value;

      const tokenResp = await this.authService.handleGenerateToken(
        name,
        expirationDate.days
      );

      if (!_.isNil(tokenResp)) {
        this.token = tokenResp.token;
        this.tokenGenerated = true;
        this.cdr.markForCheck();
      } else {
        this.messageService.add({
          summary: 'Unable to create token, an error occurred',
          severity: 'error',
        });
      }
    } finally {
      this.loadingService.setLoading(false);
    }
  }

  async handleCopyAndClose() {
    this.copyToClipboard(this.token);
    this.dialogRef.close();
  }
}

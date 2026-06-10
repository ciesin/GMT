import { TestBed } from '@angular/core/testing';

import { GmtNewStateService } from './gmt-new-state.service';

describe('GmtNewStateService', () => {
  let service: GmtNewStateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(GmtNewStateService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});

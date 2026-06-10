/**
 * This is used to return an Observable that can be cancelled, such as
 * when the user navigates away from the page.  This allows long running processes
 * to be stopped earlier
 */
export interface CancelableState {
  isSubscribed: boolean
}

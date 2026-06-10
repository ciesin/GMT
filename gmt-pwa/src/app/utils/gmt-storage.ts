import { OAuthStorage } from "angular-oauth2-oidc";

// We need a factory, since localStorage is not available during AOT build time.
export function storageFactory() : OAuthStorage {
  return new GMTStorage();
}

// add custom prefix for storage to not have naming conflicts
export class GMTStorage implements OAuthStorage {
  prefix = 'gmt_';
  getItem(key: string): string | null{
    return localStorage.getItem(this.prefix + key);
  }

  removeItem(key: string): void {
    localStorage.removeItem(this.prefix + key);
  }

  setItem(key: string, data: string): void {
    localStorage.setItem(this.prefix + key, data);
  }
}

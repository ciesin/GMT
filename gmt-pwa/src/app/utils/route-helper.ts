import { NavigationEnd } from "@angular/router";

export function routeFromChunks(chunks: string[], fromRoot: boolean = true): string {
  const route = chunks.join('/');
  return fromRoot ? '/' + route : route;
}
export function getRouteChunks(url: string): string[] {
  const routeChunks = url.split('/');
  if (routeChunks.length == 0) {
    return [];
  }
  return (routeChunks[0] === '') ? routeChunks.slice(1) : routeChunks;
}

export function isNavigationEnd(event: any): event is NavigationEnd {
  return event instanceof NavigationEnd;
}
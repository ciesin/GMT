export interface SurroundingBoundaries {
  version: number,
  surrounding_boundary_guids: Array<string>,
  boundary_guid: string,
}

export function getFullSetOfSurroundingBoundaries(surroundingBoundariesList: Array<SurroundingBoundaries>): Set<string> {
  return surroundingBoundariesList.reduce<Set<string>>((b_set: Set<string>, b: SurroundingBoundaries) => {
    if(b){
    for (const g of b.surrounding_boundary_guids) {
      b_set.add(g);
      }
    }
    return b_set;
  }, new Set<string>());
}

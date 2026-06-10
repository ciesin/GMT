import { Component } from '@angular/core';
import { faBaby, faPen, faPersonCane, faPersonPregnant } from '@fortawesome/free-solid-svg-icons';

/* This component aims at helping tweaking material CSS free from any parent
 *  border effect.
 */
@Component({
    selector: 'gmt-material-overrides',
    templateUrl: './material-overrides.component.html',
    styleUrls: ['./material-overrides.component.less'],
    standalone: false
})
export class MaterialOverridesComponent {
  public oldIcon = faPersonCane; 
  public pregnantIcon= faPersonPregnant; 
  public babyIcon = faBaby; 
}

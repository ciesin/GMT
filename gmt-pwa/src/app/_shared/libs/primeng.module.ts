import { NgModule } from '@angular/core';

import {BrowserModule} from '@angular/platform-browser';
import {BrowserAnimationsModule} from '@angular/platform-browser/animations';

// Primeng only required individual sub modules (do not import from 'primeng/primeng')
import { ToastModule } from 'primeng/toast';
import { TableModule } from 'primeng/table';
import { TooltipModule } from 'primeng/tooltip';
import { RadioButtonModule } from 'primeng/radiobutton';
import { ToggleButtonModule } from 'primeng/togglebutton';
import { CheckboxModule } from 'primeng/checkbox';
import {PaginatorModule} from 'primeng/paginator';
import { OverlayPanelModule } from 'primeng/overlaypanel';
import { DynamicDialogModule } from 'primeng/dynamicdialog';
import { TabViewModule } from 'primeng/tabview';
import { TabMenuModule } from 'primeng/tabmenu';
import { ScrollPanelModule } from 'primeng/scrollpanel';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { InputTextModule } from 'primeng/inputtext';
import { DialogModule } from 'primeng/dialog';
import { AutoCompleteModule } from 'primeng/autocomplete';
import { DropdownModule } from 'primeng/dropdown';
import { InputSwitchModule } from 'primeng/inputswitch';
import { SplitButtonModule } from 'primeng/splitbutton';
import { MultiSelectModule } from "primeng/multiselect";
import { SidebarModule } from 'primeng/sidebar';
import { ProgressBarModule } from 'primeng/progressbar';
import { CalendarModule } from 'primeng/calendar';
import { PanelMenuModule } from 'primeng/panelmenu';
import { SelectButtonModule } from 'primeng/selectbutton';
import {MenuModule} from 'primeng/menu';

import { TreeModule } from 'primeng/tree';
import { TreeTableModule } from 'primeng/treetable';
import {BreadcrumbModule} from 'primeng/breadcrumb';
import {TextareaModule} from "primeng/textarea";

const importsExports = [
  BrowserModule, // required by primeng
  BrowserAnimationsModule, // required by primeng

  TreeModule,
  TreeTableModule,
  BreadcrumbModule,
  AutoCompleteModule,
  TableModule,
  TooltipModule,
  ToastModule,
  TabViewModule,
  TabMenuModule,
  DynamicDialogModule,
  DialogModule,
  MenuModule,
  CalendarModule,
  RadioButtonModule,
  ToggleButtonModule,
  CheckboxModule,
  OverlayPanelModule,
  DialogModule,
  InputTextModule,
  TextareaModule,
  ScrollPanelModule,
  ProgressSpinnerModule,
  DropdownModule,
  InputSwitchModule,
  SelectButtonModule,
  SplitButtonModule,
  MultiSelectModule,
  SidebarModule,
  PaginatorModule,
  ProgressBarModule,
  PanelMenuModule,
];

@NgModule({
  declarations: [],
  imports: [
    ...importsExports
  ],
  exports: [
    ...importsExports
  ]
})
export class AppPrimengModule { }

Completing Updates and Synchronizing the Changes to GMT Geodatabase
*******************************************************************

The final step is to synchronize the changes you have made with the server, which will in turn add them to the GMT geodatabase.

.. warning::
   This step is not possible using the training version of GMT. Please read the instructions below, but do not attempt this section during your training, as it will not work.

.. _synchronization:
Synchronization Steps
=====================

#. Establish a connection
#. Navigate to the **Data Management** tab in the navigation panel and expand **Downloaded Wards**.
#. Check to see whether the ward has been modified.
#. Click **Synchronize** to upload the changes to the GMT geodatabase.

.. image:: /content/_images/synchronization.png
      :align: center
|

#. Click on **Continue** in the window that opens.
#. Wait until the synchronization has finished. This might take a while. Then click 'Close'.


.. image:: /content/_images/sync_1.png
      :align: center
|

.. _exporting:
Exporting Data from GMT
========================

Three types of data can be exported from GMT:

1. **PDF ward maps**.
2. **Excel spreadsheets** that contain attribute data in a tabular format.
3. **A geodatabase** containing geospatial data such as boundaries, catchment polygons, health facility points, and settlement points. These data can then be analyzed in other GIS software, if required.

Exports can be selected for one or several boundaries at once. There is an option to have one separate file for each boundary, or one file containing the information for all selected boundaries. Additionally, the PDF map can display an entire ward, or multiple maps can be created (each one detailing an individual health facility within the ward).

Navigate to the **Manage** tab and search for the region you wish to export. You can continue adding regions to the list until you are ready to export.

Export Options
--------------

First, click "add to export" for a ward, then click on 'Export', then the **Export Map and Data** dialog will appear with several options:

Map Settings
^^^^^^^^^^^^

 **Export Map**
Generate PDF maps of the selected areas

**One detail page per health facility**
Create separate detailed maps for each health facility in addition to the ward overview map

Data Settings
^^^^^^^^^^^^^

**Export Spreadsheet**
Generate an Excel file containing tabular data

**Export REW**
Generate an Excel file in the REW format

**Export GDB File**
Export a geodatabase file for use in other GIS software

**Separate file for each boundary**
Create individual files for each selected ward/boundary instead of combining them

Excel Export Structure
----------------------

Tabular data downloads are provided in four separate sheets:

GMT - Overview Sheet
^^^^^^^^^^^^^^^^^^^^

Contains admin area names and total population data:

* **National** - Country level data
* **State** - State level data  
* **LGA** - Local Government Area data
* **Ward** - Ward level data
* **POP GIS** - GIS modeled population estimates

GMT - HFs Sheet
^^^^^^^^^^^^^^^

Contains health facility information and population summaries:

* **HF Name** - Health facility name
* **HF State** - State where facility is located
* **HF LGA** - Local Government Area 
* **HF Ward** - Ward where facility is located
* **RI Strategy** - Does the facility provide routine immunization service? (True/false)
* **Total STL** - Number of settlements serviced by the facility
* **Total Catchment** - Population within the facility catchment
* **Total FIXED** - Population within the fixed facility catchment
* **Total OUTREACH** - Population within the catchment of any outreach sites

GMT - STLs Sheet  
^^^^^^^^^^^^^^^^

Contains settlement information and population summaries:

* **Name** - Settlement name
* **HF State** - State
* **HF LGA** - Local Government Area
* **HF Ward** - Ward
* **STL in ward** - Total number of settlements in the ward
* **Population Total** - Pop GIS (modeled estimate), Pop estimated (field estimate), Pop difference (difference between the two estimates)
* **Uninhabited** - Number of settlements marked as uninhabited for each of the following reasons:
  
  * Unknown
  * Abandoned  
  * Destroyed
  * No settlement
  * Other

* **Special Attention** - Number of settlements marked as a focus area for each of the following reasons:
  
  * cVDPV outbreak
  * Densely populated
  * Internally displaced
  * Measles outbreak
  * Nomadic/Fulani
  * Non-compliant
  * Polio high-risk
  * Riverine
  * Scattered
  * Security compromised
  * Slum
  * Uptake issue
  * Zero-dose

GMT - Catchments Sheet
^^^^^^^^^^^^^^^^^^^^^^

Contains health facility catchment relationships with individual settlements, information and population summaries:

* **HF Name** - Fixed post name, outreach site name or "mobile"
* **RI Strategy** - Does the facility provide routine immunization service? (True/false)
* **Outreach Site Name** - If applicable
* **Settlement Name** - Name of settlement in catchment
* **Catchment Population Total** - Total population served
* **Catchment Population Inside HF Ward** - Population within the same ward as the health facility
* **Catchment Population Outside HF Ward** - Population from neighboring wards
* **% of Settlement Population Assigned to HF** - Percentage of settlement population assigned to this health facility
* **Distance Settlement HF (m)** - Distance from settlement to health facility in meters
* **Distance Settlement Outreach Site (m)** - Distance from settlement to outreach site in meters

Using Exported Data
====================

PDF Maps
--------

The PDF maps are designed for field use and include:

* **Ward overview** showing all health facilities and settlements
* **Catchment areas** clearly marked
* **Settlement names** and population estimates
* **Transportation routes** and geographic features
* **Legend** explaining symbols and colors
* **Individual health facility maps** (if selected) showing detailed catchment information

Excel Spreadsheets
------------------

The Excel files can be used for:

* **Data analysis** and reporting
* **Population planning** calculations
* **Coverage assessment** 
* **Performance monitoring**
* **Integration** with other health information systems

Geodatabase Files
-----------------

The GDB files contain:

* **Vector layers** for boundaries, health facilities, settlements
* **Catchment polygons** for each health facility
* **Population raster data** 
* **Attribute tables** with all collected information

Best Practices for Exporting
=============================

Planning Your Export
--------------------

#. **Review data quality** before exporting - resolve outstanding issues first
#. **Coordinate with team** - ensure all team members have completed their updates
#. **Check completeness** - verify all required health facilities and settlements are included
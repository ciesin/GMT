Managing Health Facility Data
******************************

This section provides detailed instructions on how to review, add, update, and delete health facility data. In the designated ward, the ward focal person is tasked with assessing the health facility records and names on the master list (MLoS), then cross-referencing this information with GMT. Any health facilities on GMT with inaccuracies (name, location, attributes) should be corrected, missing records added, and non-existent or shut-down health facilities deleted.

.. note::
   First, you need to open GMT. The shortcut that starts GMT can be found in the home screen of your tablet or on your computer's desktop. Click on the GMT icon and the GMT will start.

   If you have not downloaded the GMT app, please follow the installation instructions in :ref:`download_ward`.

Review of Health Facility Information
=====================================

After downloading the ward, the next step is reviewing the health facility data records within the GMT geodatabase. This examination can be conducted by verifying the health facility names in the navigation panel against the anticipated number of health facility records in the ward. The expected count of health facilities can be ascertained by cross-referencing it with the existing microplan or the master list of settlements/health facilities (MLoS) for the ward.

Review Steps
------------

#. Click on the downloaded ward (in this case Zurgu ward)
#. In the upper left corner of the navigation panel, the health facility list icon will automatically become active. A corresponding figure will display the count of health facilities in the ward. The figure below indicates one (1) health facility available on GMT for Zurgu ward.
#. A list will appear below the health facility icon; it will display the health facility names and the population within the 2km health facility catchment area.
#. Cross-reference the health facility count and names on the navigation bar with the MLoS.

.. Important::
  For each health facility that provides routine immunization services, it is assumed that everyone within 2 kilometers of it is part of its catchment. Catchments can 
  be refined to some extent, as we will see.

Example Issues Found
--------------------

Two issues become obvious after cross-referencing the health facilities listed for Zurgu ward on the GMT geodatabase and the health facilities listed on the master list (MLoS):

.. image:: /content/_images/zurgu_HF.png
     :align: center
|

.. image:: /content/_images/MLOS_example.png
     :align: center
|


#. There are 2 health facilities (Tabobi Health Clinic and Ruwan Kanya Health Clinic) listed on the MLoS. In contrast, GMT indicates only one health facility (Tabobi Health Post).
#. The name of the single health facility on GMT does not fully correspond to the exact name recorded on the MLoS.

Considering these observations, it is necessary to update the health facility information attributes and add the missing health facility to the GMT navigation.

Visual Inspection
-----------------

We can also visually inspect the health facility on the map to investigate the location, catchment area, and estimated population/number of settlements serviced by the facility.

.. image:: /content/_images/visual_inspection.png
     :align: center
|


Filtering Health Facilities
----------------------------

.. hint::
      We can filter our health facility list by type, microplan status and the services health facilities provide.

.. image:: /content/_images/filter.png
     :align: center
|

Viewing and Updating Health Facility Data
=========================================

The following steps will take you through how to update the health facility attribute details.

#. Click on the dropdown arrow beside "Tabobi Health Post" on the Navigation Bar.
#. Select **Go to Details**. Alternatively, you can select the health facility on the map and select **Go To Details** from the pop-up box. Once selected, the health facility locator pin will turn orange.
#. Expand the **Facility Details** tab.
#. In the **Name** textbox, edit and type the exact name of the health facility as seen on the MLoS ("Tabobi Health Clinic").
#. Provide an "Also Known As (AKA)" name if available.
#. Change the **Microplan (MP) status** to "In-progress." Once you have completed reviewing this microplan, the status can be changed to "completed."
#. From the dropdown, select the correct **Health Facility Type**.
#. If the type is "Primary," we can specify further the primary type from the according dropdown.
#. Choose the **Ownership type** as "public" or "private".
#. Use checkboxes to select the types of **services** rendered by the health clinic. If a health facility has no Routine Immunization  service checked, it won't have a catchment and will appear with 0 population.
#. Check the **days** on which the health facility provides services.
#. You can use the **Different Ward** switch to indicate whether this health facility belongs to the correct ward. If the health facility does not belong to the selected region of interestward, switch on the Different Ward slider and use the "Ward" dropdown to select the name of the correct ward.

.. note::
   You should see the GMT automatically saving any changes you make and marking them with a "Success" box that pops up on the map canvas.

.. image:: /content/_images/tabobi_HF_detail.png
     :align: center
|


Health Facility Services
------------------------

A health facility can provide several services. There may also be health facilities that do not provide routine immunization services. 

.. image:: /content/_images/HF_services.png
     :align: center
|

If a health facility does not provide routine immunization services, uncheck the routine immunization service. The catchment polygon will disappear and the catchment population of this health facility will become 0. The ward population bar in the header will change: the population covered by 'fixed-post' services will decrease, while the population that is unclaimed will increase.

Adding Staff Members
--------------------

It is possible to add staff members for health facilities.

#. Expand the **Staff Member** tab on the navigation bar.
#. Click on the **Add** button.
#. A dialog box will pop up. Type in the name of any known staff members.
#. Select the **position** of staff member in the position textbox.
#. Select the **contract category type** (full-time, part-time, casual, or unknown).
#. Click on **Create**.

.. image:: /content/_images/staff_creation.png
     :align: center
|

Outreach Sites Menu
--------------------

The next dropdown tab on the navigation panel shows information on any **outreach sites** associated with the health facility. Note the figure in parentheses that indicates the number of outreach sites. For Tabobi Health Clinic, there are currently no outreach sites.

.. image:: /content/_images/tabobi_outreach.png
     :align: center
|

Settlements Menu
-----------------

The final dropdown on the navigation panel shows the list of **settlements** that fall within the 2km catchment zone of Tabobi Health Clinic. Note the figure in parentheses that indicates the number of settlements. For this example, there are 21 settlements that fall within the 2km catchment. The estimated population of each of these settlements is displayed next to the settlement name. Each settlement can be expanded to display the attributes stored on the GMT geodatabase.

.. image:: /content/_images/tabobi_settlements_menu.png
     :align: center
|

.. _exclusion_settlements:
Exclusion of Settlements
-------------------------

You may find that certain settlements within a health facility's catchment area should not actually be served by that facility. This could be due to geographical obstacles (rivers, mountains), known access issues, or community preferences. You can exclude settlements from a health facility catchment:

#. Navigate to the health facility details.
#. Find the settlement you wish to exclude in the catchment list.
#. Click on 'Exclude' next to the settlement name.

.. image:: /content/_images/exclude_settlement.png
     :align: center
|

As a result from excluding a settlement, the catchment population will be recalculated, and there will be a new section 'Excluded Settlements' where you could re-include the settlement if you excluded it by mistake by clicking on 'Restore'.

.. image:: /content/_images/excluded_settlements.png
     :align: center
|

.. _add_HF:
Adding a Health Facility
========================

To create a new health facility in a ward, complete the following steps:

#. Click on the **Create** button in the left lower corner of the navigation panel.
#. Select **Health Facility** and the Add Health Facility dialog box will appear.
#. In the **Name** textbox, type in the name of the new health facility you wish to add (Ruwan Kanya Health Clinic). You can also provide the AKA name, if available.
#. In the **Ownership** dropdown field, select whether the ownership is private or public.
#. Choose the **health facility type** from the provided options (Primary, Secondary, Tertiary, Dispensary, and Other).
#. Click **Next** to proceed to the next step.

.. image:: /content/_images/add_HF_updated.png
     :align: center
|

Setting Location
----------------

Next, you need to set the location of the new health facility. A new dialog box will have appeared that allows you to move/zoom around the map canvas and select the precise location of Ruwan Kanya Health Clinic.

.. tip::
   **Tips and tricks**
   
   * Pan and zoom around the map using your fingers on the tablet screen or the map toolbar buttons
   * Switch the basemap to satellite map to identify the precise location of the new health facility
   * If you are physically located at the health facility you are adding to the GMT geodatabase, and you are working on a mobile device with a GPS chip, you can click the **Use GPS** button to locate where you are on the map

Position the health facility marker on the building to the south of the complex. Once you are happy with the location of the new health facility, click **Set Location**.

.. image:: /content/_images/set_location_HF.png
     :align: center
|

Final Screen
-------------

Finally, input all known attributes and information about the new health facility:

#. Set the **MP Status** as "In Progress"
#. Choose the **day(s)** for routine immunization activities by ticking the corresponding boxes. For Ruwan Kanya Health Clinic, select Monday and Friday
#. Click **Done** once you are happy with the information that has been entered

.. note:: 
   As a result of adding a health facility, population calculations are automatically performed for all health facilities within the ward. 

The settlements that fall within the 2km catchment zone have also been added to the **Settlements** drop-down within the Health Facilities tab.

Deleting Health Facilities
---------------------------

If you need to delete a health facility:

#. Click on the health facility icon in the navigation panel
#. Select the health facility name you wish to delete
#. Click **Go to Details**
#. Scroll down to the bottom of the navigation bar and click on **Delete**
#. A dialog box will appear to confirm that you want to delete the health facility
#. Click on **Yes** to confirm and the health facility record will be deleted

.. image:: /content/_images/delete_HF1.png
     :align: center
|

Adding Outreach Sites
=====================

Outreach sites tend to be located in accessible public buildings, such as schools, markets, dispensaries, village heads buildings, mosques, and churches where more clients will be reached. You can view these POIs on the map by switching them on in the Map Layer panel.

.. image:: /content/_images/map_layers_POI.png
     :align: center
|

Creating Outreach Sites
-----------------------

To create a new outreach site, follow these steps:

#. Click the **Create** button on the navigation panel and select **outreach site**.
#. Choose which health facility within the ward is performing this outreach service and click **Next**.
#. Navigate to the zone where you want to place the outreach site and click **set location**, or, if you are located in a suitable building and working on a tablet, you can use the GPS option to place the point on the map.
#. Fill out the **name**, **mode of transport** , and **frequency** of the outreach site, then click **Next**.
#. The new outreach site will service all settlements within a 2km radius. If required, you can explicitly choose which settlements will be covered by this outreach site by creating a custom catchment. Normally, a custom catchment is not needed. See :ref:`custom_outreach` for more information regarding this.
#. Click **Done** once you are satisfied with the new outreach site.

.. note::
   If you are at the outreach site and are using a tablet, you can select **Use GPS** to set the location on the map

Results of Adding Outreach Site
-------------------------------

#. The new outreach site is displayed on the map canvas. It is visible by an outreach site icon, and a light green 2km catchment polygon, and a dotted line showing which fixed post is providing this outreach service.
#. The health facility list is updated accordingly - the light green bar indicates for a health facility how many people are covered by outreach services.
#. For each health facility, we see how many settlements are covered by either fixed post or outreach services, and the corresponding percentage.
#. The outreach population is shown in the ward breakdown also in light green.

.. image:: /content/_images/outreach_legend.png
     :align: center
|

Sometimes there is an overlap of the fixed post and outreach site catchment areas. GMT uses an algorithm to assign which people in this overlap are assigned to which facility. The main parameters used are distance of a place to a health facility / outreach site and number of RI service days provided.

.. _custom_outreach:
Custom Outreach Catchments
---------------------------

In some situations, the standard 2km catchment radius may not reflect the reality of who can access an outreach site. For example, security concerns, geographical barriers, or transport routes may require a custom catchment definition.

To create a custom outreach catchment:

#. Follow the normal outreach creation process.
#. At the final step, instead of accepting the default 2km catchment, choose **Custom Catchment**.
#. You will be prompted to draw on the map the specific settlements you want to include in the catchment.
#. Draw boundaries around the settlements that should be covered by this outreach site.
#. Review the settlements that were included by the polygon that was drawn.
#. Complete the setup.


.. image:: /content/_images/custom_outreach_dialog.png
     :align: center
|

When drawing the polygon, double click to finish the polygon. Use the undo button if you are not happy with the last point or start over after finishing the polygon. 

.. image:: /content/_images/custom_outreach_drawing.png
     :align: center
|

Review the settlements that were included by the polygon.

.. image:: /content/_images/review_custom_outreach.png
     :align: center
|

.. warning:: 
      Custom catchments should only be used when a default 2km catchment does not fulfill the reality of the situation. Use this option sparingly and only when necessary.

This feature is particularly useful for:

* Areas with security constraints where people must travel specific routes
* Geographical barriers that prevent normal access patterns
* Special population groups that require targeted services

Urban Outreach Sites
---------------------

In urban areas, you may need to create outreach sites for specific populations such as slum areas. When creating an outreach site in an urban context:

#. Click on the '+' button and select 'Outreach Site'
#. Select the health facility providing the outreach service
#. Set the pin in the target area (e.g., slum area)
#. You will be asked to delineate the specific area where the outreach is performed
#. Draw the boundaries of the area that corresponds to the target population
#. Provide all necessary details and finish the setup

This allows for precise targeting of specific populations within dense urban areas.

.. note::
   This is essentially the same as a custom outreach, simply in an urban context. 

Using Guides in GMT
===================

Guides can be activated in the Map Layers panel.

.. image:: /content/_images/distance_guide1.png
     :align: center
|

Distance Guides
---------------

To help visualize on the map which settlements fall within the 2km catchment area of a fixed health facility or outreach sites, there are guides available in the Map Layer panel. Switch on the **Distance** guide.

The distance guide generates a 2km buffer around every health facility within the AOI, as well as around all health facilities located less than 2km outside the border of the AOI. This is important because it is likely that people will travel between wards to visit facilities that are geographically closer.

You can change the guide settings:

- Click on the "Show Single Catchment" button to restrict the guide to one health facility you are currently looking at (see also :ref:`single_catchment`).
- Use the slider at the bottom left to vary the distance parameters (0-2km, 0-5km, or 2-5km).

.. note::
   For the purpose of identifying outreach site locations, the distance guide buffers can be toggled between 2km and 5km.

Voronoi Guides
--------------

Voronoi guides help to visualize which health facility a settlement is closest to by dividing the region of interestinto sections that identify which health facility is closest at any point on the map. Switch on the **Voronoi** guide and investigate what you can see on the map.

.. warning::
   Voronoi polygons identify the health facility that is geographically closest to any given location, however, this is not always the quickest health facility to get to. Road networks, land boundaries, rivers and steep hills could all affect how easy it is to access a particular health facility.

Urban Health Facility Management
=================================

In urban areas, wards may contain many health facilities in close proximity.

When multiple health facilities serve the same area, GMT uses a weighting system based on:

- Proximity to the health facility
- Frequency of services provided

Population may be distributed among multiple health facilities, including some located in neighboring wards. You can view this distribution in the settlement details under the health facility section.

.. important::
   Population crosses boundaries! A client does not care about ward or LGA boundaries. They simply go to the most appropriate service provider in their area. Hence, catchments span ward, lga and state boundaries.

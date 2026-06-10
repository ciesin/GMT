Tutorial 2
+++++++++++++

Purpose
********
The purpose of this second tutorial is to further understand the basic functionalities of
the Geospatial Microplanning Toolkit (GMT). Previous knowledge is required - you are
expected to have worked through :doc:`/content/tutorials/10Tutorial1` and that you understand all concepts introduced there.

This tutorial will follow the same principle as the previous one, and
additionally we will introduce the following:

#. Health facilities not considered for routine immunization
#. Addition of health facilities
#. Addition of outreach sites
#. Addition of settlements
#. Settlement name updates
#. Uninhabited settlements
#. Guides to aid microplanning

----------------------------

Let's Get Started!
******************

Preparation
===========

Obtain the data for Ward "Iwoate" in LGA "Ogo Oluwa" in the
State "Oyo" and download the data. Navigate to the health facility list. If
any of those steps pose trouble, consult the steps in Tutorial 1.

Health facility services
=========================

A health facility can provide several services, as we have already seen in Tutorial 1. There may also be health facilities that 
do not provide routine immunization services. 

Let's assume that Mowolowo Primary Health Center does not provide routine immunization services, but only Malaria control. Set it as such. 

.. image:: /content/_images/HF_malaria.png
          :align: center
|

.. note::
      The catchment polygon disappeared. Additionally, the catchment population of this health facility is now 0. Furthermore, the Ward population bar in the header changed: the population covered by'fixed-post' services has decreased, while the population that is unclaimed has increased. 

Adding a Health Facility
========================

Next, let us add a health facility that is providing routine immunization services.

Click on the '+' button and select 'Health Facility'.

.. image:: /content/_images/add_HF_button.png
          :align: center
|

Let's create the following health facility following the wizard:

* It is called 'Dans Health Center'
* It's public
* It's a primary health post
* It's located in the South West of the Ward, in Iwoate (or closeby)
* It provides routine immunization services on Monday, Tuesday, Wednesday each week

.. Note:: 
      If you are using a tablet and you were to add a health facility in the field at the location where the health facility is, you could use the GPS of the tablet to get the location directly.

We have added our health facility.

.. image:: /content/_images/HF_added.png
          :align: center
|

This health facility is providing fixed-post services on Mon-Wed. On Thursday, they typically do outreach sessions. Let's add them.

.. hint::
      We can filter our health facility list by type, microplan status and the services health facilities provide.

.. image:: /content/_images/filter.png
          :align: center
|


Adding an Outreach Site
========================

Click on the '+' button and select 'Outreach Site', analog to the above.

In the first step, you need to select which health facility is performing this outreach service. In our case, there is only one health facility - Dans Health Center.  

Let's add the outreach in the settlement Alaaye (in the East of this Ward, zoom in on the road until you find the settlement Alaaye). Set the location (again, here you could use the GPS of a tablet if you were in the field). The name is 'Dans Health Center Outreach in Alaaye'. The health workers travel there with their motorbike once per month every Thursday. Click on 'Done' in the last step.

.. image:: /content/_images/outreach_created.png
          :align: center
|

.. note::
      Adding an outreach site has resulted now in the following:
      * An outreach site icon has been created
      * All settlements within 2km of the outreach site have been added to the outreach site catchment
      * The global population bar shows the population served by outreach services in another color
      * The population bar for Dans Health Center shows the population served by this outreach also in that same color 

.. _adding_settlement:
Adding a Settlement
====================

Settlements can be added using the same '+' button. 
Add the settlement 'Oldtown' this way. Choose an area on the map where there is nothing, on the Road in the West, close to Afilala. You can choose to simply set a point on the map with a name or else, if you know the outlines of the settlment, you can draw them. For this exercise, let's draw a shape.
This settlement is also known as 'Oldy' and it's estimated that there are 230 people living there. 

.. Important::
      Newly added settlements can be removed via the 'Delete' button. However, existing settlements cannot be deleted - they can only be labelled as 'Uninhabited' (see below).

.. image:: /content/_images/delete_settlement.png
          :align: center
|

Field data collection
========================

Let us review the Settlements tab. You should have seven settlements in the list. As you can see from this list, there are three settlements that have a strange name: 'HA...'. These names should be corrected. Wherever possible, name all settlements. If needed, you can use the GPS functionality to go to those places and collect the name directly in the field.

.. image:: /content/_images/settlements_machine.png
          :align: center
|

.. tip::
      In other Wards, you would find 'SSA...' or 'BUA...'. Those are machine generated names. As the :ref:`content/background/10background:settlements` have been extracted from satellite imagery, not all of them have a name. However, each settlement has a name. Where there is no other name known, a settlement has been named with a machine generated name. HA in this case stands for Hamlet Area, SSA for Small Settlement Area and BUA for Built Up Area.

.. _uninhabited:
Uninhabited settlements
========================

While we can add settlements, we cannot delete settlements. However, we can mark settlements as uninhabited. Let's consider HA_951119. Let's assume that this is an area that has been abandoned. Click on the settlement details. Toggle the 'Uninhabited' button and choose as a reason 'Abandoned'. 

.. image:: /content/_images/uninhabited.png
          :align: center
|

.. note::
      As a result, the population squares in this settlement have turned grey and the name has a prefix 'X'. Furthermore, the catchment for the outreach site has been reduced according to the population that was 51 before.
      There might be areas where the extraction from satellite imagery has identified  :ref:`content/background/10background:settlements` where there are none. This is why under the uninhabited choices there is 'No settlement'.


---------------------------------

Guides
=======

Distance guides
---------------

To help you visualize on the map which settlements fall within the 2km radius of
a health facility or an outreach site, there are visualization guides available on the microplan map. Click on
the legend and select "Guides - Distance".

.. image:: /content/_images/guides.png
      :align: center
|

The guides show per default for all
health facilities (zoom in and out on the map to see that). You can change that: click
on the "Show Single Catchment" button to restrict the guide to one health facility you are currently looking at (though, you will have to go into the details of that health facility). Viewing the details of another health facility now on the microplan map will also only show the guide for that health facility.

.. image:: /content/_images/guides_sc.png
      :align: center
|

.. image:: /content/_images/single_catchment.png
      :align: center
|


.. hint:: 
      On the slider at the bottom left, you can vary the distance parameters of the guides to show you 0-2km, 0-5km or 2-5km.  

--------------------------------

Voronoi guides
---------------

These guides help to visualize all points around a health facility that are closer to this health facility
than any other. You will now see a pattern that shows for each health
facility the areas that contain settlements that are closer to it than any other health
facility.

.. image:: /content/_images/guides_voronoi.png
      :align: center
|

.. note::
      In order to make this example more understandable, we have added routine immunization as a service again to the Mowolowo Primary Healt Center.


.. important::
  You reached the end of Tutorial 2!

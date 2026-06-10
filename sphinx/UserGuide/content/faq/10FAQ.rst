Frequently Asked Questions 
++++++++++++++++++++++++++

What do the colored bars with the number mean?
***********************************************
.. image:: /content/_images/colored_bars.png
          :align: center
|

How is the population calculated?
**********************************
Population is calculated for each settlement as described in :ref:`population`. 

Why does my population not change when I provide a field estimate?
*******************************************************************
In the application, all values shown are computed population fields, except in the settlement details when field estimated population can be added. To be able to compare different health facilities and settlements with each other, the computed population value is used for consistency reasons. Nevertheless, in the export, the field estimated population is available. 

Why is there a discrepancy between the population coverage of a ward and the health facilities?
***********************************************************************************************
This can arise because a lot of population could be covered by health facilites in neighboring wards. For instance here, 28.9k population are covered but the three health facilities have a total of 3k (733+805+1.5k) people within their catchments.   

.. image:: /content/_images/hf_ward_pop_discrepancy.jpg
          :align: center
|

What is a custom outreach?
**************************
When you create a custom outreach, you can draw the actual catchment. Click on the 'Custom Catchment' button in the 'Add Outreach' wizard.

.. image:: /content/_images/custom_outreach.png
          :align: center
|

For more information on this, see :ref:`custom_outreach`.

Why can I delete some settlements but not others?
*************************************************
Usually, settlements cannot be deleted - they can be marked as uninhabited. Newly added settlements can be deleted, however. See :ref:`delete_settlement`.

.. image:: /content/_images/delete_settlement.png
          :align: center
|

What does the Auto-Sync button do?
**********************************
The auto-sync catchments toggle allows for a more rapid operation of GMT. Many operations on GMT influence health facility catchment calculations, such as RI services in health facilities, distance of settlements to health facilities and outreach sites, settlement inhabitation status, RI service days, health facility and outreach site locations, etc. When doing a lot of changes in GMT, updating these catchments can significantly slow down the workflow, because at each action the catchment is recalculated. The auto-sync catchments toggle can be used to toggle off automated catchment updates, thus allowing a more fluent workflow.

.. note::
    To recalculate the catchments, either click on the refresh button next to the toggle, or you can also synchronize your data which will automatically do the catchment calculation update.

.. image:: /content/_images/auto_sync_toggle.png
          :align: center
|

How can I refine my catchments?
*******************************
There are several ways to refine a catchment.

#. Fixed post catchments can only be modified by excluding settlements. See :ref:`exclusion_settlements`.
#. Outreach catchments can be either modified by excluding settlements (as shown above), or else by drawing custom catchment, see :ref:`custom_outreach`.

How are catchments calculated?
*******************************
A default catchment is always including all population within 2km of a health facility or outreach. If there are settlements that are covered by several health facilities, the calculation depends on the distance between a raster square (the location where the person lives) and the health facility, as well as the frequency the health facility is providing routine immunization services.

Why are my catchments spanning boundaries?
******************************************
For routine immunization services, the population is seeking the service. They are not aware of boundaries, they will likely choose the closest health facility, independent of the boundary that health facility is located in. So catchments can span boundaries. Additionally, when placing an outreach where nearby settlements are located in the boundary of a neighboring ward, it would make sense to do social mobilization in those areas to inform them of the planned upcoming activities, even if they are located in another ward.

What are uninhabited settlements?
**********************************
In GMT, the settlements are originating from remote sensed data (see :ref:`settlements`). This can lead in some cases to wrongly identified settlements. Additionally, with people migrating, a previously inhabited settlement may no longer be populated. Thus, we can label settlements as 'Uninhabited'. See :ref:`uninhabited_settlements`. 

My settlement names are not correctly placed, how can I change that?
********************************************************************
You can always move your settlement points within a settlement boundary using the 'Edit location' button. 

.. image:: /content/_images/edit_location.png
          :align: center
|

.. Note::
    To modify settlement shapes, you will have to use the settlement splitting and merging functionality. For settlement shape changes, see :ref:`settlement_split1` and :ref:`settlement_merge1`.

.. _single_catchment:
What is 'Show single catchment'?
**************************************
Show single catchment is activated by default when you are in the health facility detail.

For instance:

.. image:: /content/_images/single_catchment_on.png
          :align: center
|

When single catchment is toggled off, all catchments are visible, even when you are in the detail of a health facility:

For instance:

.. image:: /content/_images/single_catchment_off.png
          :align: center
|

How do I synchronize my data?
******************************
Check :ref:`synchronization`.
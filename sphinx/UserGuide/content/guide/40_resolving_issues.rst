Resolving Issues
****************

Health Facilities and Settlements
==================================

All health facilities and settlements listed in these dropdowns require some kind of additional information. For health facilities, information on facility type or ownership may be required; for settlements, the most common issue is the automatically generated names that were discussed in :ref:`machine_generated`.

Health Facility Issues
----------------------

For example:

* Aishe Oja Primary Health Center require information on ownership
* Babanla Primary Health Care require information on ownership

Settlement Issues
-----------------

For example:

* HA_1028592 needs a proper name
* HA_1028112 needs a proper name

These machine-generated names should be replaced with actual settlement names where possible, using information from field surveys, local knowledge, or existing maps.

Geometry Data Completion
=========================

Types of Geometry Issues
------------------------

* **Health facilities** that are assigned to a neighboring ward
* **Settlements** that are assigned to a neighboring ward  
* **Settlement points** that do not intersect with their assigned settlement boundary

These discrepancies need to be reviewed on an individual basis. 

Population Discrepancies
=========================

This section shows cases where there are significant differences between field-estimated population and the computed population estimation. You can mark this for review so that others can check whether population values here should be updated.

Managing Population Discrepancies
----------------------------------

When field estimates differ significantly from modeled estimates:

#. **Investigate the cause** - could be due to:
   
   * Recent population growth or decline
   * Inaccurate settlement boundaries
   * Seasonal population variations
   * Errors in field survey data

#. **Decide on appropriate action**:
   
   * Accept field estimate if recent and reliable
   * Investigate boundary accuracy
   * Flag for additional field verification
   * Use averaged estimate if both sources are uncertain

.. _ward_boundary_change:
Boundary Correction
===================

Sometimes, it's necessary to correct the ward boundaries.

.. warning::
   Boundary corrections should only be done if you are sure there is an error. Where possible, it is always recommended to gain information from the field before updating boundaries.

Boundary Correction Process
---------------------------

#. Expand the **Boundary Correction** tab and then click on **New Boundary Modification**
#. Follow the instructions in the pop-up box and draw a shape following the river that will modify the operational boundary
#. Double-click once you have finished the shape
#. Now you need to select if this part should be added to the ward or subtracted from it. If the delineated part should be part of the neighboring ward you need to **subtract** it. Click **Difference**. If the delineated part should be added to the current ward, you need to **add** it, click **Union**.
#. You can optionally add a comment - for instance you can specify where this part should go, in case you know: 'This should be part of the ward XYZ' or some such.

If you want to see the modifications you did, you can click on them once they have been created. 

.. image:: /content/_images/boundary_correction.png
      :align: center
|

.. important::
      Ward boundary changes are applied to a separate boundary layer that is not used for catchment calculations of the ongoing rounds. These corrected boundaries are part of the export and can be used to update the geospatial database for the next round of microplanning.
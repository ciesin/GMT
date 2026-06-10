# -*- coding: utf-8 -*-


from pathlib import Path

class GeomTypes(object):
    POLYGON = "POLYGON"
    MULTIPOLYGON = "MULTIPOLYGON"
    POINT = "POINT"
    NONE = "NONE"
    GEOMETRY_TYPE_NONE = "NONE"
    MULTILINESTRING = "MULTILINESTRING"
    LINESTRING = "LINESTRING"


class Config(object):
    
   WORKING_FOLDER = Path("/data/working")

   LogPath = WORKING_FOLDER / "logs" / "log"

   RASTER_INPUT_DIR = Path("/data/rasters/input")

   POP_RASTER_INPUT = RASTER_INPUT_DIR / "NGA_population_v2_0_gridded.tif"
   POP_RASTER_OUTPUT = WORKING_FOLDER / "pop_proj_3857.tif"

   FRICTION_WALK_RASTER_INPUT = RASTER_INPUT_DIR / "nga_walk_fiction_surface_in_min.tif"
   FRICTION_WALK_RASTER_OUTPUT = WORKING_FOLDER / "friction_proj_3857.tif"
   FRICTION_MIXED_RASTER_INPUT = RASTER_INPUT_DIR / "nga_mix_fiction_surface_in_min.tif"
   FRICTION_MIXED_RASTER_OUTPUT = WORKING_FOLDER / "friction_mixed_proj_3857.tif"

   # CLEAN = True
   CLEAN = False
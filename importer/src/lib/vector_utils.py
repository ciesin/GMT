from __future__ import annotations
import pyproj
import fiona
from fiona.crs import from_epsg
import psycopg2
from typing import Union, List, Dict, Tuple, Any
from functools import wraps
from pathlib import Path
from shapely import wkt
from shapely.ops import unary_union
from shapely.affinity import scale
from shapely.ops import transform
from shapely.geometry import mapping, box
from shapely.geometry.base import BaseGeometry as ShapelyGeometry
from shapely.geometry import Point as ShapelyPoint
from shapely.geometry import LineString as ShapelyLineString
from shapely.geometry import Polygon as ShapelyPolygon
from shapely.geometry.collection import GeometryCollection as ShapelyGeometryCollection
from shapely.geometry import MultiPoint as ShapelyMultiPoint
from shapely.geometry import MultiLineString as ShapelyMultiLineString
from shapely.geometry import MultiPolygon as ShapelyMultiPolygon
from lib.db_utils import get_geometry_column, table_exists, get_single_value, get_results, get_row_count



class Geometry():
    """
    A base class to work with individual geometry objects abstracting a shapely geometry object.
    Because shapely is completely agnostic to Spatial Reference Systems (SRS), this class ensures
    that SRS info is kept together with the geometries.
    The class works as a wrapper around an encapsulated shapely geometry and therefore provides
    access to all shapely methods and attributes (Including an auto-transformation of between
    different SRS and type conversion to Geometry objects).
    This class is not meant for working with large collections with geometry objects but can be
    used as a common geometry interface for individual operations.

    Attention:
    ----------
    Shapely is also agnostic to the antimeridian and problems related to this. All geometries
    crossing the IDL (antimeridian) might cause problems at the current state. Be careful!
    """

    _geometry: ShapelyGeometry = None
    _srid: int = 4326
    __wrapper_cache: dict = {}
    __max_bounds: tuple = None
    __cross_idl: bool = None

    @property
    def geometry(self):
        return self._geometry
    @geometry.setter
    def geometry(self, geometry):
        if not isinstance(geometry, ShapelyGeometry):
            raise Exception(f'Invalid geometry type "{type(geometry).__name__}" for geometry)')
        else:
            self._geometry = geometry
            self.__cross_idl = None
            self.__wrapper_cache = {}

    @property
    def srid(self):
        return self._srid
    @srid.setter
    def srid(self, srid):
        try:
            self._srid = srid if isinstance(srid, int) else int(str(srid).lower().replace('epsg:', ''))
            self.__max_bounds = None
        except:
            raise Exception(f'Invald SRID type "{type(srid).__name__}" for geometry')

    @property
    def geometry_type(self):
        return self.geometry.geom_type

    @property
    def wkt(self):
        return self.geometry.wkt if self.geometry else None

    @property
    def is_point(self):
        return self.geometry_type.lower() == 'point'

    @property
    def is_linestring(self):
        return self.geometry_type.lower() == 'linestring'

    @property
    def is_polygon(self):
        return self.geometry_type.lower() == 'polygon'

    @property
    def max_bounds(self):
        """The max bounds allowed by CRS"""
        if not self.__max_bounds:
            if self.srid == 4326:
                self.__max_bounds = (-180,-90,180,90)
            else:
                self.__max_bounds = transform_geometry(
                    pyproj.CRS(self.srid).area_of_use.bounds,
                    4326,
                    self.srid
                ).bounds
        return self.__max_bounds

    @property
    def cross_idl(self):
        """True if the geometry crosses the international dateline"""
        # TODO: Make sure we properly handle MultiGeometries as their envelope might cross but not its geometries
        if self.geometry is None:
            return False
        else:
            if self.__cross_idl is None:
                w, s, e, n = self.envelope.bounds
                max_w, max_s, max_e, max_n = self.max_bounds
                self.__cross_idl = any((w < max_w, e > max_e, e < w))
            return self.__cross_idl

    def __repr__(self):
        return f'<{self.__class__.__name__} object (Type: {self.geometry_type.capitalize()}, EPSG:{self.srid})>'

    def __init__(self,
        geometry: Union[
            str,
            List[Union[int, float]],
            Tuple[Union[int, float]],
            ShapelyGeometry
        ],
        srid: int = 4326):
        """
        Initializes a geometry object from
        - a WKT string,
        - bounds list or tuple
        - a shapely geometry.
        and assumes the geometries to be in SRS EPSG:4326 if not otherwise identified
        """
        try:
            self.srid = srid
            if isinstance(geometry, str):
                self.geometry = wkt.loads(geometry)
            elif isinstance(geometry, list) and len(geometry) == 4:
                self.geometry = box(*geometry)
            elif isinstance(geometry, tuple) and len(geometry) == 4:
                self.geometry = box(*geometry)
            elif isinstance(geometry, list) and len(geometry) == 2:
                self.geometry = ShapelyPoint(*geometry)
            elif isinstance(geometry, tuple) and len(geometry) == 2:
                self.geometry = ShapelyPoint(*geometry)
            elif isinstance(geometry, ShapelyGeometry):
                self.geometry = geometry
            else:
                raise Exception(f'Unsupported type "{type(geometry).__name__}"')
        except Exception as e:
            raise Exception(f'Failed to create geometry ({e})')

    def __wrap_shapely_method(self, name, method):
        """
        Creates a cached wrapper method for an encapsulated shapely object method.
        The wrapper converts native shapely geometries to Geometries and does the same
        vice versa with the results of the shapely method.
        """
        try:
            return self.__wrapper_cache[name]
        except KeyError:
            @wraps(method)
            def wrapper(*args, **kwargs):
                # Automatically convert Geometry objects to shapely objects and transform when necessary (SRID != SRID)
                """
                TODO: Make sure we handle problems with geometries crossing the IDL - Strategies for this could be:
                - Split any geometry at the IDL into 2 parts, for instance a IDL crossing Polygon would become a MultiPolygon
                  having a "eastern" and "western" polygons
                - Temporarily shift the Polygons by the maximum easting
                - ...
                """
                args = tuple([a.transform(self.srid).geometry if isinstance(a, Geometry) else a for a in args])
                kwargs = {k:(v.transform(self.srid).geometry if isinstance(v, Geometry) else v) for k,v in kwargs.items()}
                # Call shapely method with modified arguments
                results = method(*args, **kwargs)
                # Convert returned native shapely geometries back to a Geometries
                results = (results,) if not isinstance(results, tuple) else results
                return self.__wrap_shapely_result(*results)
            self.__wrapper_cache.update({
                 name: wrapper
            })
            return wrapper

    def __wrap_shapely_result(self, *results: Union[Any, List[Any]]):
        """
        Converts any shapley attribute or result returned from a shapley method into a Geometry object.
        By this, we can access any shapely method via the Geometry object and receive Geometry objects
        wrapping the resulting shapely geometries.
        """
        modified_results = [Geometry(r, self.srid) if isinstance(r, ShapelyGeometry) else r for r in results]
        modified_results = [GeometryCollection(r, self.srid) if GeometryCollection._is_shapely_collection(r) else r for r in modified_results]

        return tuple(modified_results) if len(modified_results) > 1 else modified_results[0]

    def __getattr__(self, name):
        """
        Attribute wrapper, returning attributes of the encapsulated shapely geometry.
        This allows to work with Geometry objects like they are native shapely objects.
        The wrapped functions automatically handle SRS transformation if required.
        This means, geometries with different SRIDs can be used together and the transformation
        between them happens automatically. Returned shapely geomtries will also be returned as
        Geometry objects.
        """
        try:
            attribute = self.geometry.__getattribute__(name)
            if callable(attribute):
                return self.__wrap_shapely_method(name, attribute)
            else:
                return self.__wrap_shapely_result(attribute)
        except Exception as e:
            raise e

    def transform(self, srid: int = 4326):
        """Returns a new transformed geometry. If not specified, we assume EPSG:4326 as target SRID."""
        return transform_geometry(self, out_srid=srid)

    def scale(self, factor: Union[float, int], origin: Union[str, List[float]] = 'center') -> Geometry:
        """Returns a scaled version of this geometry by the numerical factor"""
        return scale_geometry(self, factor, origin)

    def merge_with(self, geometries: Union[Geometry, List[Geometry], Tuple[Geometry]]) -> Geometry:
        """Returns a new geometry by merging the specified geometries with this."""
        return merge_geometries([self] + [geometries] if isinstance(geometries, Geometry) else geometries, srid=self.srid)

    def to_file(self, path: Union[str, Path], overwrite: bool = False):
        """Write geometry to a file"""
        geometries_to_file(self, path, overwrite)



class GeometryCollection():
    """
    A simple collection of homogeneous or heterogeneous geometry objects abstracting shapely
    geometry collections or vector files and spatial database tables (Similar to a Geopanda DataFrame)
    Not meant to work with large quantities of geometries for now, therefore it is just a
    straightforward list-like instance with a simple API to add geometries and iterate over them.
    A collection provides several aggregation functions over its set of geometries and works identically
    for in-memory geometries or database and file sources.
    A collection can only contain geometries of the same SRS. If none of the geometries or sources provides a SRID,
    we assume EPSG:4326 as the default SRS.
    TODO: Extend with certain aggregative functions (bounds of all geometries, total size, length, etc)
    TODO: Implement a generator Interface to avoid loading all geometries from a source into memory
    TODO: Discussion...replace the collection class by Geopandas or make this a wrapper to a geopanda DF?
    https://docs.python.org/3/library/collections.abc.html
    """

    _source = None
    _schema = None
    _table = None
    _column = None
    _geometry_type = None
    _geometries: Union[
        ShapelyMultiPoint,
        ShapelyMultiLineString,
        ShapelyMultiPolygon,
        ShapelyGeometryCollection
    ] = None
    _srid: int = 4326

    @property
    def geometries(self):
        return self._geometries
    @geometries.setter
    def geometries(self, geometries):
        if not self.__class__._is_shapely_collection(geometries):
            raise Exception(f'Invalid geometry collection type "{type(geometries)}" for collection)')
        else:
            self._geometries = geometries

    @property
    def srid(self):
        return self._srid
    @srid.setter
    def srid(self, srid):
        try:
            if self._source:
                raise Exception(f'Cannot change SRID of {"database" if self.is_database else "file collection"}')
            elif len(self) == 0:
                self._srid = srid if isinstance(srid, int) else int(str(srid).lower().replace('epsg:', ''))
            else:
                raise Exception(f'Cannot change SRID of non-empty collection')
        except Exception as e:
            raise Exception(f'Invald SRID type "{type(srid).__name__}" for collection ({e})')

    @property
    def geometry_type(self):
        if self.is_memory:
            if isinstance(self.geometries, ShapelyGeometryCollection):
                return 'mixed'
            else:
                return (type(self.geometries).__name__ if self.geometries else 'unknown').lower().replace('multi', '')
        elif self.is_database or self.is_file:
            return self._geometry_type

    @property
    def is_memory(self):
        return self._source is None

    @property
    def is_file(self):
        return isinstance(self._source, Path)

    @property
    def is_database(self):
        return isinstance(self._source, psycopg2.extensions.connection)

    def __repr__(self):
        collection_type = 'Database' if self.is_database else ('File' if self.is_file else 'Memory')
        return f'<{self.__class__.__name__} (Source: {collection_type}, Type: {self.geometry_type.capitalize()}, EPSG:{self.srid})>'

    def __init__(self,
            geometries: Union[
                Geometry,
                ShapelyGeometry,
                ShapelyMultiPoint,
                ShapelyMultiLineString,
                ShapelyMultiPolygon,
                ShapelyGeometryCollection,
                List[Union[Geometry, ShapelyGeometry]],
                Tuple[Union[Geometry, ShapelyGeometry]],
            ] = None,
            source: Union[psycopg2.extensions.connection, Union[Path, str]] = None,
            schema: str = None,
            table: str = None,
            column: str = None,
            srid: int=4326
        ):
        """
        Initializes the collection by either a single geometry, a set of geometries or database/file sources.
        To read from a file, provide a Pathlike source. To read from a PostGIS database, provide a database connection
        together with schema and table (and optionally the geometry column).
        """
        self._source = source
        self._schema = schema
        self._table = table

        # Handle a database or file collection and read type/srid from source
        if self._source and all((self._source, self._schema, self._table)):
            self._column = column or get_geometry_column(conn=source, schema=schema, table=table) if all((source, schema, table)) else None
            try:
                try:
                    db_geom, db_srid = get_results(source, f"""
                        SELECT type,srid FROM geometry_columns WHERE f_table_schema = '{schema}' AND f_table_name = '{table}'
                    """)[0]
                except TypeError:
                    raise Exception(f'Failed to lookup spatial attributes for GeometryCollection (Database: {schema}.{table})')
                self._geometry_type = db_geom.lower().replace('multi', '')
                self._srid = db_srid
            except Exception as e:
                raise Exception(e)
        elif self._source:
            self._source = Path(self._source) if not isinstance(self._source, Path) else self._source
            try:
                with fiona.open(self._source, "r") as fh:
                    geometry_types = list(set([g['geometry']['type'].lower() for g in fh]))
                    if len(geometry_types) == 0:
                        self._geometry_type = 'unknown'
                    elif len(geometry_types) == 1:
                        self._geometry_type = geometry_types[0]
                    else:
                        self._geometry_type = 'mixed'
                    self._srid = int(str(fh.crs['init']).lower().replace('epsg:', ''))
            except Exception as e:
                raise Exception(f'Failed to read from "{self._source}" ({e})')

        # Handle geometry/shapely geometry collection and get type/srid or assume default
        elif geometries:
            if self.__class__._is_shapely_collection(geometries):
                self.srid = srid
                self.geometries = geometries
            else:
                if not isinstance(geometries, list) and not isinstance(geometries, tuple):
                    geometries = (geometries,)
                g_srids = tuple(set([g.srid if isinstance(g, Geometry) else None for g in geometries]))
                if len(g_srids) > 1:
                    raise Exception(f'Trying to add geometries with different SRS {g_srids} to same collection')
                elif g_srids[0] is None or len(g_srids) == 0:
                    self.srid = srid
                else:
                    self.srid = g_srids[0]
                self.geometries = self._collection_factory([g.geometry if isinstance(g, Geometry) else g for g in geometries])

        # Set at least the SRID
        else:
            self.srid = srid

    @classmethod
    def from_sql(cls, connection: psycopg2.extensions.connection, sql: str):
        # TODO: Implement or think about wrapping GeoPandas
        return cls()

    @staticmethod
    def _is_shapely_collection(geometries: Any) -> bool:
        return type(geometries) in (
            ShapelyMultiPoint,
            ShapelyMultiLineString,
            ShapelyMultiPolygon,
            ShapelyGeometryCollection
        )

    def _collection_factory(self, geometries) -> Union[
            ShapelyMultiPoint,
            ShapelyMultiLineString,
            ShapelyMultiPolygon,
            ShapelyGeometryCollection,
            List[Union[Geometry, ShapelyGeometry]],
            Tuple[Union[Geometry, ShapelyGeometry]]
        ]:
        if self.__class__._is_shapely_collection(geometries):
            return geometries
        else:
            geometry_types = list(set([g.geom_type.lower() for g in geometries]))
            if len(geometry_types) > 1:
                return ShapelyGeometryCollection(geometries)
            else:
                if 'point' in geometry_types[0]:
                    return ShapelyMultiPoint(geometries)
                elif 'line' in geometry_types[0]:
                    return ShapelyMultiLineString(geometries)
                if 'polygon' in geometry_types[0]:
                    return ShapelyMultiPolygon(geometries)

    def __len__(self):
        if self.is_memory:
            return 0 if not self._geometries else len(self._geometries)
        elif self.is_database:
            return int(get_single_value(self._source, f"""SELECT COUNT(*) FROM {self._schema}.{self._table}"""))
        elif self.is_file:
            with fiona.open(self._source, "r") as fh:
                return len(list(fh))

    @property
    def bounds(self) -> Geometry:
        if self.is_memory:
            return Geometry(box(*self._geometries.bounds)) if self._geometries else None
        elif self.is_database:
            try:
                return Geometry(get_results(self._source, f"""
                    SELECT ST_XMin(ext), ST_Ymin(ext), ST_XMax(ext), ST_Ymax(ext)
                    FROM (
                         SELECT ST_Extent({self._column}) AS ext FROM {self._schema}.{self._table}
                    ) as envelope
                """)[0], self.srid)
            except Exception as e:
                raise Exception(f'Failed to read bounds from database ({e})')
        elif self.is_file:
            try:
                with fiona.open(str(self._source), "r") as fh:
                    return Geometry(fh.bounds, self.srid)
            except Exception as e:
                raise Exception(f'Failed to read bounds from file "{self._source}" ({e})')

    def to_file(self, path: Union[str, Path], overwrite: bool  = False):
        """Write geometry to a file"""
        geometries_to_file(self, path, overwrite)



def geometries_to_file(
        geometries: Union[
            Geometry,
            ShapelyGeometry,
            List[Union[ShapelyGeometry, Geometry]],
            Tuple[Union[ShapelyGeometry, Geometry]],
            GeometryCollection
        ],
        file_path: Union[str, Path],
        overwrite: bool = False
    ):
    """
    Outputs a single or list of geometry objects to a file (path).
    Currently supported formats:
    - Shapefile
    TODO: Add more supported output file formats
    """

    # Check output
    file_path = Path(file_path) if isinstance(file_path, str) else file_path
    if not overwrite and file_path.exists():
        raise Exception(f'Cannot export geometry to existing file ({file_path})')
    elif not file_path.parent.exists():
        raise Exception(f'Cannot export geometry to non existing file ({file_path})')

    # Prepare geometries
    if not isinstance(geometries, GeometryCollection):
        try:
            geometries = GeometryCollection(geometries)
        except:
            raise Exception(f'Trying to export unsupported geometries ({geometries})')
    if len(geometries) == 0:
        raise Exception(f'No geometries found to export in ({geometries})')

    # Export shapefile
    if geometries.geometry_type in ('mixed'):
        raise Exception(f'cannot export multiple geometry types to shapefile ({geometries.geometry_type})')
    try:
        if geometries.is_memory:
            id = 0
            if file_path.suffix == '.shp':
                with fiona.open(
                    file_path,
                    'w',
                    driver='ESRI Shapefile',
                    crs=from_epsg(geometries.srid),
                    schema={
                        'geometry': geometries.geometry_type.capitalize(),
                        'properties': {'id': 'int'},
                    }
                ) as fh_out:
                    for g in geometries.geometries:
                        fh_out.write({
                            'geometry': mapping(g),
                            'properties': {'id': id},
                        })
                        id += 1
        elif geometries.is_database:
            pass #TODO: Implement database export as SHP file
        elif geometries.is_file:
            pass #TODO: Implement file copying or conversion from  another file format into SHP file
    except Exception as e:
        raise Exception(f'Cannot export geometry ({e})')



def transform_geometry(
        geometry: Union[str, List[float], Tuple[float], ShapelyGeometry, Geometry],
        in_srid: int = None,
        out_srid: int = 4326
    ) -> ShapelyGeometry:
    """
    Transforms a geometry, given either as WKT string,
    bounds list or shapely geometry and transforms it to the provided
    SRID. If no ouput SRID is provided, we assume EPSG:4326 as default taget.
    """
    try:
        if in_srid is None:
            try:
                in_srid = geometry.srid
            except AttributeError:
                raise Exception('Input SRID is None')
        if out_srid is None:
            raise Exception('Output SRID is None')
        if in_srid != out_srid:
            if isinstance(geometry, Geometry):
                if geometry.srid == out_srid:
                    return geometry
                else:
                    in_srid = geometry.srid
                    geometry = geometry.geometry
            elif not isinstance(geometry, ShapelyGeometry):
                geometry = Geometry(geometry).geometry
            project = pyproj.Transformer.from_crs(
                pyproj.CRS(f'EPSG:{in_srid}'),
                pyproj.CRS(f'EPSG:{out_srid}'),
                always_xy=True
            ).transform
            return Geometry(transform(project, geometry), srid=out_srid)
        else:
            return geometry if isinstance(geometry, Geometry) else Geometry(geometry, srid=out_srid)

    except Exception as e:
        raise Exception(f'Cannot transform geometry from "{in_srid}" to "{out_srid}" ({e})')



def scale_geometry(geometry: Geometry, factor: Union[int, float], origin: Union[str, List[float]] = 'center') -> Geometry:
    """
    Increases or decreases the size of the given extent by the provided decimal factor.
    By default, the center of the geometries box is used as origin, but other options include using the
    'centroid' ot a tuple of coordinates. Refer to the "shapely.affinity.scale" documentation for further details.
    """
    try:
        factor = float(factor) if isinstance(factor, int) else factor
        return Geometry(scale(geometry.geometry, factor, factor, origin='center'), geometry.srid)
    except Exception as e:
        raise Exception(f'Cannot scale geometry by factor "{factor}" ({e})')



def merge_geometries(geometries: Union[List[Geometry], Tuple[Geometry]], srid: int = None) -> Geometry:
    """
    Merges the provided geometries into one new geometry. If geometries are not of in the same SRID,
    we use the first geometries SRID if not otherwise specified.
    """
    try:
        srid = srid or geometries[0].srid
        geometries = [g.transform(srid) if g.srid != srid else g for g in geometries]
        return Geometry(
            unary_union(
                [g.transform(srid) if g.srid != srid else g for g in geometries]
            ), srid)
    except Exception as e:
        raise Exception(f'Cannot merge geometries ({e})')
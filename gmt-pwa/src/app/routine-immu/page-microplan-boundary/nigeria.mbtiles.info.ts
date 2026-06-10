// output from nodejs-server/src/app.ts of this.logger.info("mbtiles info :",mbtiles.getInfo());
const infos = {
  basename: 'africa_nigeria.mbtiles',
  id: 'openmaptiles',
  filesize: 952094720,
  tilejson: '2.1.0',
  pixel_scale: '256',
  maskLevel: '5',
  scheme: 'xyz',
  format: 'pbf',
  attribution: '<a href=https://www.maptiler.com/copyright/ target=_blank>&copy; MapTiler</a> <a href=https://www.openstreetmap.org/copyright target=_blank>&copy; OpenStreetMap contributors</a>',
  description: 'Region Nigeria extract from https://data.maptiler.com',
  center: [8.6788755, 8.284736, 14],
  name: 'OpenMapTiles',
  maxzoom: 14,
  bounds: [2.678891, 2.674022, 14.67886, 13.89545],
  minzoom: 0,
  generator: 'MapTiler Data',
  planettime: '1635724800000',
  mtime: '1635834852000',
  version: '3.12.2',
  vector_layers: [
    {
      id: 'water',
      description: 'Water polygons representing oceans and lakes. Covered watered areas are excluded (`covered=yes`).\n' +
        'On low zoom levels all water originates from Natural Earth. To get a more correct display of the south pole you should also\n' +
        'style the covering ice shelves over the water.\n' +
        'On higher zoom levels water polygons from [OpenStreetMapData](http://osmdata.openstreetmap.de/) are used.\n' +
        'The polygons are split into many smaller polygons to improve rendering performance.\n' +
        'This however can lead to less rendering options in clients since these boundaries show up. So you might not be\n' +
        'able to use border styling for ocean water features.',
      minzoom: 0,
      maxzoom: 14,
      fields: [Object]
    },
    {
      id: 'waterway',
      description: 'OpenStreetMap [waterways](https://wiki.openstreetmap.org/wiki/Waterways) for higher zoom levels (z9 and more)\n' +
        'and Natural Earth rivers and lake centerlines for low zoom levels (z3 - z8).\n' +
        'Linestrings without a name or which are too short are filtered\n' +
        'out at low zoom levels.\n' +
        'Till z11 there is `river` class only, in z12 there is also `canal` generated,\n' +
        'starting z13 there is no generalization according to `class` field applied.\n' +
        'Waterways do not have a `subclass` field.',
      minzoom: 0,
      maxzoom: 14,
      fields: [Object]
    },
    {
      id: 'landcover',
      description: 'Landcover is used to describe the physical material at the surface of the earth. At lower zoom levels this is\n' +
        'from Natural Earth data for glaciers and ice shelves and at higher zoom levels the landcover is [implied by OSM tags](http://wiki.openstreetmap.org/wiki/Landcover). The most common use case for this layer\n' +
        '  is to style wood (`class=wood`) and grass (`class=grass`) areas.',
      minzoom: 0,
      maxzoom: 14,
      fields: [Object]
    },
    {
      id: 'landuse',
      description: 'Landuse is used to describe use of land by humans. At lower zoom levels this is\n' +
        'from Natural Earth data for residential (urban) areas and at higher zoom levels mostly OSM `landuse` tags.',
      minzoom: 0,
      maxzoom: 14,
      fields: [Object]
    },
    {
      id: 'mountain_peak',
      description: '[Natural peaks](http://wiki.openstreetmap.org/wiki/Tag:natural%3Dpeak)',
      minzoom: 0,
      maxzoom: 14,
      fields: [Object]
    },
    {
      id: 'park',
      description: 'The park layer contains parks from OpenStreetMap tagged with\n' +
        '[`boundary=national_park`](http://wiki.openstreetmap.org/wiki/Tag:boundary%3Dnational_park),\n' +
        '[`boundary=protected_area`](http://wiki.openstreetmap.org/wiki/Tag:boundary%3Dprotected_area),\n' +
        'or [`leisure=nature_reserve`](http://wiki.openstreetmap.org/wiki/Tag:leisure%3Dnature_reserve).',
      minzoom: 0,
      maxzoom: 14,
      fields: [Object]
    },
    {
      id: 'boundary',
      description: 'Contains administrative boundaries as linestrings.\n' +
        'Until z4 [Natural Earth data](http://www.naturalearthdata.com/downloads/) is used after which\n' +
        'OSM boundaries ([`boundary=administrative`](http://wiki.openstreetmap.org/wiki/Tag:boundary%3Dadministrative))\n' +
        'are present from z5 to z14 (also for maritime boundaries with `admin_level <= 2` at z4).\n' +
        'OSM data contains several [`admin_level`](http://wiki.openstreetmap.org/wiki/Tag:boundary%3Dadministrative#admin_level)\n' +
        'but for most styles it makes sense to just style `admin_level=2` and `admin_level=4`.',
      minzoom: 0,
      maxzoom: 14,
      fields: [Object]
    },
    {
      id: 'aeroway',
      description: 'Aeroway polygons based of OpenStreetMap [aeroways](http://wiki.openstreetmap.org/wiki/Aeroways).\n' +
        'Airport buildings are contained in the **building** layer but all\n' +
        'other airport related polygons can be found in the **aeroway** layer.',
      minzoom: 0,
      maxzoom: 14,
      fields: [Object]
    },
    {
      id: 'transportation',
      description: '**transportation** contains roads, railways, aerial ways, and shipping\n' +
        ' lines.\n' +
        'This layer is directly derived from the OSM road hierarchy.\n' +
        'At lower zoom levels major highways from Natural Earth are used.\n' +
        'It contains all roads from motorways to primary, secondary and\n' +
        'tertiary roads to residential roads and\n' +
        'foot paths. Styling the roads is the most essential part of the map.\n' +
        'The `transportation` layer also contains polygons for features like plazas.',
      minzoom: 0,
      maxzoom: 14,
      fields: [Object]
    },
    {
      id: 'building',
      description: 'All [OSM Buildings](http://wiki.openstreetmap.org/wiki/Buildings). All building tags are imported ([`building=*`](http://wiki.openstreetmap.org/wiki/Key:building)). The buildings are not yet ready for 3D rendering support and any help to improve\n' +
        'this is welcomed.',
      minzoom: 0,
      maxzoom: 14,
      fields: [Object]
    },
    {
      id: 'water_name',
      description: 'Lake center lines for labelling lake bodies.\n' +
        'This is based of the [osm-lakelines](https://github.com/lukasmartinelli/osm-lakelines) project\n' +
        'which derives nice centerlines from OSM water bodies. Only the most important lakes contain labels.',
      minzoom: 0,
      maxzoom: 14,
      fields: [Object]
    },
    {
      id: 'transportation_name',
      description: 'This is the layer for labelling the highways. Only highways that are named `name=*` and are long enough\n' +
        'to place text upon appear. The OSM roads are stitched together if they contain the same name\n' +
        'to have better label placement than having many small linestrings.\n' +
        'For motorways you should use the `ref` field to label them while for other roads you should use `name`.',
      minzoom: 0,
      maxzoom: 14,
      fields: [Object]
    },
    {
      id: 'place',
      description: 'The place layer consists out of [countries](http://wiki.openstreetmap.org/wiki/Tag:place%3Dcountry),\n' +
        '[states](http://wiki.openstreetmap.org/wiki/Tag:place%3Dstate) and [cities](http://wiki.openstreetmap.org/wiki/Key:place).\n' +
        'Apart from the roads this is also one of the more important layers to create a beautiful map.\n' +
        'We suggest you use different font styles and sizes to create a text hierarchy.',
      minzoom: 0,
      maxzoom: 14,
      fields: [Object]
    },
    {
      id: 'housenumber',
      description: 'Everything in OpenStreetMap which contains a `addr:housenumber` tag useful for labelling housenumbers on a map.\n' +
        'This adds significant size to *z14*. For buildings the centroid of the building is used as housenumber.',
      minzoom: 0,
      maxzoom: 14,
      fields: [Object]
    },
    {
      id: 'poi',
      description: '[Points of interests](http://wiki.openstreetmap.org/wiki/Points_of_interest) containing\n' +
        'a of a variety of OpenStreetMap tags. Mostly contains amenities, sport, shop and tourist POIs.',
      minzoom: 0,
      maxzoom: 14,
      fields: [Object]
    },
    {
      id: 'aerodrome_label',
      description: '[Aerodrome labels](http://wiki.openstreetmap.org/wiki/Tag:aeroway%3Daerodrome)',
      minzoom: 0,
      maxzoom: 14,
      fields: [Object]
    }
  ]
}


ALTER TABLE health_facility.point
ADD COLUMN    raster_width     integer          default 0                not null,
    ADD COLUMN raster_height    integer          default 0                not null,
    ADD COLUMN origin_x         double precision default 0                not null,
    ADD COLUMN origin_y         double precision default 0                not null,
    ADD COLUMN catchment_raster bit varying      default ''::bit varying  not null ;



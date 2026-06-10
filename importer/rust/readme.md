Raster redim -- COD bottom up
```bash
cd /rust_pop_util && \
cargo run --bin raster_redim \
--release -- \
--input /country_specific/COD/input/raster/COD_population_v2_0_gridded/COD_population_v2_0_gridded.tif \
--snap /country_specific/COD/input/cod_ppp_2020_adjusted.tif \
--output /country_specific/COD/working/COD_population_v2_0_gridded_adjusted.tif \
--clean
```

Raster redim -- COD peanut butter
```bash
cd /rust_pop_util && \
cargo run --bin raster_redim \
--release -- \
--input /country_specific/COD/input/raster/PeanutButter/COD_population_202011031515.tif \
--snap /country_specific/COD/input/cod_ppp_2020_adjusted.tif \
--output /country_specific/COD/working/COD_population_202011031515_adjusted.tif \
--clean
```


Building count
```bash
cd /rust_pop_util && \
cargo run --bin raster_building_count \
--release -- \
--snap /country_specific/COD/input/cod_ppp_2020_adjusted.tif \
--output /country_specific/COD/working/building_count.tif \
--rtree_building /country_specific/COD/working/rust_data/buildings/buildings.rtree \
--clean
```

RPE
worldpop basic
worldpop bottom up
worldpop peanut butter

Raster comparison

```bash
cd /rust_pop_util && \
cargo run --bin raster_comparison \
--release -- \
--cfg /country_specific/COD/input/raster/raster_comparison.toml 
```

Deserialize
```bash
cd /rust_pop_util && \
cargo run --bin ts  
```



Getting pb

https://apps.worldpop.org/peanutButter/

Urban /rural from PSPP thing
70% for urban, 100% for rural
1 res unit for urban & rural


To compile in windows, might need to copy C:\Osgeo4w64\lib\geos_c.lib to .\target\debug\deps for both rust_bldg and rust_pop_util

```
copy c:\OSGeo4W64\lib\geos_c.lib d:\git\pop_model\rust\target\debug\deps
copy c:\OSGeo4W64\lib\geos_c.lib d:\git\pop_model\rust\target\release\deps

copy "c:\Program Files\PostgreSQL\12\lib\libpq.lib" d:\git\pop_model\rust\target\debug\deps
copy c:\OSGeo4W64\lib\proj.lib d:\git\pop_model\rust\target\debug\deps
```



# Bindgen (Gdal bindings for rust)

cargo install bindgen
rust_gdal/gen_binding.sh




Restore eTally VTS backup

set PGPASSWORD=postgres
"C:\Program Files\PostgreSQL\11\bin\pg_restore.exe" --dbname=vts --verbose --port=5433 --username=postgres --format=c "D:\GRID\Sharing\CompletedPopModels\nigeria_eoc_20180116_1643.bak"


```
rm /country_specific/ZMB/working/zmb_rpe_top_down_2020_12.tif && \
cp "/country_specific/ZMB/working/zmb_rpe_top_down_2020_12 - Copy.tif" \
/country_specific/ZMB/working/zmb_rpe_top_down_2020_12.tif && \
cargo run --release --bin raster_diff -- \
set-no-data \
--input-raster \
"/country_specific/ZMB/working/zmb_rpe_top_down_2020_12.tif" \
--nodata-raster "/country_specific/ZMB/working/admin_0.tif"
```

```
cargo run --release --bin raster_diff -- \
diff \
/country_specific/ZMB/working/rust_comparison_data/ZMB_population_202011121243_snapped.tif \
/country_specific/ZMB/working/zmb_rpe_top_down_2020_12.tif \
--output /country_specific/ZMB/working/pb_minus_rpe.tif \
--color-ramp /country_specific/ZMB/working/pb_minus_rpe.txt \
--clean
```


```
rsync --progress --verbose -r /mnt/d/git/pop_model/country_specific/BEN/input/ /home/eric/git/pop_model/country_specific/BEN/input

sudo chown -R eric:eric /home/eric/git/pop_model/country_specific/BEN/working

rsync --progress --verbose \
--times \
-r \
--exclude '.ipynb_checkpoints' \
--exclude '__pycache__' \
/mnt/d/git/pop_model/country_specific/BEN/working/ \
/home/eric/git/pop_model/country_specific/BEN/working 

rsync --progress --verbose -r /mnt/d/git/pop_model/country_specific/NGA/input/ /home/eric/git/pop_model/country_specific/NGA/input

rsync --progress --verbose --times \
-r \
/mnt/d/git/pop_model/country_specific/CENSUS/input/microcensus/ \
/home/eric/git/pop_model/country_specific/CENSUS/input/microcensus

rsync --progress --verbose -r /mnt/d/git/pop_model/country_specific/CMR/input/ /home/eric/git/pop_model/country_specific/CMR/input

rsync --progress --verbose \
--times \
-r \
--exclude '.ipynb_checkpoints' \
--exclude '__pycache__' \
/mnt/d/git/pop_model/country_specific/ZMB/input/ \
/home/eric/git/pop_model/country_specific/ZMB/input 

rsync --progress --verbose \
--times \
-r \
--exclude '.ipynb_checkpoints' \
--exclude '__pycache__' \
/mnt/d/git/pop_model/country_specific/BEN/input/ \
/home/eric/git/pop_model/country_specific/BEN/input 

rsync --progress --verbose \
--times \
-r \
--exclude '.ipynb_checkpoints' \
--exclude '__pycache__' \
/mnt/d/git/pop_model/country_specific/COG/input/ \
/home/eric/git/pop_model/country_specific/COG/input 

sudo rsync --progress --verbose \
--times \
-r \
--exclude '.ipynb_checkpoints' \
--exclude '__pycache__' \
/home/eric/git/pop_model/country_specific/COG/working/ \
/mnt/d/git/pop_model/country_specific/COG/working
 

rsync --progress --verbose \
--times \
-r \
--exclude '.ipynb_checkpoints' \
--exclude '__pycache__' \
/mnt/d/git/pop_model \
/home/eric/git/pop_model \
--exclude="country_specific" \
--exclude="target" \
--exclude=".git" \
--exclude="node_modules" \
--include="*/" --include="*.sh" \
--include="*.yml" \
--exclude="*" 


rsync --progress --verbose \
--archive \
-r \
--exclude '.ipynb_checkpoints' \
--exclude '__pycache__' \
/mnt/d/git/pop_model/country_specific/NGA/src/ \
/home/eric/git/pop_model/country_specific/NGA/src \
&& \
rsync --progress --verbose \
--archive \
-r \
--exclude '.ipynb_checkpoints' \
--exclude '__pycache__' \
/mnt/d/git/pop_model/src/common/ \
/home/eric/git/pop_model/src/common \
&& \
rsync --progress --verbose \
--archive \
-r -m \
/mnt/d/git/pop_model/rust/ \
/home/eric/git/pop_model/rust \
--exclude 'target' \
--include="*/" --include="*.rs" \
--exclude="*" 
```

```
jupyter notebook --ip 0.0.0.0 --allow-root &
```

# Running WSL in WSL2 container

2 x WSL Prompt

```
cd ~/git/pop_model
./docker/binbash.sh
```

This copies changed files with rsync to wsl2 container
```
cd ~/git/pop_model
cp /mnt/d/git/pop_model/*.sh /home/eric/git/pop_model && chmod 755 ./copy.sh && ./copy.sh 8
```


# Web tools

## Start WFS bridge


(with docker binbash.sh container running in WSL2 VM)
```
cd ~/git/pop_model
./raster_wfs.sh
```

or on GeoPC1

```
D:\git\pop_model\docker\binbash.bat
/run_pop_model.sh WEBCMP 10 
```

## Start QGIS Server

```
cd ~/git/pop_model
./qgis_server.sh
```

or on geopc1

```
D:
cd git\pop_model\docker
docker-compose -f docker-compose.yml -f docker-compose-dev.yml run --rm --service-ports qgis-server
```

QGIS data (relative paths) and projects:

```
D:\git\pop_model\qgis_server
```

http://localhost:8380/?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities

http://localhost:8380/?SERVICE=WFS&VERSION=1.3.0&REQUEST=GetCapabilities

## Web App

In command prompt

```
d:
cd d:\git\pop_model\web
npm run start
```
same on geopc1

## Notes

Rasters used by the WFS bridge -- 
```
\\wsl$\Ubuntu-20.04\home\eric\git\pop_model\country_specific\NGA\working
```

raster_wfs contents:

```shell
#!/bin/sh
set -x
set -e

# use in WSL2, sync over files
# need to have starting binbash.sh in WSL2
# may also need to sync input/working directories

rsync --progress --verbose \
--times \
-r \
--exclude '.ipynb_checkpoints' \
--exclude '__pycache__' \
/mnt/d/git/pop_model/rust/raster_wfs/ \
/home/eric/git/pop_model/rust/raster_wfs


cd /home/eric/git/pop_model/docker
export COMPOSE_PROJECT_NAME=pop_model

docker exec --tty \
$(docker ps -qf "name=pop-python") \
pkill -f raster_wfs || echo hey

docker exec --tty \
-e GDAL_DATA=/usr/local/lib/python3.8/dist-packages/fiona/gdal_data \
$(docker ps -qf "name=pop-python") \
/bin/bash -c 'cd /rust && cargo run --bin raster_wfs --release --'
```

```
touch /country_specific/NGA/working/buildings_1.fgb && \
rm /country_specific/NGA/working/buildings_1.fgb && \
touch /country_specific/NGA/working/buildings_2.fgb && \
rm /country_specific/NGA/working/buildings_2.fgb && \
ogr2ogr \
-t_srs EPSG:3857 \
-makevalid \
-progress \
-nlt MULTIPOLYGON \
-nlt PROMOTE_TO_MULTI \
-f FlatGeobuf \
-nln buildings_1 \
/country_specific/NGA/working/buildings_1.fgb \
/country_specific/NGA/input/buildings/AFRICA_NIGERIA_P1_building.gdb \
AFRICA_NIGERIA_P1_building_32631 \
AFRICA_NIGERIA_P1_building_32632 &&
ogr2ogr \
-t_srs EPSG:3857 \
-makevalid \
-progress \
-nlt MULTIPOLYGON \
-nlt PROMOTE_TO_MULTI \
-f FlatGeobuf \
-nln buildings_2 \
/country_specific/NGA/working/buildings_2.fgb \
/country_specific/NGA/input/buildings/AFRICA_NIGERIA_P2_building.gdb \
AFRICA_NIGERIA_P2_building_32631 \
AFRICA_NIGERIA_P2_building_32632_1 \
AFRICA_NIGERIA_P2_building_32632_2 \
AFRICA_NIGERIA_P2_building_32632_3 \
AFRICA_NIGERIA_P2_building_32633
 
```

In model but not Bottom-up
13.4365, 10.1467

In bottom up, but not RPE
13.8885, 11.1572

Neighborhood types, many
13.7770, 11.2252

PB, Bottom-up, RPE
2.9974, 6.5384
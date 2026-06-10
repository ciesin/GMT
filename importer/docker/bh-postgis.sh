#!/bin/sh
set -eu

cd /

git clone --depth 1 --branch stable-3.5 https://git.osgeo.org/gitea/postgis/postgis.git

cd /postgis

# Add postgresql package site
apt-get update
apt-get install -y curl ca-certificates lsb-release && \
    install -d /usr/share/postgresql-common/pgdg && \
    curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc --fail https://www.postgresql.org/media/keys/ACCC4CF8.asc && \
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list && \
    apt-get update

# Currently geopode is using postgresql 14; so use the same to build postgis
apt install -y postgresql-server-dev-14
apt install -y libprotobuf-dev libprotobuf-c-dev protobuf-c-compiler

sh autogen.sh

cp /build_gdal_version_changing/usr/include/*.h /usr/include
cp /build/usr/include/*.h /usr/include
cp -r /build_gdal_version_changing/usr/lib/x86_64-linux-gnu/* /usr/lib/x86_64-linux-gnu
cp /build/usr/local/lib/*.* /usr/lib/x86_64-linux-gnu
# checked /postgis/config.log for errors

# Proj dir is the one used in the dockerfile
PROJ_LIBS=/build/usr/local/lib/libinternalproj.so ./configure \
 --with-gdalconfig=/build_gdal_version_changing/usr/bin/gdal-config \
 --with-projdir="/build${PROJ_INSTALL_PREFIX-/usr/local}"

make
#!/bin/sh
set -eu

mkdir projstatic
wget -q "https://github.com/OSGeo/PROJ/archive/${PROJ_VERSION}.tar.gz" \
    -O - | tar xz -C projstatic --strip-components=1

cd projstatic
mkdir build
cd build

cmake ".." \
-DBUILD_SHARED_LIBS=OFF \
-DBUILD_TESTING=OFF \
-DBUILD_CCT=OFF \
-DBUILD_CS2CS=OFF \
-DBUILD_GEOD=OFF \
-DBUILD_GIE=OFF \
-DBUILD_PROJ=OFF \
-DBUILD_PROJINFO=OFF \
-DBUILD_PROJSYNC=OFF \
-DENABLE_CURL=OFF \
-DENABLE_TIFF=ON

cmake --build .

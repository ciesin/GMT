
cd /
git clone --depth 1 --branch 3.8.1 https://git.osgeo.org/gitea/geos/geos.git

cd geos
./autogen.sh
./configure  --disable-static
make -j4
make install
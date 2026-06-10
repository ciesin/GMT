cd /

git clone --depth 1 --branch 1.3.0 https://github.com/libkml/libkml

cd libkml

mkdir build
cd /libkml/build
cmake /libkml
#./configure --prefix=/home/eric/git/gdal_test/libkml_install
#./configure CXXFLAGS=-Wno-deprecated

make -j4
make install
# cargo install binding
cd "$(dirname "$0")"

bindgen ./wrapper.h --whitelist-function 'CPL.*' \
--whitelist-function 'CSL.*' \
--whitelist-function 'GDAL.*' --whitelist-function 'OGR.*' \
--whitelist-function 'OSR.*' --whitelist-function 'OCT.*' \
--whitelist-function 'VSI.*' --whitelist-type 'OGR.*' \
--ctypes-prefix libc --constified-enum-module '.*' > ./src/gdal_3_3.rs
# -- -x c++ -std=c++14
# -I /usr/include/linux -I /usr/lib/clang/6.0.0/include
fn main() {
    if cfg!(windows) {
		 println!(r"cargo:rustc-link-search=C:\Program Files\PostgreSQL\11\lib");
		println!(r"cargo:rustc-link-search=D:\PostgreSQL\12\lib");
		println!(r"cargo:rustc-link-search=C:\OSGeo4W64\bin");
		println!(r"cargo:rustc-link-search=C:\OSGeo4W64\lib");
        println!("cargo:rustc-env=GDAL_HOME={}", r"C:\OSGeo4W64");
        println!(r"cargo:rustc-link-search=C:\OSGeo4W64\bin");
        println!(r"cargo:rustc-link-search=C:\OSGeo4W64\lib");
    }
}
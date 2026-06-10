pub mod data_work {


    table! {
        data_work.neighborhood_types (neighborhood_type_id) {
            name -> Nullable<Varchar>,
            neighborhood_type_id -> Int4,
            avg_closest_bldg_m -> Nullable<Float4>,
            avg_building_area_m2 -> Nullable<Float4>,
        }
    }

    allow_tables_to_appear_in_same_query!(
        neighborhood_types,
    );

    #[derive(Queryable, Debug, Identifiable, AsChangeset, Default)]
    #[primary_key(neighborhood_type_id)]
    #[table_name = "neighborhood_types"]
    pub struct NeighborhoodTypes {
        pub name: Option<String>,
        pub neighborhood_type_id: i32,
        pub avg_closest_bldg_m: Option<f32>,
        pub avg_building_area_m2: Option<f32>,
    }
}
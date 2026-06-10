use anyhow::Result;
use crate::pq::PgConnection;
use gdal::vector::{FieldValue, OGRFieldType, Layer, FieldDefinition};

const POSTGRES_DB_CONN_STRING: &str = "postgresql://postgres:postgres@db:5432/postgres";

pub struct TestDbProperties {

    pub test_db_conn_string: String,
    //As GDAL expects it
    pub test_db_ogr_string: String,
    pub test_db_name: String
}

pub fn create_testdb(test_db_name: &str) -> Result<TestDbProperties>
{
    let props = TestDbProperties {
        test_db_conn_string: format!("postgresql://postgres:postgres@db:5432/{}", test_db_name),
        test_db_ogr_string: format!("PG: host=db dbname={} port=5432 user=postgres password=postgres", test_db_name),
        test_db_name: test_db_name.to_string()
    };
    let pg_conn = PgConnection::new(POSTGRES_DB_CONN_STRING)?;

    let query = format!("

				SELECT pg_terminate_backend(pg_stat_activity.pid)
				FROM pg_stat_activity
				WHERE pg_stat_activity.datname = '{dbName}'  AND pid <> pg_backend_pid();


", dbName = test_db_name);

    pg_conn.execute(&query).is_ok().unwrap();

    let query = format!("

				DROP DATABASE IF EXISTS {dbName}

", dbName = test_db_name);

    pg_conn.execute(&query).is_ok().unwrap();

    let query = format!("

		CREATE DATABASE {dbName} ENCODING 'UTF8' TEMPLATE template0

", dbName = test_db_name);

    pg_conn.execute(&query).is_ok().unwrap();

    let pg_conn = PgConnection::new(&props.test_db_conn_string)?;

    pg_conn.execute("CREATE SCHEMA data_work").is_ok().unwrap();
    pg_conn.execute("CREATE EXTENSION postgis").is_ok().unwrap();


    Ok(props)
}

pub fn build_layer_from_generic_attributes(lyr: &mut Layer, col_names: &[&str], att_values: &Vec<FieldValue>)
{
    assert_eq!(col_names.len(), att_values.len());

    for i in 0..col_names.len() {
        let column_name = col_names[i];
        let field_value = &att_values[i];
        let field_type = match field_value {
            FieldValue::IntegerValue(_) => OGRFieldType::OFTInteger,
            FieldValue::Integer64Value(_) => OGRFieldType::OFTInteger64,
            FieldValue::StringValue(_) => OGRFieldType::OFTString,
            FieldValue::RealValue(_) => OGRFieldType::OFTReal,
            FieldValue::DateValue(_) => OGRFieldType::OFTDate,
            FieldValue::DateTimeValue(_) => OGRFieldType::OFTDateTime,
            FieldValue::Null => OGRFieldType::OFTString,
            FieldValue::RealListValue(_) => OGRFieldType::OFTRealList
        };

        let field_defn = FieldDefinition::new(column_name, field_type).unwrap();
        field_defn.add_to_layer(lyr).unwrap();
    }

}
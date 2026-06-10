use gdal::vector::{Dataset, OGRFieldType, FieldDefinition, Layer};
use anyhow::{Result};

#[derive(Clone)]
pub struct InputColumnInfo {
    pub ogr_type: OGRFieldType::Type,
    pub name: String,
}

pub fn get_input_column_names(in_ogr_conn: &str, in_ogr_layer: &str,) -> Result<Vec<InputColumnInfo>>
{
    let mut list : Vec<InputColumnInfo> = Vec::new();

    let dataset = Dataset::open(in_ogr_conn)?;

    let layer = dataset.layer_by_name(in_ogr_layer)?;

    let layer_def = layer.layer_definition();

    for field in layer_def.fields() {

        let ci = InputColumnInfo {
                ogr_type: field.field_type(),
                name: field.name()
            };

        list.push(ci.clone());

    }

    Ok(list)
}

pub fn add_columns_to_layer(out_lyr: &mut Layer, input_columns: &[InputColumnInfo]) {
    for ci in input_columns.iter() {
        let field_defn = FieldDefinition::new(&ci.name, ci.ogr_type).unwrap();
        field_defn.add_to_layer(out_lyr).unwrap();
    }
}

import importlib
import pkgutil
import textwrap
from collections import OrderedDict
from dataclasses import field, dataclass
from pathlib import Path
from typing import Tuple, Union, List, Dict

import yaml
import importer.plugins.db_transforms
import importer.plugins.transforms
import importer.plugins.verifications
from lib import file_utils

from importer.constants import DirectoryLocations, Transformations, TransformationParams, YamlConfigConstants, \
    Verifications, VerificationParams, DbTransformations, AddColumnValueGenerators, GisFormats
from importer.util import sanitize_id, convert_markdown_to_html_and_pdf, ParamDocItem, DocItem, get_plugins


def represent_ordereddict(dumper, data):
    value = []

    for item_key, item_value in data.items():
        node_key = dumper.represent_data(item_key)
        node_value = dumper.represent_data(item_value)

        value.append((node_key, node_value))

    return yaml.nodes.MappingNode(u'tag:yaml.org,2002:map', value)


TransformationParams_Documentation: Tuple[ParamDocItem, ...] = (
    ParamDocItem(
        TransformationParams.COLUMN_NAME,
        "Specifies the column name.  Use lower case"),

    ParamDocItem(
        TransformationParams.MAPPING,
        "Defines the column mappings, renames from/to",
    ),
    ParamDocItem(
        TransformationParams.REPLACEMENTS,
        "Defines the string replacements.  string_from: string_to"
    ),
    ParamDocItem(
        TransformationParams.DATE_FORMAT,
        "Specifies a date format."
        "  See https://docs.python.org/3/library/datetime.html#strftime-and-strptime-behavior",
    ),

    ParamDocItem(
        TransformationParams.COLUMN_NAMES,
        "A list of column names",
    ),
    ParamDocItem(
        TransformationParams.TARGET_TABLE,
        "Defines name of the target table in the master schema.  The latest view will automatically be used, so only the latest committed version is used.  Must have already been populated with committed data.",

    ),
    ParamDocItem(
        TransformationParams.TARGET_COLUMN,
        "Defines the name of the target column in the target table",
    ),

    ParamDocItem(
        TransformationParams.SOURCE_COLUMN,
        "Defines the name of the source column in the staged table in the master gdb schema.  Must have already been populated with committed data",

    ),

    ParamDocItem(
        TransformationParams.COLUMN_VALUE,
        "Defines a single value to initialize a column or null value",
    ),

    ParamDocItem(
        TransformationParams.COLUMN_VALUE_GENERATOR,
        f"Defines how to generate new values.  Can use -- "
        f"\n    * {AddColumnValueGenerators.NEW_GUID} -- generate a uuid, {TransformationParams.COLUMN_VALUE} not required"


    ),

    ParamDocItem(
        TransformationParams.TARGET_JOIN_COLUMN,
        "Defines the name of the column in the target table used to do the join",

    ),
    ParamDocItem(
        TransformationParams.SOURCE_JOIN_COLUMN,
        "Defines the name of the column in the source/imported table used to do the join",

    ),

    ParamDocItem(
        TransformationParams.METHOD,
        f"Which method to do the geospatial join.  Can also specify a list to try multiple.  Generally useful for trying cover first, then intersect.  "
        f"Choices:\n    * {TransformationParams.CENTROID_COVERS} - Centroid of geometry of source table must be covered by the target table\n    "
        f"* {TransformationParams.SHAPE_INTERSECTS} - geometry of source table must be intersect the geometry of the target table\n    "
        f"* {TransformationParams.SHAPE_COVERS} - geometry of source table must be covered by the target table\n"

    ),

    ParamDocItem(
        VerificationParams.VALUES,
        "A list of valid values, case sensitive",
    ),

    ParamDocItem(
        VerificationParams.EXTENT,
        "Specifies an extent"
    ),

    ParamDocItem(
        VerificationParams.JOIN_COLUMN,
        "What attribute column in the imported table to join",

    ),

    ParamDocItem(
        TransformationParams.MATCHERS,
        "Defines matchers"
    ),

    ParamDocItem(
        TransformationParams.STRICT,
        "If true, any errors/exceptions that occur in the transform will be treated as errors.  Defaults to True.  If false, any errors during the transformation will be reported in the staging report but the staging process will continue."
    ),

    ParamDocItem(
        TransformationParams.CASE_SENSITIVE,
        "If true, the configured input must match match the case exactly.  AbC will not match ABC nor abc"
    ),

    ParamDocItem(
        VerificationParams.SHOW_AS_WARNINGS,
        "If true, any error found/reported by the verification/validator will be treated as a warning and as such will not prevent an import"
    ),

    ParamDocItem(
        VerificationParams.REGEX,
        "A regular expression that will be used by python"
    ),

    ParamDocItem(
        VerificationParams.INVERT_MATCH,
        "If true, then a match is when the regex does NOT match the text in the column"
    ),

    ParamDocItem(
        TransformationParams.COMMENTS,
        "This indicates the field is a comment and will be ignored by the scripts"
    )


)
DocItemList: List[DocItem] = [

    DocItem(
        YamlConfigConstants.TARGET_DB_TABLE_NAME,
        YamlConfigConstants.DB_FILTER,
        "Used to define a scope of what data in master is being replaced for the targetted layer/table.",
        extended_desc =
        "Data in master outside of this filter will not be altered, data inside this filter will be replaced/updated by the"
        " data being imported.  Normally, for complete datasets, this will be a state.  Input data set must match the db_filter.  If there is no db_filter"
        " defined, then the input dataset is assumed to be national.  "
        "Because of this, there generally should always be a scope.  The special value IN_STAGING_EXTENT will"
        " take the extent of the incoming data and use that as the scope.  This means any data in master outside of"
        " the extent will not be updated/altered, and anything inside will be replaced/updated.",
        explicit_yaml_examples=[
            {YamlConfigConstants.DB_FILTER: "state_code = 'BR'"},
            {YamlConfigConstants.DB_FILTER: "state_code = 'BR' AND IN_STAGING_EXTENT"}
        ]
    ),

    DocItem(
        YamlConfigConstants.TARGET_DB_TABLE_NAME,
        YamlConfigConstants.SKIP_DIFF_MAPS,
        "If set, will not render the maps showing the difference between 2 changed shapes.  Set to true for large data sets to save time",
        explicit_yaml_examples=[
            {YamlConfigConstants.SKIP_DIFF_MAPS: True}
        ]
    ),

    DocItem(
        YamlConfigConstants.TARGET_DB_TABLE_NAME,
        YamlConfigConstants.SKIP_BASEMAPS,
        "Will not fetch or render the basemaps in the stage & diff reports",
        explicit_yaml_examples=[
            {YamlConfigConstants.SKIP_BASEMAPS: True}
        ]
    ),

    DocItem(
        YamlConfigConstants.TARGET_DB_TABLE_NAME,
        YamlConfigConstants.PATH,
        "Set to the path *from the docker container* to the input data set",
        explicit_yaml_examples=[
            {YamlConfigConstants.PATH: '/data/input/borno_wards.shp'}
        ]
    ),

    DocItem(
        YamlConfigConstants.TARGET_DB_TABLE_NAME,
        YamlConfigConstants.TYPE,
        "Incoming data format",
        extended_desc="Only required if the type is PostgreSQL.  Otherwise it is inferred from the file extension",
        explicit_yaml_examples=[
            {YamlConfigConstants.TYPE: GisFormats.POSTGIS},
            {YamlConfigConstants.TYPE: GisFormats.SHAPEFILE},
            {YamlConfigConstants.TYPE: GisFormats.UNSPECIFIED},
        ]
    ),

    DocItem(
        YamlConfigConstants.TARGET_DB_TABLE_NAME,
        YamlConfigConstants.LAYER_NAME,
        "Layer name",
        extended_desc="Name in the data being staged.  Only required for formats that can have multiple layers (GDB, PostgreSQL database, etc.)"
        " and not required for formats that only can have 1 layer (Shapefile, GeoJSON, etc.)",
        explicit_yaml_examples=[
            {YamlConfigConstants.LAYER_NAME: "Boundary_VaccWards_Export"},
        ]
    ),

    DocItem(
        YamlConfigConstants.TARGET_DB_TABLE_NAME,
        YamlConfigConstants.ROW_LIMIT,
        desc="Used to set a row limit for testing purposes in order to test staging quickly",
        explicit_yaml_examples=[
            {YamlConfigConstants.ROW_LIMIT: 100}
        ]

    ),

    DocItem(
        YamlConfigConstants.TARGET_DB_TABLE_NAME,
        YamlConfigConstants.TRANSFORMATIONS,
        desc="In memory transformations, done using geopandas dataframes",
        explicit_yaml_examples=[
            {YamlConfigConstants.TRANSFORMATIONS: [
                OrderedDict({
                    TransformationParams.TRANSFORM_NAME: Transformations.ADD_COLUMN,
                    TransformationParams.COLUMN_NAME: "new_column"
                })
            ]}
        ]
    ),

    DocItem(
        YamlConfigConstants.TARGET_DB_TABLE_NAME,
        YamlConfigConstants.DB_TRANSFORMATIONS,
        desc="Transformations done in the staging schema, using PostgreSQL and PostGIS SQL Functions",
        explicit_yaml_examples=[
            {YamlConfigConstants.DB_TRANSFORMATIONS: [
                {
                    TransformationParams.TRANSFORM_NAME: DbTransformations.WARD_TO_STATE_CODE
                },
                OrderedDict({
                    TransformationParams.TRANSFORM_NAME: Transformations.DROP_COLUMNS,
                    TransformationParams.COLUMN_NAMES: ["unused_col1", "unused_col2"]
                })
            ]}
        ]
    ),

    DocItem(
        YamlConfigConstants.TARGET_DB_TABLE_NAME,
        YamlConfigConstants.USER_VERIFICATIONS,
        desc="Verifications run as part of the staging process",
        explicit_yaml_examples=[
            {
                YamlConfigConstants.USER_VERIFICATIONS: [
                    OrderedDict({
                        TransformationParams.TRANSFORM_NAME: Verifications.CHECK_NOT_NULL,
                        TransformationParams.COLUMN_NAME: "ward_code"
                    }),
                    OrderedDict({
                        TransformationParams.TRANSFORM_NAME: Verifications.CHECK_PARENT,
                        TransformationParams.JOIN_COLUMN: "ward_code",
                        TransformationParams.TARGET_TABLE: "boundary_wards"

                    })
                ]
            }
        ]
    ),

    DocItem(
        YamlConfigConstants.TARGET_DB_TABLE_NAME,
        YamlConfigConstants.LABEL_TEMPLATE,
        desc="How to label the item in the staging and diff reports",
        extended_desc="Anything inside a ${} will be treated as a column name."
             "${row_index} will be replaced by the row in the order in the staging table.",

        explicit_yaml_examples=[
            {YamlConfigConstants.LABEL_TEMPLATE: YamlConfigConstants.DEFAULT_LABEL_TEMPLATE},
            {YamlConfigConstants.LABEL_TEMPLATE: "${state_name} (${state_code})"},
        ]
    ),

]

SectionDescriptions = {
    YamlConfigConstants.TARGET_DB_TABLE_NAME: "Configuration items under the common or target table nodes",
    YamlConfigConstants.TRANSFORMATIONS: "These transformations occur in python, using the GeoPandas DataFrame",
    YamlConfigConstants.DB_TRANSFORMATIONS: "These transformations occur in the database, using PostGIS",
    YamlConfigConstants.USER_VERIFICATIONS: "Validations / QA / QC checks to perform in the staging table in the database"
}


def create_param_doc(param: ParamDocItem):
    return f"{param.name} -- {param.desc}"


def create_param_header(doc_item: DocItem):
    return f"{doc_item.name} - {doc_item.desc}"


def main():
    # print(f"Plugins {discovered_plugins}")
    global DocItemList

    # Go through the db transforms and add their documentation
    db_transform_plugins = get_plugins(importer.plugins.db_transforms)
    for t_name in db_transform_plugins:
        m = db_transform_plugins[t_name]
        print(f"Found db transform {m.__name__}")
        if not hasattr(m, 'doc'):
            print(f"{m.__name__} has no doc function defined")
            continue
        else:
            util_doc_item = m.doc()
            util_doc_item.section = YamlConfigConstants.DB_TRANSFORMATIONS
            DocItemList.append(util_doc_item)

    # Do the same for the in memory transformations
    transform_plugins = get_plugins(importer.plugins.transforms)
    for t_name in transform_plugins:
        m = transform_plugins[t_name]
        print(f"Found memory transform {m.__name__}")
        if not hasattr(m, 'doc'):
            print(f"{m.__name__} has no doc function defined")
            continue
        else:
            util_doc_item = m.doc()
            util_doc_item.section = YamlConfigConstants.TRANSFORMATIONS
            DocItemList.append(util_doc_item)

    # And the verification plugins
    verification_plugins = get_plugins(importer.plugins.verifications)
    for v_name in verification_plugins:
        m = verification_plugins[v_name]
        print(f"Found verification {m.__name__}")
        if not hasattr(m, 'doc'):
            print(f"{m.__name__} has no doc function defined")
            continue
        else:
            util_doc_item = m.doc()
            util_doc_item.section = YamlConfigConstants.USER_VERIFICATIONS
            DocItemList.append(util_doc_item)

    # populate transform doc
    for trans_param in TransformationParams_Documentation:

        for trans in DocItemList:

            if trans_param.name in trans.params:
                trans.param_docs.append(trans_param)
                continue

    # https://stackoverflow.com/questions/16782112/can-pyyaml-dump-dict-items-in-non-alphabetical-order
    yaml.add_representer(OrderedDict, represent_ordereddict)

    file_utils.mkdir_p(DirectoryLocations.DOC_BASE_DIR)

    doc_path = DirectoryLocations.DOC_BASE_DIR / "ref.md"

    file_ref = open(doc_path, "w")

    file_ref.write("Table of Contents\n")

    for section in SectionDescriptions:

        file_ref.write(f"""# {section}\n\n""")

        for doc_item in DocItemList:
            if doc_item.section != section:
                continue

            file_ref.write(f"1. [{doc_item.name}](#{sanitize_id(create_param_header(doc_item))})\n")

    for section in SectionDescriptions:

        file_ref.write(f"""# {section}\n\n""")

        file_ref.write(SectionDescriptions[section] + "\n\n")

        for doc_item in DocItemList:

            if doc_item.section != section:
                continue

            file_ref.write(f"""## {create_param_header(doc_item)}\n""")

            if doc_item.extended_desc:
                file_ref.write("\n" + doc_item.extended_desc + "\n\n")

            transform_param_doc = ""

            if len(doc_item.param_docs) > 0:
                transform_param_doc += "\nParameters\n"

            if len(doc_item.explicit_yaml_examples) > 0:
                yaml_sample = {
                    section: doc_item.explicit_yaml_examples
                }

            for tp in doc_item.param_docs:
                transform_param_doc += f"* {create_param_doc(tp)}\n"

            indent_char_amount = 0
            transform_yaml_sample = yaml.dump(yaml_sample, default_flow_style=False)

            file_ref.write(textwrap.indent(transform_param_doc, " " * indent_char_amount))

            if len(doc_item.param_docs) > 0:
                file_ref.write("\n")

            file_ref.write(textwrap.indent(f"""Sample Yaml\n    
```YAML
{transform_yaml_sample}
```\n\n""", " " * indent_char_amount))

    file_ref.close()

    # training_steps = doc_path.parent / "training_steps.md"
    #
    # convert_markdown_to_html_and_pdf(
    #     training_steps, doc_path.parent,
    #     title="Training Report")

    convert_markdown_to_html_and_pdf(
        doc_path, doc_path.parent,
        title="Doc Report")


if __name__ == "__main__":
    main()

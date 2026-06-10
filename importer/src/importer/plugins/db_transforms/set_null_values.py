import logging
from collections import OrderedDict

from psycopg2.sql import Identifier, SQL, Literal

from importer.constants import YamlConfigConstants, TransformationParams, \
    DbConstants, DbTransformations, AddColumnValueGenerators
from importer.util import ConfigException, DocItem, DbTransformArguments
from lib import db_utils

log = logging.getLogger(__name__)
trace_log = logging.getLogger("trace." + __name__)


def doc():
    d = DocItem(
        name=DbTransformations.SET_NULL_VALUES,
        desc="Replaces null values with a set value or a 'generator' such as new uuid/guids",
        explicit_yaml_examples=[
            OrderedDict({
                TransformationParams.COMMENTS: "Generate a new global_id for any imported row that has a NULL value",
                TransformationParams.COLUMN_NAME: "global_id",
                TransformationParams.COLUMN_VALUE_GENERATOR: AddColumnValueGenerators.NEW_GUID,
            }),
            OrderedDict({
                TransformationParams.COMMENTS: "Sets any NULL value in state_code to 'BR'",
                TransformationParams.COLUMN_NAME: "state_code",
                TransformationParams.COLUMN_VALUE: "BR",
            }),
        ],
        section=YamlConfigConstants.DB_TRANSFORMATIONS,
    )

    d.infer_params_from_examples()
    d.set_name_on_examples()

    return d


def do_transform(t_args: DbTransformArguments) -> str:
    conn = t_args.conn
    postgis_table_name = t_args.postgis_table_name
    transform_config = t_args.transform_config

    column_name = transform_config.get(TransformationParams.COLUMN_NAME, None)

    value = transform_config.get(TransformationParams.COLUMN_VALUE, None)

    value_gen = transform_config.get(TransformationParams.COLUMN_VALUE_GENERATOR, None)

    markdown_output = ""

    if value is not None:

        sql = SQL("UPDATE {}.{} SET {c} = {v} WHERE {c} is NULL").format(
            Identifier(t_args.staging_schema),
            Identifier(postgis_table_name),
            v=SQL(str(value)),
            c=Identifier(column_name)
        )

        markdown_output += f"Set column {column_name} to {value} in {t_args.staging_schema}.{postgis_table_name}\n\n"
    elif value_gen == AddColumnValueGenerators.NEW_GUID:
        #A normal user would not have the permissions to run this
        #db_utils.run_sql(conn, "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\"")

        sql = SQL("UPDATE {}.{} SET {c} = uuid_generate_v4() WHERE {c} is NULL").format(
            Identifier(t_args.staging_schema),
            Identifier(postgis_table_name),
            c=Identifier(column_name)
        )
        markdown_output += f"Set column {column_name} to a new GUID in {t_args.staging_schema}.{postgis_table_name}\n\n"
    else:
        raise ConfigException(f"Unknown {TransformationParams.COLUMN_VALUE_GENERATOR} value {value_gen}")

    num_rows_updated = db_utils.run_sql(conn, sql)

    markdown_output += f"Rows updated: {num_rows_updated}\n\n"

    return markdown_output

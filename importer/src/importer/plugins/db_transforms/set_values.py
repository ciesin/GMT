import logging
from collections import OrderedDict

from psycopg2.sql import Identifier, SQL, Literal

from importer.constants import YamlConfigConstants, TransformationParams, \
    DbConstants, DbTransformations, AddColumnValueGenerators, Transformations
from importer.util import ConfigException, DocItem, DbTransformArguments
from lib import db_utils

log = logging.getLogger(__name__)
trace_log = logging.getLogger("trace." + __name__)


def doc():
    d = DocItem(
        name=Transformations.SET_VALUES,
        desc="Sets values in the database",
        explicit_yaml_examples=[
            OrderedDict(
                {
                    "comment": "Sets all values to 'Nasdra Training'",
                    TransformationParams.COLUMN_NAME: "source",
                    TransformationParams.COLUMN_VALUE: 'Nasdra Training'
                }),
            OrderedDict(
                {
                    "comment": "Sets all values to a new guid",
                    TransformationParams.COLUMN_NAME: "global_id",
                    TransformationParams.COLUMN_VALUE_GENERATOR: AddColumnValueGenerators.NEW_GUID
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

    markdown_output = ""

    column_name = transform_config.get(TransformationParams.COLUMN_NAME, None)

    value = transform_config.get(TransformationParams.COLUMN_VALUE, None)

    value_gen = transform_config.get(TransformationParams.COLUMN_VALUE_GENERATOR, None)

    if value_gen is None:
        if value is not None:

            sql = SQL("UPDATE {}.{} SET {c} = {}").format(
                Identifier(t_args.staging_schema),
                Identifier(postgis_table_name),
                Literal(value),
                c=Identifier(column_name)
            )

            markdown_output += f"Set column {column_name} to {value}"
        else:
            sql = SQL("UPDATE {}.{} SET {c} = NULL").format(
                Identifier(t_args.staging_schema),
                Identifier(postgis_table_name),
                c=Identifier(column_name)
            )

            markdown_output += f"Set column {column_name} to no value (NULL)"
    elif value_gen == AddColumnValueGenerators.NEW_GUID:
        db_utils.run_sql(conn, "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\"")

        sql = SQL("UPDATE {}.{} SET {c} = uuid_generate_v4()").format(
            Identifier(t_args.staging_schema),
            Identifier(postgis_table_name),
            Literal(value),
            c=Identifier(column_name)
        )

        markdown_output += f"Set column {column_name} to a newly generated guid"

    else:
        raise ConfigException(f"Unknown {TransformationParams.COLUMN_VALUE_GENERATOR} value {value_gen}")

    num_records = db_utils.run_sql(conn, sql)

    markdown_output += f"\n\n{num_records} rows updated"

    return markdown_output
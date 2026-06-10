import logging
from collections import OrderedDict

from psycopg2.sql import Identifier, Literal, SQL

from importer.constants import YamlConfigConstants, DbTransformations, TransformationParams
from importer.util import DocItem, DbTransformArguments
from lib import db_utils

log = logging.getLogger(__name__)
trace_log = logging.getLogger("trace." + __name__)


def doc():
    d = DocItem(
        name=DbTransformations.STRING_REPLACE,
        desc="This transformation can do a string replace",
        explicit_yaml_examples=[
            OrderedDict({

            }),

        ],
        section=YamlConfigConstants.DB_TRANSFORMATIONS,
    )

    d.infer_params_from_examples()
    d.set_name_on_examples()

    return d


def do_transform(t_args: DbTransformArguments) -> str:

    # This is the database connection object
    conn = t_args.conn
    postgis_table_name = t_args.postgis_table_name
    transform_config = t_args.transform_config

    replacements = transform_config.get("replacements", {})

    markdown_output = ""

    # replace(name, 'world', 'earth')

    column_name = transform_config.get(TransformationParams.COLUMN_NAME, None)

    for from_str in replacements:
        to_str = replacements[from_str]

        sql = SQL("UPDATE {}.{} SET {cn} = replace({cn}, {str_from}, {str_to}) ").format(
            Identifier(t_args.staging_schema),
            Identifier(postgis_table_name),
            str_from=Literal(from_str),
            str_to=Literal(to_str),
            cn = Identifier(column_name)
        )

        num_rows_updated = db_utils.run_sql(conn, sql)

        markdown_output += f"* Changing '{from_str}' to '{to_str}' in the \"__{column_name}__\" column, # of rows updated: {num_rows_updated}\n\n"

    return markdown_output



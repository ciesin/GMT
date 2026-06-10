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
        name=DbTransformations.WARD_TO_STATE_CODE,
        desc="A transform specific to Nigeria, will do an attribute join to"
             " find which state_code corresponds to the ward_code in a given table",
        explicit_yaml_examples=[
            OrderedDict(
                {

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

    log.debug("Setting state code via ward_code")

    sql = SQL("""
        UPDATE {}.{} AS layer
        SET state_code = lga.state_code
        FROM {master}.boundary_wards_latest ward
        INNER JOIN {master}.boundary_lgas_latest lga
            ON lga.lga_code = ward.lga_code
        WHERE layer.ward_code = ward.ward_code
            AND layer.state_code IS NULL      
        """).format(
        Identifier(t_args.staging_schema),
        Identifier(postgis_table_name),
        master=Identifier(DbConstants.SCHEMA_MASTER),
    )

    num_recs = db_utils.run_sql(conn, sql)

    return f"{postgis_table_name} -- {num_recs} state codes updated via ward codes"
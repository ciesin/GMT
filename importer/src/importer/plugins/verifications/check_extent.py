import logging
from collections import OrderedDict

from psycopg2.sql import SQL, Identifier, Literal

from importer.constants import YamlConfigConstants, Verifications, \
    VerificationParams
from importer.util import DocItem, \
    VerificationVars
from importer.verifications import output_failed_rows
from lib import db_utils

log = logging.getLogger(__name__)
trace_log = logging.getLogger("trace." + __name__)


def doc():
    d = DocItem(
        name=Verifications.CHECK_EXTENT,
        desc = "Checks geometry with respect to an extent",
        extended_desc= "Checks the geometry is either null or within a given extent.  "
        "Default extent used are the limits of 4326, so X/Longitude from -180 to 180 and Y/Latitude from -90 to 90",
        explicit_yaml_examples=[
            OrderedDict(
                {
                    VerificationParams.EXTENT:
                        {
                            YamlConfigConstants.XMIN: -180,
                            YamlConfigConstants.XMAX: 180,
                            YamlConfigConstants.YMIN: -90,
                            YamlConfigConstants.YMAX: 90
                        }
                 }),

        ],
        section=YamlConfigConstants.TRANSFORMATIONS,
    )

    d.infer_params_from_examples()
    d.set_name_on_examples()

    return d


def do_verification(v_args: VerificationVars) -> bool:

    test_config = v_args.test_config

    index_column_name = v_args.layer_config.get(YamlConfigConstants.INDEX_COLUMN,
                                                    YamlConfigConstants.INDEX_COLUMN_DEFAULT)

    extent = test_config.get(VerificationParams.EXTENT, {

    })

    x_min = extent.get(YamlConfigConstants.XMIN, -180)
    x_max = extent.get(YamlConfigConstants.XMAX, 180)
    y_min = extent.get(YamlConfigConstants.YMIN, -90)
    y_max = extent.get(YamlConfigConstants.YMAX, 90)

    sql = SQL("""
            SELECT {}, 'Extent: X -- ' || ST_XMin({geom_col}) 
                || ' ' || ST_XMax({geom_col})   
                || ' Y -- ' || ST_YMin({geom_col}) 
                || ' ' || ST_YMax({geom_col})
            FROM {}.{} WHERE 
                ST_XMin({geom_col}) <= {x_min} 
                OR ST_XMax({geom_col}) >= {x_max}   
                OR ST_YMin({geom_col}) <= {y_min}
                OR ST_YMax({geom_col}) >= {y_max}
            """).format(
        Identifier(index_column_name),
        Identifier(v_args.staging_schema),
        Identifier(v_args.table_name),
        geom_col=Identifier(v_args.source_geom_info['column_name']),
        x_min=Literal(x_min),
        x_max=Literal(x_max),
        y_min=Literal(y_min),
        y_max=Literal(y_max),
    )

    invalid_rows = db_utils.get_results(v_args.conn, sql)
    len_invalid_rows = len(invalid_rows)

    v_args.output += f"## Extent check for {v_args.staging_schema}.{v_args.table_name}\n"

    if len_invalid_rows > 0:
        v_args.output += f"Found {len_invalid_rows} rows outside of the extent X/Latitude {x_min} : {x_max} AND Y/Longitude {y_min} : {y_max}\n"

        output_failed_rows(v_args, invalid_rows)

        return False

    v_args.output += f"All rows are within the defined extent of X/Latitude {x_min} to {x_max} and Y/Longitude {y_min} to {y_max}\n"

    return True
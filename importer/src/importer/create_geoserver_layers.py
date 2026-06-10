import argparse
import logging
import warnings

import requests
import yaml
from psycopg2.sql import SQL, Literal
from requests.auth import HTTPBasicAuth

from importer.constants import DbConstants
from importer.import_config import UtilConfig
from importer.util import init_logging, parse_path
from lib import db_utils

# Ignore CSR warnings as pyproj is more recent than geopandas

warnings.simplefilter(action='ignore', category=FutureWarning)

log = logging.getLogger(__name__)
trace_log = logging.getLogger("trace." + __name__)

GEOSERVER_USERNAME = "admin"
GEOSERVER_PASSWORD = "XVjaCQKbaLBuJX1DaMwHPbVW8K2viP1m"
STORE_NAME = "Grid_Updated_Data_Schema"
GEOSERVER_URL = "http://docker.for.win.localhost:8084/geoserver"
WORKSPACE_NAME = "GRIDMaster"


def main():
    """
    Main entry point for the application.  Parses command line arguments and executes them.
    """
    parser = argparse.ArgumentParser(description='Publish latest version to publication database')

    parser.add_argument('-c', '--config', action='store',
                        dest="config_path",
                        type=parse_path,
                        required=True,
                        help='A file path to the Yaml configuration.  ')

    parser.add_argument('-v', '--verbose', action='store_true',
                        help='Set to add more verbose logging')

    args = parser.parse_args()

    init_logging(args.verbose)

    with open(args.config_path) as file:
        yaml_config = yaml.load(file, Loader=yaml.FullLoader)

    process_publish(yaml_config)


def process_publish(publish_config):
    master_db_config = publish_config['master-database']

    # Create a config class containing the database connection info
    master_util_cfg = UtilConfig(master_db_config)



    views_sql = f"""
select table_name from information_schema.tables
where table_type = 'VIEW'
and table_schema = 'master'
order by table_name;
"""
    with db_utils.create_db_connection(master_util_cfg) as conn:

        recs = db_utils.get_results(conn, views_sql)

        for master_view_name in recs:
            master_view_name = master_view_name[0]

            target_table_name = master_view_name.replace(DbConstants.LATEST_VIEW_SUFFIX, "")

            create_feature_type(
                geoserver_layer_name=f"u_{target_table_name}",
                title = f"Layer of {target_table_name}",
                database_view_name=target_table_name
            )

            sql = SQL("""
select type, srid from public.geometry_columns
where f_table_name = {} and f_table_schema = {}
""").format(Literal(target_table_name), Literal(DbConstants.SCHEMA_MASTER))

            geometry_type, geometry_srid = db_utils.get_results(conn, sql)[0]



        log.info(f"Complete, setting version to published")





def get_feature_type(view_name):
    url = f"{GEOSERVER_URL}/rest/workspaces/{WORKSPACE_NAME}/datastores/{STORE_NAME}/featuretypes/{view_name}.json"

    r = requests.get(url, auth=HTTPBasicAuth(GEOSERVER_USERNAME, GEOSERVER_PASSWORD))

    if r.status_code == 404:
        return None

    layer_json = r.json()

    return layer_json

def create_feature_type(geoserver_layer_name, title, database_view_name=None, bbox_native=None, bbox_4326=None):
    """
    Creates a feature type using the BUAs as a template

    :param geoserver_layer_name: the name of the feature type/postgis database view
    :param title: the label (will show up in the map layer selection)
    :return:
    """
    layer_json = get_feature_type("boundary_wards")

    if database_view_name is None:
        database_view_name = geoserver_layer_name

    url = f"{GEOSERVER_URL}/rest/workspaces/{WORKSPACE_NAME}/datastores/{STORE_NAME}/featuretypes"

    feature_type_json = layer_json['featureType']
    feature_type_json["name"] = geoserver_layer_name
    feature_type_json["title"] = title
    feature_type_json["nativeName"] = database_view_name

    if bbox_native:
        feature_type_json["nativeBoundingBox"] = dict(
            minx=bbox_native[0],
            miny=bbox_native[1],
            maxx=bbox_native[2],
            maxy=bbox_native[3]
        )
    if bbox_4326:
        feature_type_json["latLonBoundingBox"] = dict(
            minx=bbox_4326[0],
            miny=bbox_4326[1],
            maxx=bbox_4326[2],
            maxy=bbox_4326[3]
        )

    # Remove some fields we want recomputed
    feature_type_json.pop("attributes", None)
    feature_type_json.pop("keywords", None)

    # return
    headers = {
        "accept": "application/json",
        "content-type": "application/json",
    }
    r = requests.post(url,
                      json=layer_json,
                      headers=headers,
                      auth=HTTPBasicAuth(GEOSERVER_USERNAME, GEOSERVER_PASSWORD),

                      )

    print(f"Response is {r.status_code}")
    if r.status_code != 201:
        raise Exception("Problem")

if __name__ == "__main__":
    main()

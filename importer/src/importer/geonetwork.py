import argparse
import copy
import json
import logging
import os
import sys
from typing import Dict, List, Tuple
from urllib.parse import urlparse, parse_qs, urljoin, urlencode, urlunparse, parse_qsl

import psycopg2
import requests

import yaml
from importer.geonetwork_lib.geonetwork_api import fetch_tags

from importer.geonetwork_lib.config import Config
from importer.geonetwork_lib.geonetwork_dto import GeonetworkLayer
from importer.geonetwork_lib.xml import XML_REPLACEMENT_CONSTANTS, xml_escape, get_triple_from_xml_text, ParsedXML, \
    get_string_to_replace, find_single_element, find_all_elements
from lib import db_utils

from importer.constants import YamlConfigConstants, DbConstants, DirectoryLocations
from importer.util import init_logging, parse_path, merge_dictionaries, confirm
from lib.db_utils import UtilConfig

log = logging.getLogger(__name__)
trace_log = logging.getLogger("trace." + __name__)
"""
High level concepts --

Each configured geonetwork layer in the YAML datasets list will become 38 layers in the database, 1 per state/country

During the verification, the geonetwork list is read from the db, a grouping is done to find which state/country it belongs to
via the title.

The pattern is [State name / country name] followed by [ the configured title ] 

There is currently just 1 country -- Nigeria.  


Misc notes --

URL that the harvester uses, which contains CSW metadata and what looks to be geonetwork metadata
http://geonetwork:9002/geonetwork/srv/en/mef.export?uuid=9318f6d5-20f4-4816-b5d3-d7716e546b03

# swagger -- http://localhost:9002/geonetwork/srv/v2/api-docs

# https://editor.swagger.io/

http://localhost:9002/geonetwork/srv/api/0.1/records/a187b71a-c9d2-4bce-a408-a4f5fa2b324c/formatters/xml

CSW url 

http://localhost:9002/geonetwork/srv/eng/csw?service=CSW&version=2.0.2&request=GetRecords

python3.8 /python_src/importer/geonetwork.py --title "Eric's new table" --table brand_new_table --category Education

"""



def main():
    """
    Main entry point for the application.  Parses command line arguments and executes them.
    """

    args = init_argument_parser()

    init_logging(args.verbose, log_base_dir=DirectoryLocations.DATA_DIR)

    yaml_config = parse_yaml_config(args)

    init_config(yaml_config)

    # NOTE -- 1 layer will end up creating X actual layers in geonetwork, 1 per state/country.
    geonetwork_layers = get_geonetwork_layers(yaml_config)

    log.info(f"Config contains {len(geonetwork_layers)} datasets")

    Config.COUNTRY_STATES = yaml_config["states"]

    Config.GEONETWORK_LAYERS = geonetwork_layers
    Config.YAML_CONFIG = yaml_config
    Config.FORCE = args.force


    #fc = get_feature_count(yaml_config, "GRIDMaster:u_boundary_lgas")
    #print(f"Feature count: {fc}")
    #


    if Config.FORCE:
        log.info(
            "Will confirm automatically removals of invalid geonetwork layers or layers not matching the desired configuration in the YAML datasets list")
    else:
        log.info("Manual confirmation")

    check_geonetwork_layers()


def init_argument_parser():
    """
    Initializes command line argument parser object and
    returns the parsed arguments
    """
    parser = argparse.ArgumentParser(description='Ensures geonetwork configuration matches the desired config in the YAML files')

    parser.add_argument('--username', help="Specifies the postgres username to use to connect to the master GDB")

    parser.add_argument('--password', help="Specifies the postgres password to use to connect to the master gdb")

    parser.add_argument('--force', action='store_true', help="Set to automatically confirm delete actions")

    parser.add_argument('-c', '--config', action='append',
                        dest="config_paths",
                        type=parse_path,
                        required=True,
                        help='A file path to the Yaml configuration.  Recommended to use 1 file for the master GDB connection info, one for the geonetwork/geoserver connection info, one for the list of geonetwork layers, and one when trying a new table ')

    parser.add_argument('-v', '--verbose', action='store_true',
                        help='Set to add more verbose logging')

    args = parser.parse_args()

    return args


def parse_yaml_config(args) -> Dict:
    """
    Merges the --config yaml files.  Datasets are appended,
    the others are merged with last one (right most) taking priority
    :return: parsed config
    """
    # deserialized configuration
    yaml_config = {
        "datasets": []
    }

    # load one by one, last one wins
    for config_file_path in args.config_paths:
        # noinspection PyTypeChecker
        with open(config_file_path) as file:
            yc = yaml.load(file, Loader=yaml.FullLoader)

            # this one we want to be additive
            #yc_datasets = yaml_config["datasets"]
            #yc_datasets.extend(yc.get("datasets", []))

            yaml_config = merge_dictionaries(yaml_config, yc)

            #yaml_config["datasets"] = yc_datasets

    return yaml_config


def init_config(yaml_config):

    geonetwork_config = yaml_config["geonetwork"]

    # config takes priority over env variable
    Config.GEONETWORK_BASE_URL = geonetwork_config.get("url", os.environ.get("GEONETWORK_BASE_URL", None))

    assert Config.GEONETWORK_BASE_URL, "Must either provide in YAML geonetwork -> url or the environment variable GEONETWORK_BASE_URL"

    Config.GEONETWORK_API_BASE_URL = Config.GEONETWORK_BASE_URL + "/srv/api/0.1"

    Config.CSW_PUBLICATION_URL = Config.GEONETWORK_BASE_URL + "/srv/eng/csw-publication"

    Config.CSW_ADMIN_USERNAME = geonetwork_config.get("username", os.environ.get("GEONETWORK_ADMIN_USERNAME"))
    assert Config.CSW_ADMIN_USERNAME, "Must either provide in YAML geonetwork -> username or the environment variable GEONETWORK_ADMIN_USERNAME"

    Config.CSW_ADMIN_PASSWORD = geonetwork_config.get("password", os.environ.get("GEONETWORK_ADMIN_PASSWORD"))
    assert Config.CSW_ADMIN_PASSWORD, "Must either provide in YAML geonetwork -> password or the environment variable GEONETWORK_ADMIN_PASSWORD"

    geoserver_config = yaml_config["geoserver"]

    Config.GEOSERVER_BASE_URL = geoserver_config.get("url", os.environ.get("GEOSERVER_BASE_URL", "http://geoserver:9004/geoserver"))


def get_geonetwork_layers(yaml_config: Dict) -> List[GeonetworkLayer]:
    """
    List of layers from the Yaml.  Note that once created each one will become 38 entries in the
    geonetwork database, 1 per state/country

    :param yaml_config:
    :return:
    """
    geonetwork_layer_list = []

    for dataset in yaml_config["datasets"]:

        layer = GeonetworkLayer(
            title=dataset.get("title"),
            category=dataset.get("category"),
            description=dataset.get("description"),
            geoserver_typename=dataset.get("geoserver_typename"),
            cql_filter=dataset.get("cql_filter"),
            keywords=dataset.get("keywords", []),
            purpose=dataset.get("purpose", "To promote better delivery of services to people in the state"),
            abstract=dataset.get("abstract", None)
        )

        if not layer.keywords:
            layer.keywords.append(layer.title)
            layer.keywords.append(layer.category)

        if not layer.abstract:
            layer.abstract = layer.description

        geonetwork_layer_list.append(layer)

    return geonetwork_layer_list


def add_layer_to_all_states(g_layer: GeonetworkLayer):
    """
    Adds a table to geonetwork to all states/countries
    """
    tag_to_id_map = fetch_tags()

    log.debug(f"Fetched tag ids: {tag_to_id_map}")

    # We make sure the category passed by command line is a tag on the server
    # Tags in geonetwork seem to be a superset of the categories
    if g_layer.category not in tag_to_id_map:
        names = ", ".join([f"\"{k}\"" for k in tag_to_id_map])
        raise Exception(f"Category \"{g_layer.category}\" not found.  Must be one of {names}")

    with open("/data/config_files/geonetwork/geonetwork_layer.xml", "r") as f:
        xml_template = f.read()

    lineage = "Management of settlements in Nigeria are done at the three tiers of Government; Federal, State and Local Government"

    for state_cfg in Config.COUNTRY_STATES:
        state_code = state_cfg["code"]
        state_name = state_cfg["name"]
        title_with_state = f"{state_name} {g_layer.title}"
        g_layer.extent = [ state_cfg["extent"]["min_x"], state_cfg["extent"]["max_x"],
                           state_cfg["extent"]["min_y"], state_cfg["extent"]["max_y"] ]

        log.info(f"Adding Geonetwork layer \"{title_with_state}\"")

        g_layer.state_code = state_code

        feature_count = get_feature_count(g_layer.get_expected_wfs_url())

        if feature_count == 0:
            log.info(f"For state {state_code}, layer {g_layer.title} has 0 features, skipping")
            continue

        gmd_metadata = xml_template

        gmd_metadata = gmd_metadata.replace(get_string_to_replace(XML_REPLACEMENT_CONSTANTS.TITLE), xml_escape(g_layer.title))
        gmd_metadata = gmd_metadata.replace(get_string_to_replace(XML_REPLACEMENT_CONSTANTS.TITLE_WITH_STATE), xml_escape(title_with_state))
        gmd_metadata = gmd_metadata.replace(get_string_to_replace(XML_REPLACEMENT_CONSTANTS.ABSTRACT), xml_escape(g_layer.abstract))
        gmd_metadata = gmd_metadata.replace(get_string_to_replace(XML_REPLACEMENT_CONSTANTS.CATEGORY), xml_escape(g_layer.category))
        gmd_metadata = gmd_metadata.replace(get_string_to_replace(XML_REPLACEMENT_CONSTANTS.DESCRIPTION), xml_escape(g_layer.description))

        gmd_metadata = gmd_metadata.replace(get_string_to_replace(XML_REPLACEMENT_CONSTANTS.LAYER_EXTENT_WEST), str(g_layer.extent[0]))
        gmd_metadata = gmd_metadata.replace(get_string_to_replace(XML_REPLACEMENT_CONSTANTS.LAYER_EXTENT_EAST), str(g_layer.extent[1]))
        gmd_metadata = gmd_metadata.replace(get_string_to_replace(XML_REPLACEMENT_CONSTANTS.LAYER_EXTENT_SOUTH), str(g_layer.extent[2]))
        gmd_metadata = gmd_metadata.replace(get_string_to_replace(XML_REPLACEMENT_CONSTANTS.LAYER_EXTENT_NORTH), str(g_layer.extent[3]))

        keyword_xml  = ""

        for kw in g_layer.keywords:
            keyword_xml += f"<gmd:keyword><gco:CharacterString>{xml_escape(kw)}</gco:CharacterString></gmd:keyword>"

        gmd_metadata = gmd_metadata.replace(get_string_to_replace(XML_REPLACEMENT_CONSTANTS.KEYWORDS),
                                            keyword_xml)

        gmd_metadata = gmd_metadata.replace(get_string_to_replace(XML_REPLACEMENT_CONSTANTS.PURPOSE), xml_escape(g_layer.purpose))

        gmd_metadata = gmd_metadata.replace(get_string_to_replace(XML_REPLACEMENT_CONSTANTS.LINEAGE), lineage)

        gmd_metadata = gmd_metadata.replace(get_string_to_replace(XML_REPLACEMENT_CONSTANTS.URL),
            xml_escape(g_layer.get_expected_wfs_url()))

        # make sure all replacements are finished
        assert "{{" not in gmd_metadata, gmd_metadata
        assert "}}" not in gmd_metadata

        insert_data = f"""
<csw:Transaction service="CSW" 
   version="2.0.2" 
   xmlns:csw="http://www.opengis.net/cat/csw" >
  <csw:Insert>
{gmd_metadata}
</csw:Insert>
</csw:Transaction>
"""

        service = "CSW"
        get_params = {'service': service, 'request': 'Transaction',
                      }

        r = requests.post(url=Config.CSW_PUBLICATION_URL,
                          params=get_params,
                          data=insert_data.encode('utf-8'),
                          headers={"Content-Type": "application/xml",
                                   },
                          auth=(Config.CSW_ADMIN_USERNAME, Config.CSW_ADMIN_PASSWORD))

        assert r.status_code == 200, f"Wrong status code: {r.status_code}.  Text: {r.text}"

        parsed_xml = get_triple_from_xml_text(r.text)

        #log.info(parsed_xml.xml_text)

        # there should only be 1
        ids = [e.text for e in parsed_xml.tree.findall('.//identifier', parsed_xml.ns_map)]

        #log.info(ids)

        assert len(ids) == 1

        resource_uuid = ids[0]

        # http://localhost:9002/geonetwork/srv/api/0.1/records/a187b71a-c9d2-4bce-a408-a4f5fa2b324c/formatters/xml

        s = requests.Session()
        r = s.put(url=Config.GEONETWORK_API_BASE_URL + f"/records/{resource_uuid}/sharing",
                  json=Config.JSON_PERM_PAYLOAD,
                  auth=(Config.CSW_ADMIN_USERNAME, Config.CSW_ADMIN_PASSWORD))

        xsrf_token = r.cookies["XSRF-TOKEN"]

        r = s.put(url=Config.GEONETWORK_API_BASE_URL + f"/records/{resource_uuid}/sharing",
                  json=Config.JSON_PERM_PAYLOAD,
                  headers={
                      "X-XSRF-TOKEN": xsrf_token
                  },
                  auth=(Config.CSW_ADMIN_USERNAME, Config.CSW_ADMIN_PASSWORD))

        assert 204 == r.status_code

        r = s.put(url=Config.GEONETWORK_API_BASE_URL + "/records/tags",
                  params={
                      "uuids": [resource_uuid],
                      "id": tag_to_id_map[g_layer.category],
                      "clear": False
                  },
                  headers={
                      "X-XSRF-TOKEN": xsrf_token,
                      "Accept": "application/json"
                  },

                  )

        assert r.status_code == 201
        #log.info(f"{r.status_code} and {r.text}")


def delete_by_title(title):
    """
    Removes all geonetwork layers containing title
    """
    log.info(f"Removing existing geonetwork layers for title \"{title}\"")

    delete_xml = f"""
<?xml version="1.0" encoding="UTF-8"?>
<csw:Transaction xmlns:csw="http://www.opengis.net/cat/csw/2.0.2" xmlns:ogc="http://www.opengis.net/ogc" version="2.0.2" service="CSW">
  <csw:Delete>
    <csw:Constraint version="1.1.0">
      <ogc:Filter>
        <ogc:PropertyIsLike wildCard="%" singleChar="." escapeChar="\\">
          <ogc:PropertyName>title</ogc:PropertyName>
          <ogc:Literal>% {xml_escape(title)}</ogc:Literal>
        </ogc:PropertyIsLike>
      </ogc:Filter>
    </csw:Constraint>
  </csw:Delete>
</csw:Transaction>
    """.strip()

    service = "CSW"
    get_params = {'service': service, 'request': 'Transaction',
                  }

    s = requests.Session()
    r = s.post(url=Config.CSW_PUBLICATION_URL,
               params=get_params,
               data=delete_xml,
               headers={"Content-Type": "application/xml",
                        },
               auth=(Config.CSW_ADMIN_USERNAME, Config.CSW_ADMIN_PASSWORD))

    log.info(f"Response from [{Config.CSW_PUBLICATION_URL}]\n{r.text}")

    if r.status_code == 401:
        log.info(f"Geonetwork authorization failed.  Used username={Config.CSW_ADMIN_USERNAME} password length={len(Config.CSW_ADMIN_PASSWORD)} url={Config.CSW_PUBLICATION_URL}")
        sys.exit(0)


def check_geonetwork_layers():
    """
    Make sure to have imported the admin layers locally

    python3.8 /python_src/importer/main.py --config /data/config_files/geopode/fgdb.yml --config /data/config_files/docker_local_db.yml  --table boundary_states --table boundary_lgas --table boundary_wards  --import  --verbose
    """
    log.info("Starting verification of geonetwork layers...")

    # maps state/country code to a list of the db geonetwork layers

    iso_to_geonetwork_layers = {
        c["code"]: [] for c in Config.COUNTRY_STATES
    }

    for g in Config.GEONETWORK_LAYERS:
        assert g.category is not None, f"{g.title} has no category"

        if not g.abstract:
            g.abstract = g.description

    db_geonetwork_layers = fetch_geonetwork_layers_from_db()

    # Organize existing layers from the database by state ; entries which cannot be grouped will exit script
    group_db_geonetwork_layers_by_state(db_geonetwork_layers, iso_to_geonetwork_layers)

    log.info(f"Checking state configs {len(iso_to_geonetwork_layers)}")
    # Now check grouped config, looking for anything that doesn't match what is expected
    check_iso_to_geonetwork_layers(iso_to_geonetwork_layers)


def group_db_geonetwork_layers_by_state(
    db_geonetwork_layers: List[GeonetworkLayer],
    iso_to_geonetwork_layers:  Dict[str, List[GeonetworkLayer]]
):
    """
    Will organize layers by state code.  Also normalizes the title to not include the state/country name
    so that it should match the Yaml

    Will also fail if a title is not recognized to be a country / state

    Populates iso_to_geonetwork_layers

    failure will exit python
    """
    check_failed = False

    state_name_to_iso = {
        c["name"]: c["code"] for c in Config.COUNTRY_STATES
    }

    for glayer in db_geonetwork_layers:

        found_country = False

        for country_name in state_name_to_iso:
            iso_code = state_name_to_iso[country_name]
            if not glayer.title.startswith(country_name):
                continue

            # we want to know the title without the leading state/country name, this allows us to look up the title with the expected configuration
            stripped_title = glayer.title[len(country_name) + 1:]

            glayer.title = stripped_title
            glayer.state_code = iso_code
            glayer.country_name = country_name

            iso_to_geonetwork_layers[iso_code].append(glayer)

            found_country = True
            break

        if not found_country:
            log.warning(f"ERROR! could not find state/country for title {glayer.title}")
            check_failed = True
            if Config.FORCE or confirm("Are you sure you do not want to remove all entries with this title that has no state/country in the title?"):
                delete_by_title(glayer.title)

    if check_failed:
        log.info("Invalid existing entry or entries, terminating.  "
                 "Rerun with script with same parameters after allowing this script to remove the entries in error")
        sys.exit(1)
    else:
        log.info(f"All existing geonetwork layers belong to a country/state (by their title).  "
                 f"Note this does not mean necessarily they are valid!")


def fetch_geonetwork_layers_from_db() -> List[GeonetworkLayer]:
    """
    Fetches the geonetwork layers from the database

    Note this will return an object per entry, it will not condence
    all related layers into 1 object like elsewhere in the code
    """

    yaml_config = Config.YAML_CONFIG
    db_config = yaml_config["geonetwork"][YamlConfigConstants.DATABASE]

    layers = []

    with psycopg2.connect(
            database=db_config["db_name"],
            host=db_config["host"],
            port=db_config["port"],
            user=db_config["username"],
            password=db_config["password"],
            # options=f'-c statement_timeout={statement_timeout_ms}'
    ) as conn:
        cur = conn.cursor()
        cur.execute(f"""select m.data, m.id, c.name from public.metadata m
        left join public.metadatacateg mc on mc.metadataid = m.id
        left join public.categories c on mc.categoryid = c.id
    order by m.id""")

        recs = list(cur.fetchall())

    for r in recs:
        metadata_id = r[1]
        xml_data = r[0]
        cat_name = r[2]
        parsed_xml = get_triple_from_xml_text(xml_data)

        # print(f"Parsing {metadata_id}")

        glayer = GeonetworkLayer()

        elem = find_single_element(parsed_xml, './/gmd:applicationProfile')
        if elem is not None:
            xml_category = elem[0].text
            glayer.xml_category = xml_category
            glayer.db_category = cat_name
        # print(f"Found Category, in xml: {xml_category}, in db: {cat_name}")

        elem = find_single_element(parsed_xml, './/gmd:title')
        if elem is not None:
            title = elem[0].text
            glayer.title = title
            # print(f"Found title: {title}")

        elem = find_single_element(parsed_xml, './/gmd:description')
        if elem is not None:
            desc = elem[0].text
            glayer.description = desc
            # print(f"Found description: {desc}")

        elem = find_single_element(parsed_xml, './/gmd:purpose')
        if elem is not None:
            purpose = elem[0].text
            glayer.purpose = purpose

        elem = find_single_element(parsed_xml, './/gmd:abstract')
        if elem is not None:
            abstract = elem[0].text
            glayer.abstract = abstract

        elems = find_all_elements(parsed_xml, './/gmd:keyword')
        if elems is not None:
            keywords = [ e[0].text for e in elems]
            glayer.keywords = keywords
            # print(f"Found description: {desc}")

        extent = [None, None, None, None]
        for idx, extent_tag_name in enumerate([
            'gmd:westBoundLongitude',
            'gmd:eastBoundLongitude',
            'gmd:southBoundLatitude',
            'gmd:northBoundLatitude',
        ]):
            elem = find_single_element(parsed_xml, f'.//{extent_tag_name}')
            if elem is not None:
                extent[idx] = float(elem[0].text)

        glayer.extent = extent

        parsed_xml = get_triple_from_xml_text(xml_data)
        elem = find_single_element(parsed_xml, './/gmd:URL')
        if elem is not None:
            glayer.wfs_url = elem.text.strip()

            # capture the precending & as well
            cql_filter_loc = elem.text.find("CQL_FILTER=")
            if cql_filter_loc >= 1:
                glayer.encoded_cql_filter = elem.text[cql_filter_loc - 1:]
            else:
                glayer.encoded_cql_filter = ""

            parsed_url = urlparse(elem.text)
            parsed_qs = parse_qs(parsed_url.query)

            if 'typeName' not in parsed_qs:
                glayer.geoserver_typename = None
            else:
                glayer.geoserver_typename = parsed_qs['typeName'][0]

                if not isinstance(glayer.geoserver_typename, str) :
                    log.warning(f"Typename is not a string or not valid.  url query: {parsed_url.query}")
                    glayer.geoserver_typename = None

            if 'CQL_FILTER' in parsed_qs:
                glayer.cql_filter = parsed_qs['CQL_FILTER'][0]
            elif "National" not in title:
                log.error(
                    f"Did not find a cql_filter for {title} {glayer.geoserver_typename} for {elem.text} for {metadata_id}, {parsed_qs}")
                glayer.cql_filter = None

        else:
            log.warning(f"No WFS URL found for {metadata_id}, title {title}")
            glayer.geoserver_typename = None
            glayer.wfs_url = None

        layers.append(glayer)

    return layers


def check_iso_to_geonetwork_layers(
    iso_to_geonetwork_layers : Dict[str, List[GeonetworkLayer]],
):
    """
    Makes sure the db layers grouped by state/country code are valid
    Exits script if there are errors that require restarting
    """
    check_failed = False
    entries_need_creation = False

    expected_titles = [
        gn.title for gn in Config.GEONETWORK_LAYERS
    ]
    expected_titles_set = set(expected_titles)

    # the title to the correct geonetwork layer
    title_to_glayer: Dict[str, GeonetworkLayer] = {
        gn.title: gn for gn in Config.GEONETWORK_LAYERS
    }

    iso_to_state_name = {
        c["code"]: c["name"] for c in Config.COUNTRY_STATES
    }

    state_code_to_extent = {
        state_cfg["code"]: [state_cfg["extent"]["min_x"], state_cfg["extent"]["max_x"],
                            state_cfg["extent"]["min_y"], state_cfg["extent"]["max_y"]]
        for state_cfg in Config.COUNTRY_STATES
    }

    for iso_code in iso_to_geonetwork_layers:
        log.info('=' * 80)
        log.info(f"Checking State/country code: {iso_code}")
        country_name = iso_to_state_name[iso_code]
        iso_to_geonetwork_layers[iso_code].sort()

        # keep track of all titles we have not found yet
        # We want to make sure we have 1 per state / country == 37 or 38
        not_found_titles = copy.deepcopy(expected_titles_set)

        # glayer is a layer from the geonetwork database
        for glayer in iso_to_geonetwork_layers[iso_code]:

            # If the check passes, the title will be removed from not_found_titles
            glayer_check_failed = check_db_geonetwork_layer_vs_yaml_expected(glayer,
                                               not_found_titles,
                                               title_to_glayer,
                                               iso_code,
                                               country_name,
                                               expected_titles_set,
                                               state_code_to_extent)
            if glayer_check_failed and (Config.FORCE or confirm("Remove?")):
                log.info(f"Deleting by title...")
                delete_by_title(glayer.title)

            check_failed = check_failed or glayer_check_failed

        log.debug("Reviewing titles not found in database, if layer has no entries in geoserver, this is OK and expected")

        not_found_to_check = not_found_titles.copy()
        for t in not_found_to_check:
            glayer = title_to_glayer[t]
            glayer.state_code = iso_code
            fc = get_feature_count(glayer.get_expected_wfs_url())
            if fc == 0:
                trace_log.debug(f"Layer {glayer.title} for state {glayer.state_code} is empty so it is expected/normal to not be in geonetwork")
                not_found_titles.remove(t)


        #all_titles = ", ".join( [ f"\"{s}\"" for s in iso_to_titles[iso_code]])
        #print(all_titles)
        # Only create if there are no other problems
        if not check_failed and len(not_found_titles)!=0 :
            log.warning(f"ERROR! Country {iso_code} / {country_name} does not have expected titles: {not_found_titles}")
            entries_need_creation = True
            if confirm("Recreate missing layers?"):
                for t in not_found_titles:
                    # get the YAML provided geonetwork layer
                    glayer_to_create = title_to_glayer[t]

                    # clean any dangling ones
                    delete_by_title(glayer_to_create.title)
                    add_layer_to_all_states(glayer_to_create)

        # since the delete affects all states, we quit the country/state loop once we have made a change
        if check_failed:
            log.error("Check of existing layers failed, exiting...Please rerun after allowing this script to remove geonetwork layers not matching Yaml config")
            sys.exit(0)

        if entries_need_creation:
            log.error("Missing layers, rerun script with same paramaters after allowing script to recreate missing geonetwork layers")
            sys.exit(0)

        expected_titles_str = "\n".join(sorted(expected_titles))
        trace_log.info(f"For state/country {iso_code}, found all expected titles:\n{expected_titles_str}")

    log.info("YAML configuration matches geonetwork configuration!")


def check_db_geonetwork_layer_vs_yaml_expected(glayer: GeonetworkLayer,
                                               not_found_titles,
                                               title_to_glayer,
                                               iso_code,
                                               country_name,
                                               expected_titles_set,
                                               state_code_to_extent) -> bool:
    """
    Compares a database geonetwork layer with what is expected from the YAML
    :param glayer: from the database
    :param not_found_titles:
    :param title_to_glayer:
    :param iso_code:
    :param country_name:
    :param expected_titles_set:
    :param state_code_to_extent:
    :return: true if the check falied
    """
    t = glayer.title
    # log.info(f"Inspecting {country_name} {glayer.title} for {glayer.country_isocode}")
    # print(f"Title: {t}")
    if t not in expected_titles_set:
        log.warning(
            f"ERROR!  Cannot find title {t} in expected list for country {iso_code} / {country_name}.  This means the title is not in the configured list")
        return True

    # because any title is removed from not_found, this means it is a duplicate
    if t not in not_found_titles:
        log.warning(f"ERROR!  Duplicate title {t} for country {iso_code} / {country_name}")
        return True

    # title has been found
    not_found_titles.remove(t)

    expected_glayer = title_to_glayer[t]
    # the expected is country agnostic, so we set it to
    expected_glayer.state_code = glayer.state_code
    assert expected_glayer is not None
    if glayer.description != expected_glayer.description:
        log.warning(
            f"ERROR! Description mismatch with {t} for {glayer.state_code} / {glayer.title}.  Found:\n{glayer.description}\nShould be:\n{expected_glayer.description}")
        return True

    if glayer.abstract != expected_glayer.abstract:
        log.warning(
            f"ERROR! Abstract mismatch with {t} for {glayer.state_code} / {glayer.title}.  Found:\n{glayer.abstract}\nShould be:\n{expected_glayer.abstract}")
        return True

    if glayer.xml_category != glayer.db_category:
        log.warning(
            f"XML and DB Category not the same for {glayer.state_code} / {glayer.title}.  [{glayer.xml_category}] vs [{glayer.db_category}]")
        return True

    if glayer.db_category != expected_glayer.category:
        log.warning(
            f"Category not expected for {glayer.state_code} / {glayer.title}.  [{glayer.db_category}] vs expected [{expected_glayer.category}]")
        return True

    if glayer.purpose != expected_glayer.purpose:
        log.warning(
            f"Purpose not expected for {glayer.state_code} / {glayer.title}.  [{glayer.purpose}] vs expected [{expected_glayer.purpose}]")
        return True

    if glayer.keywords != expected_glayer.keywords:
        found_kw = "\n".join(f"\"{kw}\"" for kw in glayer.keywords)
        expected_kw = "\n".join(f"\"{kw}\"" for kw in expected_glayer.keywords)
        log.warning(
            f"Keywords not expected for {glayer.state_code} / {glayer.title}.\nKeywords:\n{found_kw}\n\nExpected keywords:\n{expected_kw}")
        return True

    if glayer.encoded_cql_filter != expected_glayer.get_cql_filter_url_part():
        log.warning(
            f"CQL Filter in database:\n{glayer.encoded_cql_filter}\n\nExpected cql filter:\n{expected_glayer.get_cql_filter_url_part()}")
        log.warning(f"CQL Filter not expected for {glayer.state_code} / {glayer.title}.")
        return True

    if glayer.wfs_url != expected_glayer.get_expected_wfs_url():
        log.warning(
            f"WFS URL in database:\n{glayer.wfs_url}\n\nExpected WFS URL:\n{expected_glayer.get_expected_wfs_url()}")
        log.warning(f"WFS URL Filter not expected for {glayer.state_code} / {glayer.title}.")
        return True

    expected_extent = list(state_code_to_extent[iso_code])

    if glayer.extent != expected_extent:
        log.warning(f"Extent not expected for {glayer.state_code} / {glayer.title}.")
        log.warning(f"Was {glayer.extent} but expected {expected_extent}")

        return True

    if glayer.geoserver_typename != expected_glayer.geoserver_typename:

        log.warning(
            f"Typename not expected in {glayer.title} / {glayer.state_code}  {glayer.geoserver_typename} and expected {expected_typename}")
        return True

    fc = get_feature_count(expected_glayer.get_expected_wfs_url())

    if fc == 0:
        log.warning(f"Layer {glayer.title} / {glayer.state_code} is empty, should be removed from geonetwork")
        return True

    return False


def get_state_extents(state_codes: List[str], util_cfg) -> Dict[str, List[float]]:
    """
    Fetches state extents from the master GDB
    """
    log.info(f"Getting state extents from database {util_cfg.POSTGRESQL_DATABASE} @ {util_cfg.POSTGRESQL_HOST}:{util_cfg.POSTGRESQL_PORT}.  Username: {util_cfg.POSTGRESQL_USERNAME}")

    with db_utils.create_db_connection(util_cfg) as conn:

        ret = {}
        decimal_places = 10
        for state in state_codes:

            if state == "NGA":
                where_clause = ""
            else:
                where_clause = f"WHERE state_code ilike '{state}'"

            sql = f"""
select 
    Round(ST_XMIN(shape)::numeric, {decimal_places})::double precision, 
    Round(ST_XMAX(shape)::numeric, {decimal_places})::double precision,
    Round(ST_YMIN(shape)::numeric, {decimal_places})::double precision, 
    Round(ST_YMAX(shape)::numeric, {decimal_places})::double precision
FROM (
        SELECT ST_Extent(geom) AS shape
        FROM {DbConstants.SCHEMA_MASTER}.boundary_states_latest states
        {where_clause}
     ) sq ;
"""
            trace_log.debug(sql)

            data = db_utils.get_results(conn, sql)
            assert len(data) == 1
            first_row = data[0]
            assert len(first_row) == 4

            for i in range(0, 4):
                assert isinstance(first_row[i], float), f"Missing extent for {state}.  Ensure you have all states imported"

            ret[state] = first_row

    if len(ret) < 30:
        raise Exception(f"Could not find all state extents, make sure your database has the states imported.  Found {len(ret)}")

    else :
        log.info(f"Found extents to {len(ret)} states")

    return ret


def get_feature_count(wfs_url) -> int:

    yaml_config = Config.YAML_CONFIG

    geoserver_config = yaml_config['geoserver']
    url = geoserver_config.get('internal_url', geoserver_config['url'])
    parsed_internal_url = urlparse(url)

    parsed_url = urlparse(wfs_url)

    url_params = parse_qs(parsed_url.query)

    #print(url_params)

    url_params.update( {
        "version": ["1.0.0"],
        "request": ["GetFeature"],
        "maxFeatures": ["1"],
        "outputFormat": ["application/json"]
    })

    # replace the parameters as well as certain parts of the internal Url
    # The reason for this is that sometimes when accessing from the GDM
    # docker image, the url outside of docker is not the same.  This is
    # the case with internal deployments
    parsed_url = parsed_url._replace(
        query=urlencode(url_params, doseq=True),
        scheme=parsed_internal_url.scheme,
        netloc=parsed_internal_url.netloc
    )

    #print(parsed_url)

    url = urlunparse(parsed_url)

    trace_log.debug(f"Fetching feature count with url {url}")

    resp = requests.get(url=url)

    try:
        data = resp.json()
    except json.decoder.JSONDecodeError:
        log.warning(f"Could not decode response: {resp.text}\nUrl: {url}")
        return 0

    #print(data)

    return data["totalFeatures"]

if __name__ == "__main__":

    main()




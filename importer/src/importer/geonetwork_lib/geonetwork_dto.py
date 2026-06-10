import argparse
import copy
import logging
import os
import sys
import urllib
from dataclasses import dataclass, field
from functools import total_ordering
from typing import Dict, List
from urllib.parse import urlparse, parse_qs


import psycopg2
import requests
import xml.dom.minidom

import yaml
from importer.geonetwork_lib.geonetwork_api import fetch_tags

from importer.geonetwork_lib.config import Config
from importer.geonetwork_lib.xml import XML_REPLACEMENT_CONSTANTS, xml_escape, get_triple_from_xml_text, ParsedXML
from lib import db_utils

from importer.constants import YamlConfigConstants, DbConstants
from importer.util import init_logging, parse_path, merge_dictionaries
from lib.db_utils import UtilConfig

log = logging.getLogger(__name__)
trace_log = logging.getLogger("trace." + __name__)


@total_ordering
@dataclass()
class GeonetworkLayer:

    # without the country leading it
    title: str = None
    db_table: str = None

    is_geoserver_view: bool = False

    # Not escaped / nor url encoded.  Set from YAML file
    cql_filter: str = None
    encoded_cql_filter: str = None

    category: str = None
    xml_category: str = None
    db_category: str = None

    description: str = None
    abstract: str = None

    geoserver_typename: str = None
    purpose: str = None

    keywords: List[str] = field(default_factory=list)

    wfs_url: str = None

    state_code: str = None
    country_name: str = None

    extent: List[float] = field(default_factory=list)

    def __lt__(self, other):
        return ((self.state_code.lower(), self.title.lower()) <
                (other.state_code.lower(), other.title.lower()))

    @staticmethod
    def url_encode_cql_filter(cql_filter) -> str:
        if cql_filter is None or len(cql_filter) == 0:
            return ""

        return "&CQL_FILTER=" + urllib.parse.quote(cql_filter)

    def get_cql_filter_url_part(self) -> str:

        cql_filter = self.cql_filter

        if self.state_code == "NGA":
            return self.url_encode_cql_filter(cql_filter)

        if not cql_filter:
            cql_filter = ""
        else:
            cql_filter += " AND "

        cql_filter += f"state_code='{self.state_code}'"

        return self.url_encode_cql_filter(cql_filter)

    def get_expected_wfs_url(self) -> str:
        """
        Note this is NOT xml escaped
        """
        return f"{Config.GEOSERVER_BASE_URL}/GRIDMaster/ows?service=WFS&version=1.0.0&request=GetFeature&typeName={self.geoserver_typename}&outputFormat=application%2Fjson{self.get_cql_filter_url_part()}"

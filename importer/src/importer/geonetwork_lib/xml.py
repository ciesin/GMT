import xml
from io import StringIO
from typing import Dict
from xml.etree import ElementTree
from dataclasses import dataclass


class XML_REPLACEMENT_CONSTANTS:
    """
    Variables in the xml to replace.  Surrounded by
    {{}} with no whitespace between the braces
    like
    {{TITLE_WITH_STATE}}
    """
    TITLE_WITH_STATE = "TITLE_WITH_STATE"
    GEOSERVER_BASE_URL = "GEOSERVER_BASE_URL"
    CATEGORY = "CATEGORY"
    TITLE = "TITLE"
    DESCRIPTION = "DESCRIPTION"
    ABSTRACT = "ABSTRACT"
    LAYER_EXTENT_WEST = "LAYER_EXTENT_WEST"
    LAYER_EXTENT_EAST = "LAYER_EXTENT_EAST"
    LAYER_EXTENT_SOUTH = "LAYER_EXTENT_SOUTH"
    LAYER_EXTENT_NORTH = "LAYER_EXTENT_NORTH"
    KEYWORDS = "KEYWORDS"
    PURPOSE = "PURPOSE"

    URL = "URL"
    LINEAGE = "LINEAGE"


def get_string_to_replace(a_str):
    """
    Returns what will be replaced in the XML, adds {{ and }}
    :param a_str:
    :return:
    """
    return "{{" + a_str + "}}"

def get_namespaces(xml_text: str) -> Dict[str, str]:
    """
    :param xml_text: string containing xml
    :return:  namespace prefix to uri
    """
    return dict([
        node for _, node in ElementTree.iterparse(
            StringIO(xml_text), events=['start-ns']
        )
    ])


def xml_escape(xml_str: str) -> str:
    if xml_str is None:
        return ""
    xml_str = xml_str.replace("&", "&amp;")
    xml_str = xml_str.replace("<", "&lt;")
    xml_str = xml_str.replace(">", "&gt;")
    xml_str = xml_str.replace("\"", "&quot;")
    return xml_str


@dataclass
class ParsedXML:
    xml_text: str
    tree: xml.etree.ElementTree
    # namespace map
    ns_map: Dict[str, str]


def get_triple_from_xml_text(xml_text) -> ParsedXML:
    return ParsedXML(
        xml_text=xml_text,
        tree=ElementTree.fromstring(xml_text),
        ns_map=get_namespaces(xml_text)
    )


def find_single_element(parsed_xml: ParsedXML, xpath: str):
    found_elem = None
    for elem in parsed_xml.tree.findall(xpath, parsed_xml.ns_map):
        # Fail if we find a second one
        assert found_elem is None
        found_elem = elem

    return found_elem


def find_all_elements(parsed_xml: ParsedXML, xpath: str):
    found_elems = []
    for elem in parsed_xml.tree.findall(xpath, parsed_xml.ns_map):
        found_elems.append(elem)

    return found_elems


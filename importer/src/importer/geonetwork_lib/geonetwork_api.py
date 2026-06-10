from typing import Dict

import requests

from importer.geonetwork_lib.config import Config


def fetch_tags() -> Dict[str, int]:
    """
    Fetches tags from geonetwork.

    Tags are what is used to categorize the entries (Eductation, Administrative Boundaries, etc.)

    """
    r = requests.get(url=Config.GEONETWORK_API_BASE_URL + "/tags",
              headers={"Accept": "application/json"},
              auth=(Config.CSW_ADMIN_USERNAME, Config.CSW_ADMIN_PASSWORD))

    #log.info(f"{Config.CSW_ADMIN_USERNAME} / {Config.CSW_ADMIN_PASSWORD} -- Raw response from {Config.GEONETWORK_API_BASE_URL}: {r.text}")

    data = r.json()

    return {d["name"]: d["id"] for d in data}
import os


class Config:

    #############################################################################################
    # Note these values are initialized by the init config to allow the yaml file to take priority
    COUNTRY_STATES = None
    GEONETWORK_BASE_URL = None
    GEONETWORK_API_BASE_URL = None
    GEOSERVER_BASE_URL = None
    CSW_PUBLICATION_URL = None
    CSW_ADMIN_USERNAME = None
    CSW_ADMIN_PASSWORD = None
    GEONETWORK_LAYERS = None
    YAML_CONFIG = None
    FORCE = None
    #
    #############################################################################################

    # JSON payload to set permissions on geonetwork resource
    JSON_PERM_PAYLOAD = {
        "privileges": [
            {
                "group": 1,
                "operations": {
                    "view": True, "download": True, "dynamic": True
                }
            }
        ]
    }

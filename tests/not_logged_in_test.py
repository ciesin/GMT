import sys
import os
import logging
from locust import HttpUser, task, between, events, run_single_user
from locust.exception import RescheduleTask, InterruptTaskSet
from locust.event import EventHook
from http.client import HTTPConnection

HTTPConnection.debuglevel = 1
logging.basicConfig()
logging.getLogger().setLevel(logging.DEBUG)
requests_log = logging.getLogger("requests.packages.urllib3")
requests_log.setLevel(logging.DEBUG)
requests_log.propagate = True
# disable warnings about ssl certificate
# urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# configure logging
logger = logging.getLogger(__name__)

# Create custom event instead
errorHook = EventHook()
def on_error_500(name, message, **kw):
    logger.warning(f'on_error_500: {name} {message}')
    sys.exit(0)

errorHook.add_listener(on_error_500)

#add cpu_warning listener
def on_cpu_warning(environment, cpu_usage, **kwargs):
    logger.error(f'Stopping due to CPU usage: {cpu_usage}')
    sys.exit(1)

events.cpu_warning.add_listener(on_cpu_warning)

class IsOnlineLoadTest(HttpUser):
    root_server = "https://gmt-test.novel-t.ch/api/" # "http://server:3000" # https://gmt-dev.novel-t.ch/api/
    root_keycloak = "https://gmt-test.novel-t.ch/auth/" #"http://keycloak:4249" # https://gmt-dev.novel-t.ch/auth/

    wait_time = between(1, 5)

    @task
    def is_online(self):
        endpoint = "is_online"
        url = os.path.join(self.root_server, endpoint)
        with self.client.get(url, catch_response=True) as r:
            if r.status_code != 200:
                r.failure(f"Nooooo, fail to check is_online {url}!")
                logger.warning(f'status_code {r.status_code}')
                logger.warning(f'__dict__ {r.__dict__}')
                raise RescheduleTask
            return
    @task
    def user_profile(self):
        endpoint = "me"
        url = os.path.join(self.root_server, endpoint)
        with self.client.get(url, catch_response=True) as r:
            if r.status_code != 200:
                r.failure(f"Nooooo, fail to check user_profile {url}!")
                logger.warning(f'status_code {r.status_code}')
                logger.warning(f'__dict__ {r.__dict__}')
                raise RescheduleTask
            return

    # @task
    # def take_data_offline(self):
    #     endpoint = "request_catchment_update"
    #     url = os.path.join(self.root_server, endpoint)
    #     with self.client.post(url,
    #                           catch_response=True,
    #                           json=["5a651043-340f-4235-9270-bdff3be5ecc3","04f5fffd-57dd-4b7a-977f-6dee5a396471","0f1b898c-31c1-4c65-953a-ea48e569df4a","183e5e66-b375-44bf-8ee7-4d5aa3b0e539","23aa2585-7f7c-45f7-947f-eac97d5fb506","182a518f-d6c1-4dd4-9b16-557ca277a478","19bdbc11-38ad-4f25-aa9c-82951a025153","737289c5-b534-4f01-b6f6-ce2e8a77ea70","f18f6b2e-0de8-4252-8362-b7933fd5d61e","fbf6c164-cfee-4ba7-afdd-727936aea0db","3eba1f03-98d4-4335-804e-6c3f9e7d5da1","05431b92-f04d-4f60-ad77-46263483c1b8","0552ea56-cc80-4056-9ff1-2ac4c1eaeb7b","06eb2fcd-0c95-411e-87ad-805fa1a5ca4b","07333309-98cd-4ff8-8399-5f20ae6c65de","0a6f11d5-38f5-412f-bbf0-9449197ba848","0e1ab5d5-b368-4bbc-bfeb-2c6c3e3a5692","2a05b0cd-4c11-4f69-a1c1-03f20ebe0874","2aa99763-c564-4fd3-8b79-c88de2eca1fd","2f272993-5feb-432d-952d-ba76f2e5bf1d","364bb20e-b3e7-49c7-8f45-839850a8d6e4","3a60cc92-eb94-49bc-a393-54696f211a4e","3e774e4b-126f-433c-99c2-98088a4cc4db","61e3345e-d494-4d5e-a562-5b98e83a7d8b","69069dd7-e0e5-4585-9f74-771ae6e23df7","722e89c7-1d50-478c-86c8-173e05a942b6","75625805-0942-4ad9-a084-4039c638b3d6","79ec4222-fb10-45ce-a3b6-725d1d89fa69","7bd3639a-f66f-43ea-b4cd-496b33eb8e51","8d778112-1d42-49e7-843b-6ba030ecc5a5","9ed206f8-4b3e-4fae-9a50-718e93bf0c57","a0e5e235-119b-4fbb-aa7c-9a2a738ad1ea","a8db00fb-5838-48ff-9c0c-d4bf67d5484d","c7d1c3e6-73b4-411f-9c67-0c8fd03bcaa1","d15edf32-db95-4134-a472-bf32a1ce6f5a","d430164f-7e8c-4f95-b96c-db6bdd5ed889","e0a58da9-bd00-4f69-9681-d31dbb69728a","ea2277d1-89d1-4067-9015-981deb83936a","eb903800-a1c7-49e1-aac2-99e1b964ad1c","f17d74cd-5eae-4e90-ac90-609705f2105a"]
    #                           ) as r:
    #         if r.status_code != 200:
    #             r.failure(f"Nooooo, fail to check is_online {url}!")
    #             logger.warning(f'status_code {r.status_code}')
    #             logger.warning(f'__dict__ {r.__dict__}')
    #             raise RescheduleTask
    #         return

    @task
    def keycloak_config(self):
        endpoint = "auth/realms/gmt/.well-known/openid-configuration"
        url = os.path.join(self.root_keycloak, endpoint)
        with self.client.get(url, catch_response=True) as r:
            if r.status_code != 200:
                r.failure(f"Nooooo, fail to retrieve keycloak_config! {url}, status: {r.status_code}, __dict__: {r.__dict__}")
                logger.warning(f'status_code {r.status_code}')
                logger.warning(f'__dict__ {r.__dict__}')
                raise RescheduleTask
            return


if __name__ == "__main__":
    run_single_user(IsOnlineLoadTest)
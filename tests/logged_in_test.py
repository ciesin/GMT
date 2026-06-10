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
    root_server = "http://server:3000" # "http://server:3000" # https://gmt-dev.novel-t.ch/api/ https://gmt-test.novel-t.ch/api/ https://gmt-uat-api.novel-t.ch/
    root_keycloak = "http://keycloak:4249" #"http://keycloak:4249" # https://gmt-dev.novel-t.ch/auth/ https://gmt-test.novel-t.ch/auth/ https://gmt-uat-auth.novel-t.ch/
    # TODO fill for the tests with authorized user
    token_string = ""

    wait_time = between(1, 5)

    # def on_start(self):
    #     self.client.post("/login", json={"username":"", "password":""})

    @task
    def is_online(self):
        endpoint = "is_online"
        url = os.path.join(self.root_server, endpoint)
        with self.client.get(url,
                             headers={"authorization": "Token " + self.token_string},
                             catch_response=True) as r:
            if r.status_code != 200:
                r.failure(f"Nooooo, fail to check is_online {url}, status: {r.status_code}, __dict__: {r.__dict__}!")
                logger.warning(f'status_code {r.status_code}')
                logger.warning(f'__dict__ {r.__dict__}')
                raise RescheduleTask
            return
    @task
    def user_profile(self):
        endpoint = "me"
        url = os.path.join(self.root_server, endpoint)
        with self.client.get(url,
                             headers={"authorization": "Bearer " + self.token_string},
                             catch_response=True) as r:
            # print(r,'r',r.__dict__)
            if r.status_code != 200:
                r.failure(f"Nooooo, fail to check user_profile {url}, status: {r.status_code}, __dict__: {r.__dict__}!")
                logger.warning(f'status_code {r.status_code}')
                logger.warning(f'__dict__ {r.__dict__}')
                raise RescheduleTask
            return

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
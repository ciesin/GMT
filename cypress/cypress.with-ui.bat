@echo off
set file=%1
echo Using config file %~dp0..\config\%file%
FOR /F "tokens=1* eol=# delims=t" %%G in ('type "%~dp0..\config\%file%"') do SET %%H
FOR /F "tokens=1* eol=# delims=t" %%G in ('type "%~dp0..\config\secrets.%file%"') do SET %%H

set CYPRESS_BASEURL=%PWA_URL%/
set CYPRESS_BASE_URL=%PWA_URL%/

set CYPRESS_EDITOR_USER=%GMT_EDITOR_USER%
set CYPRESS_EDITOR_PWD=%GMT_USER_PASSWORD%
set CYPRESS_AUTHURL=%KEYCLOAK_INSTANCE_EXTERNAL_PROTOCOL%://%KEYCLOAK_DOMAIN%/%KEYCLOAK_AUTH_URL_PREFIX%

echo base URL used: %CYPRESS_BASEURL%
echo keycloak URL used: %CYPRESS_AUTHURL%

npx cypress open

## Suggested Nodejs structure
```
├── api (equal to controllers methods that handles endpoints)
│   └── each folder represents "module"
├── config (config loaded into dictionaries)
│   └── tables.config.ts (names of tables and schemas to not hardcode tables names)
├── server-interfaces (everything that is supposed to be shared with pwa)
│   ├── utils - functions shared with pwa
│   └── single files (various interfaces, not sure if they should be grouped)
├── services (workers that are more related to specific endpoint like initializing the keycloak server 
groupd by modules)
│   └── (not implemented)
├── utils (reusable components groupd by modules)
│   ├── auth - auth related helpers - part of it should be moved to services
│   └── helpers - generic helpers like default dictionary structure
├── tests
│   ├── fixtures
│   ├── integration (not implemented yet)
│   └── unit
````

Suggested errors format - always throw multiple errors response body: errors: ["My error"]

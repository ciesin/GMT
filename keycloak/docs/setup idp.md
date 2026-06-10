# Setup IDP

## How to setup google IDP

Go to [google's developer console](https://console.developers.google.com).

![screenshot of blank google api](./assets/google%20first%20screen.png)

### 1. Create project

You will first need to create a project. The creation may take google several minutes.

![screenshot of new project form](./assets/google%20new%20project.png)

### 2. Fill in oauth consent screen

Once the project created, you will need to fill in the **Oauth consent screen**. Important information are:

- application name
- application logo
- support email
- authorized domains

![screenshot of oauth consent screen page](./assets/google%20oauth%20consent%20screen.png)

### 3. Create credentials

You can now create credentials which Keycloak will use to retrieve google users information. Choose _"Oauth client id"_, _"web application"_. Give it at name and create.

You will be shown the client id and secret. We can find them afterwards so don't fear closing the popup.

![screenshot of client credentials popup](./assets/google%20client%20secret.png)

To retrieve _client id_ and _client secret_ again, you can click on the newly created client in the credentials tab.
Copy them to `secrets/google_idp.env` and restart the keycloak container.

### 4. Save secrets and set redirect uris

Login into keycloak administration console. Choose the _gmt_ realm and _"Identity Providers"_ tab. Choose the google provider. You should see the _"client ID"_ and _"Client Secret"_ set like provided by the `secrets/google_idp.env` file. Copy the _"Redirect URI"_ and get back to the google credentials.

![screenshot of keycloak's google idp](./assets/keycloak%20google%20idp.png)

Now paste the redirect uri in _"Authorized redirect URIS"_ and save.

Congrats, you are done configuring the **Google IDP**!

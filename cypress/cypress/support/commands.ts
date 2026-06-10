// ***********************************************
// This example commands.js shows you how to
// create various custom commands and overwrite
// existing commands.
//
// For more comprehensive examples of custom
// commands please read more here:
// https://on.cypress.io/custom-commands
// ***********************************************
//
//
// -- This is a parent command --
// Cypress.Commands.add('login', (email, password) => { ... })
//
//
// -- This is a child command --
// Cypress.Commands.add('drag', { prevSubject: 'element'}, (subject, options) => { ... })
//
//
// -- This is a dual command --
// Cypress.Commands.add('dismiss', { prevSubject: 'optional'}, (subject, options) => { ... })
//
//
// -- This will overwrite an existing command --
// Cypress.Commands.overwrite('visit', (originalFn, url, options) => { ... })

// Login to GTS with token
Cypress.Commands.add('login', (username: string, pwd: string) => {
    let oauth = Cypress.env('oauth');
    cy.request({
        method: 'POST',
        url : Cypress.env('AUTHURL') + '/realms/gmt/protocol/openid-connect/token',
        form: true,          // sets to application/x-www-form-urlencoded
        body: {
            grant_type: oauth.grant_type,
            client_id: oauth.client_id,
            username: username,
            password: pwd,
        }
    })
        .its('body')        // select response body
        .then(({ access_token, refresh_token }) => {
            window.localStorage.setItem('gmt_access_token', access_token);
            window.localStorage.setItem('gmt_refresh_token', refresh_token);
        })
});

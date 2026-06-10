
describe('Test landing page', () => {
    beforeEach(() => {
        const url = Cypress.env('BASEURL');
        cy.task('log', "Visiting: " + url);
        cy.visit(url);
    });

        it('should redirect to keycloak', () => {
            // Make sure we were redirected to keycloak
            cy.url().should('include', 'auth/realms/gmt/protocol/openid-connect/auth')
            // Check title
            cy.title().should('include', 'Authentication');

        });

        it('Google should be visible', () => {
            cy.get(".social-label-container").contains("Google").should("be.visible");
        });


        it('should login', () => {
            const username = Cypress.env('EDITOR_USER');
            cy.task('log', "username: " + username);
            const password = Cypress.env('EDITOR_PWD').replace(/^\s+|\s+$/g, '');
            cy.task('log', "password: " + password);
            cy.get('input[name=username]').should("be.visible").type(username);
            cy.get('input[name=password]').should("be.visible").type(password);
            cy.get('input[type=submit]').contains("Ok").should("be.visible").click();

            //Module page should be visible
            cy.title().should('include', 'Geospatial Microplanning Toolkit');
            cy.contains("Routine").should("be.visible");
            cy.contains("Non Polio").should("be.visible");
        });
});
describe('Module selection page', () => {
    let access_token = null;
    let refresh_token = null;

    before(() => {
        cy.login(Cypress.env('EDITOR_USER'), Cypress.env('EDITOR_PWD').replace(/^\s+|\s+$/g, ''));
        cy.window().its('localStorage.gmt_access_token').then((token) => {
            access_token = token;
        });
        cy.window().its('localStorage.gmt_refresh_token').then((token) => {
            refresh_token = token;
        });
    });
    beforeEach(() => {
        const url = Cypress.env('BASEURL');
        localStorage.setItem("gmt_access_token", access_token);
        localStorage.setItem("gmt_refresh_token", refresh_token);
        cy.task('log', "Visiting: " + url);
        cy.visit(url);
    });

    it('should open by default when logged-in', () => {
        expect(localStorage.getItem("gmt_access_token")).to.exist;
        cy.contains("Routine").should("be.visible");
        cy.contains("Non Polio").should("be.visible");
        cy.url().should('equal', Cypress.env('BASEURL'));
    });

    it('Click on RI should open the dashboard', () => {
        expect(localStorage.getItem("gmt_access_token")).to.exist;
        cy.get('a.card').contains("Routine").click();
        cy.url().should('contain', 'dashboard');
    });

});
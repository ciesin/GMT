describe('Dashboard page', () => {
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
        const url = `${Cypress.env('BASEURL')}dashboard`;
        localStorage.setItem("gmt_access_token", access_token);
        localStorage.setItem("gmt_refresh_token", refresh_token);
        cy.task('log', "Visiting: " + url);
        cy.visit(url);
    });

    it('should have a working tree-view for admin boundaries', () => {
        expect(localStorage.getItem("gmt_access_token")).to.exist;
        cy.contains("Nigeria", { timeout: 30000 }).should("be.visible");
        cy.contains("Aba North").should("not.exist");
        cy.contains("Abia").should("be.visible").click();
        cy.contains("Ariaria").should("not.exist");
        cy.contains("Aba North").should("be.visible").click();
        cy.contains("Ariaria").should("be.visible");
    });

});
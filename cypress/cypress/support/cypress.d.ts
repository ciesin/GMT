declare namespace Cypress {
    interface ResolvedConfigOptions {
        hideXHRInCommandLog?: boolean;
    }
    interface Chainable {
        login(username: string, pwd: string): Chainable<Element>
        logout(): Chainable<Element>
    }
}
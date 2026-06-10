/**
 * Replace special characters in string so it could be used as search query
 * For example this string:
 * "<>/'s s'-_A`~!@#$%^&*()+=0[]\'';/.,"
 * would return
 * "<>/s s-_A@^=0[];/.,"
 * @param text
 */
export function escapeString(text: string){
    return text.replace(/[^a-zA-Z0-9.,-_ ]/g, "")
}
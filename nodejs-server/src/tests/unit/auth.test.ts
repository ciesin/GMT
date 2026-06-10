import request from 'supertest';
import { getValidToken } from '../fixtures/auth.fixtures'
import app from '../../app';


test('Protected route should return 401 status for the users without Bearer token', async () => {
    const response = await request(app.callback()).get('/get_user_info');
    expect(response.status).toBe(401);
});

test('Protected route should return 401 status for the users with invalid access token', async () => {
    const response = await request(app.callback()).get('/get_user_info').set({ Authorization: "Bearer " + "abc" });
    expect(response.status).toBe(401);
});

test('Protected route should return 200 status for the users with valid access token works', async () => {
    const token = await getValidToken();
    const response = await request(app.callback())
        .get('/get_user_info')
        .set({ Authorization: "Bearer " + token });
    expect(response.status).toBe(200);
});

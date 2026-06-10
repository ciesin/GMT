import request from 'supertest';
import app from '../../app';

// Increase timeout as 5 seconds is not enough when running in jenkns
jest.setTimeout(20000);

test('test_DB works', async () => {
    const response = await request(app.callback()).get('/test_db');
    expect(response.status).toBe(200);
    expect(JSON.parse(response.text).row_0.description).toEqual("my first test");
});

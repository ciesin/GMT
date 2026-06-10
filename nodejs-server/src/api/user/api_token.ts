import {pool} from "../../db-read/common";

const jwt = require('jsonwebtoken');

interface TokenRequest {
    tokenName: string;
    expiresInDays: number;
}

export async function handleGenerateApiToken(ctx, next) {
    let tokenRequest: TokenRequest = ctx.request.body;
    let userId = ctx.request.params.id;

    console.log(`Creating token for ${userId}`);
    console.log(tokenRequest);

    const key = process.env.API_TOKEN_SECRET_KEY;

    const claims = {
        userId,
        tokenName: tokenRequest.tokenName,
    };

    const token = jwt.sign(claims, key, {
        algorithm: 'HS256',
        expiresIn: `${tokenRequest.expiresInDays}d`,
    });

    const decoded = jwt.decode(token);

    if (!decoded || !decoded.exp) {
        throw new Error('Token missing expiration (exp) field');
    }

// Convert `exp` (which is in seconds since epoch) to a JS Date
    const expirationDate = new Date(decoded.exp * 1000);

    //Also save to the db
    await pool.query(`INSERT INTO auth.api_token_hash
( "name", user_id, expire_date)
VALUES($1, $2, $3) `, [tokenRequest.tokenName, userId, expirationDate]);

    ctx.body = {token};

    await next();
}

export async function handleListTokens(ctx, next) {
    const userId = ctx.query.user_id;
    let result;
    if (userId) {
      result = await pool.query(
        'SELECT * FROM auth.api_token_hash WHERE user_id = $1',
        [userId]
      );
    } else {
      result = await pool.query('SELECT * FROM auth.api_token_hash');
    }

    ctx.body = result.rows;
    await next();
}

export async function handleDeleteToken(ctx, next) {
    const userId = ctx.request.body.user_id;
    const tokenName = ctx.request.body.tokenName;

    const rc = await pool.query('DELETE FROM auth.api_token_hash WHERE user_id = $1 and name = $2', [userId,tokenName]);

    ctx.body = {deleted: rc.rowCount};
}
import {UserInfo, UserInfoSchema} from "../../server-interfaces/user/User";
import {APIError, HttpStatusCode, HttpStatusName} from "../../utils/errors/errors";


export async function validatePassword(ctx, user: UserInfo){
    try{
        await UserInfoSchema.validateAt('password', user, { abortEarly: false });
    } catch (err) {
        console.log(err,'err');
        throw new APIError(ctx, HttpStatusName.BAD_REQUEST, HttpStatusCode.BAD_REQUEST,true, err.errors);
    }
}

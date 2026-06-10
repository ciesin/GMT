import { allIndicatorEnums, getEnumMap, IndicatorEnumName } from "../services/indicators/update_indicators";

export async function handleGetDbEnumIndexes(ctx, next)  {

  const enumObject = {};
  for(const enumName of allIndicatorEnums) {
    enumObject[enumName] = Object.fromEntries(await getEnumMap(enumName));
  }

  ctx.body = enumObject;

  return await next();
}

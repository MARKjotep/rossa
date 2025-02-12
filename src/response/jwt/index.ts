import { ServerSide } from "authored";
import { S } from "../../session";
import { Runner } from "../../runner";

async function refreshToken(this: Runner, JWT: ServerSide) {
  const accessToken = S.jwtInt.save(JWT);
  JWT.access_token = accessToken;
  await S.jwt.saveSession(JWT, this.headers);
  return {
    access_token: accessToken,
    refresh_token: JWT.sid,
    status: "ok",
  };
}

function handleError(this: Runner, error: string) {
  this.status = 403;
  return { error };
}

export async function JWT(this: Runner, JWT: ServerSide) {
  const { jwtv, refreshjwt } = await this.request.authgroup();

  if (!refreshjwt) {
    if (jwtv || !JWT.modified) {
      this.status = 204;
      this.type = "application/json";
      return JSON.stringify({});
    }
    return JSON.stringify(await refreshToken.call(this, JWT));
  }

  const refreshSession = await S.jwt.openSession(refreshjwt);
  const storedAccessToken = refreshSession.data.access_token;

  let response = {};
  if (jwtv !== storedAccessToken) {
    response = handleError.call(this, "tokens don't match.");
  } else if (!S.jwtInt.verify(storedAccessToken, { days: 5 })) {
    await S.jwt.saveSession(refreshSession, undefined, true);
    response = handleError.call(this, "expired refresh_token.");
  } else {
    response = await refreshToken.call(this, refreshSession);
  }

  this.type = "application/json";
  return JSON.stringify(response);
}

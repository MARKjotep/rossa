import { Auth, AuthInterface, JWTInterface, ServerSide } from "authored";
import { obj } from "../@";

class Session {
  session!: AuthInterface;
  jwt!: AuthInterface;
  jwtInt!: JWTInterface;
  constructor() {
    this.jwtInt = new JWTInterface();
  }
  init(sh: Auth) {
    this.session = sh.session;
    this.jwt = sh.jwt;
  }
}

export const S = new Session();

export class session {
  declare session: obj<string>;
  declare jwt: obj<string>;
  declare timedJWT: ServerSide;
}

export class ResponseSession implements session {
  __session?: ServerSide;
  __jwt?: ServerSide;
  get session() {
    if (!this.__session) {
      this.__session = S.session.new;
    }
    return this.__session;
  }
  set session(sesh: ServerSide) {
    this.__session = sesh;
  }
  get jwt() {
    if (!this.__jwt) {
      this.__jwt = S.jwt.new;
    }
    return this.__jwt;
  }
  set jwt(jwt: ServerSide) {
    this.__jwt = jwt;
  }
  get timedJWT() {
    return S.jwtInt.jwt();
  }
  setServerSession(rsp: ResponseSession) {
    const { __jwt, __session } = rsp;
    this.__session = __session;
    this.__jwt = __jwt;
  }
}

export const setSession = async (SS: ServerSide, headers: Headers) => {
  await S.session.saveSession(SS, headers);
};

export async function authorized(
  { sid, jwtv, refreshjwt }: obj<string>,
  args: obj<string | boolean>,
): Promise<ResponseSession | undefined> {
  const sesh: ResponseSession = new ResponseSession();

  if (sid) {
    sesh.session = await S.session.openSession(sid);
    if (!sesh.session.new) {
      args.session = true;
    }
  }

  if (jwtv) {
    sesh.jwt = S.jwtInt.open(jwtv, { hours: 6 });
    if (!sesh.jwt.new) {
      args.jwt = true;
    }
    if (refreshjwt) {
      const rjwt = await S.jwt.openSession(refreshjwt);
      if (!rjwt.new) {
        args.jwt_refresh = true;
      }
    }
  }

  if ("session" in args || "jwt" in args) {
    return sesh;
  }
}

/*
-------------------------
Authorization decorator
-------------------------
*/
export const auths = {
  session<T>(...arg: any[]) {
    return authDecor<T>(arg[0], arg[2], "session");
  },
  jwt<T>(...arg: any[]) {
    return authDecor<T>(arg[0], arg[2], "jwt");
  },
  jwt_refresh<T>(...arg: any[]) {
    return authDecor<T>(arg[0], arg[2], "jwt_refresh");
  },
};

const authDecor = <T>(t: T, descriptor: any, auth: string) => {
  const OG: (args: obj<string>) => any = descriptor.value;
  descriptor.value = async function (args: obj<string> = {}) {
    if (auth in args && args.session) {
      delete args[auth];
      return OG.call(t, args);
    }
    return {
      error: 401,
    };
  };
  return descriptor;
};

/** A resolved session with both the framework methods and the user's data. */
export type SessionInstance<
  TData extends Record<string, any> = Record<string, any>,
> = ServerSide<TData> & TData;

export class ServerSide<
  TData extends Record<string, any> = Record<string, any>,
> {
  public sid: string;
  public data: TData;
  public isNew: boolean;
  public isModified: boolean;
  public isReadOnly: boolean;
  public isFound: boolean;
  length = 0;

  /**
   * Rotation hook supplied by the session service.
   * @internal
   */
  private _rotator?: () => Promise<void>;

  constructor(
    sid: string = "",
    initialData: Partial<TData> = {},
    readOnly = false,
    isNew = true,
    isFound = false,
  ) {
    this.sid = sid;
    this.data = { ...initialData } as TData;

    this.length = Object.keys(initialData).length;

    if (this.length) {
      isNew = false;
    }
    this.isReadOnly = readOnly;
    this.isNew = isNew;
    this.isModified = false;
    this.isFound = isFound;
  }

  /**
   * Generates the dynamic Proxy trapped instance.
   * We use `this & TData` so TypeScript knows this object contains both
   * the class methods AND the dynamic user data.
   */
  public get session(): SessionInstance<TData> {
    return new Proxy<any>(this, {
      get(target, prop: string | symbol) {
        // 1. Allow access to native class properties/methods first (e.g., .cookie(), .sid)
        if (prop in target) {
          return Reflect.get(target, prop);
        }
        // 2. Otherwise, fetch from the dynamic session data
        return target.data[prop as keyof TData];
      },

      set(target, prop: string | symbol, value: any) {
        if (target.isReadOnly) {
          console.warn("session: readonly");
          return true;
        } // Strictly block mutations

        // 1. Prevent users from overwriting internal framework methods!
        if (prop in target) {
          throw new Error(
            `Cannot overwrite internal session property: ${String(prop)}`,
          );
        }

        // 2. Only flag as modified if the value actually changed
        if (target.data[prop as keyof TData] !== value) {
          target.isModified = true;

          if (!(prop in target.data)) {
            target.length++;
          }
          target.data[prop as keyof TData] = value;
        }

        return true;
      },

      deleteProperty(target, prop: string | symbol) {
        if (target.isReadOnly) {
          console.warn("session: readonly");
          return true;
        } // Strictly block mutations

        // Prevent deleting internal properties
        if (prop in target) return false;

        if (prop in target.data) {
          target.isModified = true;
          delete target.data[prop as keyof TData];
          target.length--;
        }
        return true;
      },

      has(target, prop: string | symbol) {
        return prop in target || prop in target.data;
      },

      // Intercept Object.keys() so developers can iterate over the session data cleanly
      ownKeys(target) {
        return Reflect.ownKeys(target.data);
      },
      getOwnPropertyDescriptor(target, prop) {
        if (prop in target.data) {
          return {
            enumerable: true,
            configurable: true,
            value: target.data[prop as keyof TData],
          };
        }
        return undefined;
      },
    }) as SessionInstance<TData>;
  }

  /**
   * Registers the service callback used by {@link ServerSide.rotate}.
   * @internal
   */
  public setRotator(rotator: () => Promise<void>): void {
    this._rotator = rotator;
  }

  /**
   * Replaces this session's identifier in place.
   * @internal
   */
  public renewSid(sid: string): void {
    this.sid = sid;
  }

  /**
   * Rotates the session identifier (session-fixation defence).
   *
   * The previous row is deleted and this session receives a freshly signed
   * `sid`; the guard persists the new row and sends its cookie after the
   * handler returns. Call it after a successful login:
   *
   * ```ts
   * await ctx.session!.rotate();
   * ctx.session!.userId = user.id;
   * ```
   *
   * A readonly mount ignores rotation. Throws when the session was created
   * without a session service (for example a hand-built `new ServerSide()`).
   */
  public async rotate(): Promise<void> {
    if (this.isReadOnly) {
      console.warn("session: readonly");
      return;
    }

    if (!this._rotator) {
      throw new Error(
        "session: rotate() requires a session service; use session(auth) first.",
      );
    }

    await this._rotator();
  }
}

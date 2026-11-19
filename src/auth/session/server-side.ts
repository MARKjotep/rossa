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
  public get session(): any {
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
    }) as this & TData;
  }
}

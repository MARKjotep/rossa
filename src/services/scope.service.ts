type ScopeSet<Config extends Record<string, Record<string, any>>> = {
  use<Name extends keyof Config & string>(name: Name): Config[Name];
};

/** Named, shared values for use in functions, classes, or application setup. */
class _Scope {
  private static registry = new Map<string, Record<string, any>>();

  static register<Config extends Record<string, Record<string, any>>>(
    data: Config,
  ): ScopeSet<Config> {
    for (const [name, initial] of Object.entries(data)) {
      this.registry.set(name, Object.seal({ ...initial }));
    }

    return {
      use: <Name extends keyof Config & string>(name: Name) =>
        this.use<Config[Name]>(name),
    };
  }

  static use<T extends Record<string, any>>(name: string): T {
    const scope = this.registry.get(name);
    if (!scope) {
      throw new Error(`Scope "${name}" has not been registered.`);
    }
    return scope as T;
  }
}

/** Describes the static interface of the Scope class. */
interface ScopeStatic {
  register<Config extends Record<string, Record<string, any>>>(
    data: Config,
  ): ScopeSet<Config>;
  use<T extends Record<string, any>>(name: string): T;
}

export type Scope = _Scope;
export const Scope: ScopeStatic = _Scope;

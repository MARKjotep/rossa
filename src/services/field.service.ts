// The type for the function returned by the decorator factory
type ScopeDecorator<V> = (
  value: undefined,
  context: ClassFieldDecoratorContext<any, V>,
) => (this: any) => V;

// This maps your interface keys to their respective decorators
type ScopeProxy<T> = {
  readonly [K in keyof T]: ScopeDecorator<T[K]>;
};

type FieldScopeSet<Config extends Record<string, Record<string, any>>> = {
  use<Name extends keyof Config & string>(name: Name): ScopeProxy<Config[Name]>;
};

class _FieldScope {
  private static registry = new Map<string, Record<string, any>>();

  static register<Config extends Record<string, Record<string, any>>>(
    data: Config,
  ): FieldScopeSet<Config> {
    for (const [name, initial] of Object.entries(data)) {
      const state = Object.seal({ ...initial });
      this.registry.set(name, state);
    }

    return {
      use: <Name extends keyof Config & string>(name: Name) =>
        this.use<Config[Name]>(name),
    };
  }

  static use<T extends Record<string, any>>(scopeName: string): ScopeProxy<T> {
    return new Proxy({} as any, {
      get: (_target, propName: string) => {
        return (_value: undefined, context: ClassFieldDecoratorContext) => {
          if (context.kind !== "field") {
            throw new Error("Field decorators can only be used on class fields.");
          }

          return function (this: any) {
            const scope = _FieldScope.registry.get(scopeName);
            return scope ? scope[propName] : undefined;
          };
        };
      },
    }) as ScopeProxy<T>;
  }
}

/**
 * Describes the static interface of the Field class
 */
interface FieldScopeStatic {
  register<Config extends Record<string, Record<string, any>>>(
    data: Config,
  ): FieldScopeSet<Config>;
  use<T extends Record<string, any>>(name: string): ScopeProxy<T>;
}

export type Field = _FieldScope;
export const Field: FieldScopeStatic = _FieldScope;

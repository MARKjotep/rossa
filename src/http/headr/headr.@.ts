import type { HeaderObject } from "./headr.type";
import { Utils } from "./headr.util";

/** *  Final Master Class (The one you actually use)
 */
export class Heder extends Utils {
  /**
   * Creates a deep copy of the current builder for reuse.
   */
  get copy(): Heder {
    return new Heder(this.data);
  }

  use(plugin: HederPlugin): this {
    plugin(this);
    return this;
  }
  merge(_heder: Heder | HeaderObject) {
    Object.assign(this.data, _heder instanceof Heder ? _heder.data : _heder);
    return this;
  }
  // ---  ---------------------------------------------------------------

  static init(initial?: HeaderObject): Heder {
    return new this(initial);
  }
  static get $() {
    return new this();
  }

  public get done(): HeaderObject {
    return this.data;
  }
}

export type HederPlugin = (h: Heder) => void;

export type HederFactory = Omit<typeof Heder, "prototype">;

export const heder: HederFactory = Heder;

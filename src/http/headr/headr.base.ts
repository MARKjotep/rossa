import type { HeaderObject } from "./headr.type";

export class HeadBase {
  protected data: HeaderObject;

  constructor(initialData: HeaderObject = {}) {
    this.data = { ...initialData };
  }

  protected _add(key: string, value: string): this {
    this.data[key] = value;
    return this;
  }

  public add(key: string, value: string): this {
    return this._add(key, value);
  }
}

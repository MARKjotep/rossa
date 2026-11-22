export type IpOptions = {
  whitelist?: string[];
  blacklist?: string[];
};

type IpRule = (ip: string, value: number | null) => boolean;

function parseIPv4(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;

  const octets: number[] = [];
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    octets.push(octet);
  }

  return (
    (((octets[0]! << 24) | (octets[1]! << 16) | (octets[2]! << 8) | octets[3]!) >>>
      0)
  );
}

/** Parses an IPv6 literal into its 16 address bytes, including IPv4-mapped tails. */
function parseIPv6(ip: string): Uint8Array | null {
  let text = ip.trim();
  if (text.startsWith("[") && text.endsWith("]")) {
    text = text.slice(1, -1);
  }

  const zoneIndex = text.indexOf("%");
  if (zoneIndex !== -1) text = text.slice(0, zoneIndex);
  if (!text.includes(":")) return null;

  // Rewrite an embedded IPv4 tail (`::ffff:127.0.0.1`) as two hex groups.
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const ipv4 = parseIPv4(tail);
    if (ipv4 === null) return null;
    const high = (ipv4 >>> 16).toString(16);
    const low = (ipv4 & 0xffff).toString(16);
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const parseGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const groups: number[] = [];
    for (const group of part.split(":")) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
      groups.push(parseInt(group, 16));
    }
    return groups;
  };

  const halves = text.split("::");
  if (halves.length > 2) return null;

  let groups: number[];
  if (halves.length === 2) {
    const left = parseGroups(halves[0] ?? "");
    const right = parseGroups(halves[1] ?? "");
    if (!left || !right) return null;

    const missing = 8 - left.length - right.length;
    if (missing < 1) return null;
    groups = [...left, ...new Array<number>(missing).fill(0), ...right];
  } else {
    const parsed = parseGroups(text);
    if (!parsed) return null;
    groups = parsed;
  }

  if (groups.length !== 8) return null;

  const bytes = new Uint8Array(16);
  groups.forEach((group, index) => {
    bytes[index * 2] = (group >>> 8) & 0xff;
    bytes[index * 2 + 1] = group & 0xff;
  });
  return bytes;
}

/** Normalizes bracketed and IPv4-mapped forms before matching rules. */
function normalizeClientIp(ip: string): string {
  let text = ip.trim();
  if (text.startsWith("[") && text.endsWith("]")) {
    text = text.slice(1, -1);
  }

  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(text);
  if (mapped && parseIPv4(mapped[1]!) !== null) return mapped[1]!;
  return text;
}

function sameAddress(left: Uint8Array, right: Uint8Array): boolean {
  return left.every((byte, index) => byte === right[index]);
}

function matchesPrefix(value: Uint8Array, network: Uint8Array, bits: number): boolean {
  const fullBytes = Math.floor(bits / 8);
  for (let index = 0; index < fullBytes; index++) {
    if (value[index] !== network[index]) return false;
  }

  const remaining = bits % 8;
  if (remaining === 0) return true;
  const mask = (0xff << (8 - remaining)) & 0xff;
  return (value[fullBytes]! & mask) === (network[fullBytes]! & mask);
}

export class IpMatcher {
  private readonly rules: IpRule[] = [];

  constructor(ipList: string[]) {
    this.compileRules(ipList);
  }

  /** Evaluates whether an IPv4 or IPv6 address matches any configured rule. */
  public test(clientIp: string): boolean {
    const cleanIp = normalizeClientIp(clientIp.split(",")[0]?.trim() ?? "");
    const value = parseIPv4(cleanIp);
    return this.rules.some((rule) => rule(cleanIp, value));
  }

  private compileRules(ipList: string[]): void {
    for (const rule of ipList) {
      const cleanRule = normalizeClientIp(rule);
      const slash = cleanRule.lastIndexOf("/");

      if (slash !== -1) {
        this.rules.push(this.compileCidr(cleanRule, slash));
      } else if (cleanRule.includes("*")) {
        this.rules.push(this.compileWildcard(cleanRule));
      } else {
        const expected = parseIPv4(cleanRule);
        if (expected !== null) {
          this.rules.push((_ip, value) => value === expected);
          continue;
        }

        const expectedV6 = parseIPv6(cleanRule);
        if (expectedV6 === null) {
          throw new RangeError(`Invalid IP rule: ${rule}`);
        }
        this.rules.push((ip) => {
          const candidate = parseIPv6(ip);
          return candidate !== null && sameAddress(candidate, expectedV6);
        });
      }
    }
  }

  private compileCidr(cidr: string, slash: number): IpRule {
    const host = cidr.slice(0, slash);
    const prefix = cidr.slice(slash + 1);
    const network = parseIPv4(host);

    if (network !== null) {
      if (!/^(0|[1-9]\d?)$/.test(prefix)) {
        throw new RangeError(`Invalid CIDR rule: ${cidr}`);
      }

      const bits = Number(prefix);
      if (bits > 32) throw new RangeError(`Invalid CIDR rule: ${cidr}`);

      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      const target = (network & mask) >>> 0;
      return (_ip, value) =>
        value !== null && ((value & mask) >>> 0) === target;
    }

    const networkV6 = parseIPv6(host);
    if (networkV6 === null) throw new RangeError(`Invalid CIDR rule: ${cidr}`);
    if (!/^(0|[1-9]\d{0,2})$/.test(prefix)) {
      throw new RangeError(`Invalid CIDR rule: ${cidr}`);
    }

    const bits = Number(prefix);
    if (bits > 128) throw new RangeError(`Invalid CIDR rule: ${cidr}`);

    return (ip) => {
      const candidate = parseIPv6(ip);
      return candidate !== null && matchesPrefix(candidate, networkV6, bits);
    };
  }

  private compileWildcard(wildcard: string): IpRule {
    const expected = wildcard.split(".");
    if (
      expected.length !== 4 ||
      expected.some((part) => part !== "*" && parseIPv4(`0.0.0.${part}`) === null)
    ) {
      throw new RangeError(`Invalid IPv4 wildcard rule: ${wildcard}`);
    }

    return (ip, value) =>
      value !== null &&
      ip.split(".").every((octet, index) => {
        const expectedOctet = expected[index];
        return expectedOctet === "*" || octet === expectedOctet;
      });
  }
}

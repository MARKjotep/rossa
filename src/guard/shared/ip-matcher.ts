export type IpOptions = {
  whitelist?: string[];
  blacklist?: string[];
};

type IpRule = (ip: string, value: number) => boolean;

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

export class IpMatcher {
  private readonly rules: IpRule[] = [];

  constructor(ipList: string[]) {
    this.compileRules(ipList);
  }

  /** Evaluates whether an IPv4 address matches any configured rule. */
  public test(clientIp: string): boolean {
    const cleanIp = clientIp.split(",")[0]?.trim() ?? "";
    const value = parseIPv4(cleanIp);
    if (value === null) return false;
    return this.rules.some((rule) => rule(cleanIp, value));
  }

  private compileRules(ipList: string[]): void {
    for (const rule of ipList) {
      const cleanRule = rule.trim();
      if (cleanRule.includes("/")) {
        this.rules.push(this.compileCidr(cleanRule));
      } else if (cleanRule.includes("*")) {
        this.rules.push(this.compileWildcard(cleanRule));
      } else {
        const expected = parseIPv4(cleanRule);
        if (expected === null) throw new RangeError(`Invalid IPv4 rule: ${rule}`);
        this.rules.push((_ip, value) => value === expected);
      }
    }
  }

  private compileCidr(cidr: string): IpRule {
    const match = cidr.match(/^([^/]+)\/(0|[1-9]\d?)$/);
    if (!match) throw new RangeError(`Invalid IPv4 CIDR rule: ${cidr}`);

    const network = parseIPv4(match[1]!);
    const bits = Number(match[2]);
    if (network === null || bits > 32) {
      throw new RangeError(`Invalid IPv4 CIDR rule: ${cidr}`);
    }

    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    const target = (network & mask) >>> 0;
    return (_ip, value) => ((value & mask) >>> 0) === target;
  }

  private compileWildcard(wildcard: string): IpRule {
    const expected = wildcard.split(".");
    if (
      expected.length !== 4 ||
      expected.some((part) => part !== "*" && parseIPv4(`0.0.0.${part}`) === null)
    ) {
      throw new RangeError(`Invalid IPv4 wildcard rule: ${wildcard}`);
    }

    return (ip) =>
      ip.split(".").every((octet, index) => {
        const expectedOctet = expected[index];
        return expectedOctet === "*" || octet === expectedOctet;
      });
  }
}

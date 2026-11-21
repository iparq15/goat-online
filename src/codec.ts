// JSON con bigint: {"$b":"123"} <-> 123n.

export function encode(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? { $b: v.toString() } : v));
}

export function decode<T = unknown>(text: string): T {
  return JSON.parse(text, (_k, v) => (v && typeof v === 'object' && typeof v.$b === 'string' && Object.keys(v).length === 1 ? BigInt(v.$b) : v)) as T;
}

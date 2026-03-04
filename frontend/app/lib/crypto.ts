export function deriveRootSeedKeyFromPassword(password: string): Uint8Array {
  const encoded = new TextEncoder().encode(password);
  const seed = new Uint8Array(32);
  seed.set(encoded.slice(0, 32));
  return seed;
}

export function objectToUint8Array(obj: any): Uint8Array {
  if (obj instanceof Uint8Array) return obj;
  if (Array.isArray(obj)) return new Uint8Array(obj);
  const keys = Object.keys(obj)
    .map((k) => parseInt(k))
    .sort((a, b) => a - b);
  return new Uint8Array(keys.map((k) => obj[k]));
}

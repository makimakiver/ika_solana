export function deriveRootSeedKeyFromSignature(signature: string): Uint8Array {
  const encoded = new TextEncoder().encode(signature);
  const seed = new Uint8Array(32);
  seed.set(encoded.slice(0, 32));
  return seed;
}

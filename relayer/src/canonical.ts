import { createHash } from 'crypto';

export interface HyperlaneMessage {
  originChainId: string;
  destChainId: string;
  nonce: number;
  senderModule: string;
  recipientModule: string;
  body: Uint8Array;
  valsetId: number;
}

export interface ValsetSigner {
  operator: string;
  attestationPubkey: Uint8Array;
  power: number;
}

/**
 * Compute the canonical digest for a HyperlaneMessage
 * Must match the Go implementation exactly
 */
export function computeMessageDigest(msg: HyperlaneMessage): Uint8Array {
  const data: Uint8Array[] = [];

  // OriginChainID (string)
  data.push(encodeStringWithLength(msg.originChainId));

  // DestChainID (string)
  data.push(encodeStringWithLength(msg.destChainId));

  // Nonce (uint64, big-endian 8 bytes)
  const nonceBytes = new Uint8Array(8);
  const nonceView = new DataView(nonceBytes.buffer);
  nonceView.setBigUint64(0, BigInt(msg.nonce), false); // big-endian
  data.push(encodeWithLength(nonceBytes));

  // SenderModule (string)
  data.push(encodeStringWithLength(msg.senderModule));

  // RecipientModule (string)
  data.push(encodeStringWithLength(msg.recipientModule));

  // Body (raw bytes)
  data.push(encodeWithLength(msg.body));

  // ValsetID (uint64, big-endian 8 bytes)
  const valsetBytes = new Uint8Array(8);
  const valsetView = new DataView(valsetBytes.buffer);
  valsetView.setBigUint64(0, BigInt(msg.valsetId), false); // big-endian
  data.push(encodeWithLength(valsetBytes));

  // Concatenate all data
  const totalLength = data.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of data) {
    result.set(arr, offset);
    offset += arr.length;
  }

  // SHA256 hash
  const hash = createHash('sha256');
  hash.update(result);
  return new Uint8Array(hash.digest());
}

/**
 * Compute the canonical hash for a validator set
 */
export function computeValsetHash(signers: ValsetSigner[]): Uint8Array {
  // Sort signers by operator address bytes in ascending order
  const sortedSigners = [...signers].sort((a, b) => {
    const addrA = getAddressBytes(a.operator);
    const addrB = getAddressBytes(b.operator);
    return Buffer.compare(Buffer.from(addrA), Buffer.from(addrB));
  });

  const data: Uint8Array[] = [];
  for (const signer of sortedSigners) {
    // operator | attestationPubKey | power - each length-prefixed
    const addrBytes = getAddressBytes(signer.operator);
    data.push(encodeWithLength(addrBytes));
    data.push(encodeWithLength(signer.attestationPubkey));

    const powerBytes = new Uint8Array(8);
    const powerView = new DataView(powerBytes.buffer);
    powerView.setBigUint64(0, BigInt(signer.power), false); // big-endian
    data.push(encodeWithLength(powerBytes));
  }

  // Concatenate all data
  const totalLength = data.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of data) {
    result.set(arr, offset);
    offset += arr.length;
  }

  // SHA256 hash
  const hash = createHash('sha256');
  hash.update(result);
  return new Uint8Array(hash.digest());
}

/**
 * Get sorted signer order for bitmap construction
 */
export function getSortedSignerOrder(signers: ValsetSigner[]): ValsetSigner[] {
  return [...signers].sort((a, b) => {
    const addrA = getAddressBytes(a.operator);
    const addrB = getAddressBytes(b.operator);
    return Buffer.compare(Buffer.from(addrA), Buffer.from(addrB));
  });
}

/**
 * Format route string in canonical format
 */
export function formatRoute(origin: string, dest: string, recipientModule: string): string {
  return `${origin}|${dest}|${recipientModule}`;
}

/**
 * Encode bytes with uvarint length prefix
 */
export function encodeWithLength(data: Uint8Array): Uint8Array {
  const length = data.length;
  const lengthBytes = encodeUvarint(length);
  
  const result = new Uint8Array(lengthBytes.length + data.length);
  result.set(lengthBytes, 0);
  result.set(data, lengthBytes.length);
  return result;
}

/**
 * Encode string with uvarint length prefix
 */
export function encodeStringWithLength(s: string): Uint8Array {
  const stringBytes = new TextEncoder().encode(s);
  return encodeWithLength(stringBytes);
}

/**
 * Encode uvarint (same as Go's binary.PutUvarint)
 */
export function encodeUvarint(value: number): Uint8Array {
  const result: number[] = [];
  while (value >= 0x80) {
    result.push((value & 0xFF) | 0x80);
    value >>>= 7;
  }
  result.push(value & 0xFF);
  return new Uint8Array(result);
}

/**
 * Extract raw address bytes from bech32 address
 * This is a simplified implementation - in production you'd use a proper bech32 library
 */
export function getAddressBytes(bech32Addr: string): Uint8Array {
  // For MVP, we'll use a simple approach
  // In production, use a proper bech32 decoder like @cosmjs/encoding
  const parts = bech32Addr.split('1');
  if (parts.length !== 2) {
    throw new Error(`Invalid bech32 address: ${bech32Addr}`);
  }
  
  // This is a simplified conversion - replace with proper bech32 decoding
  const data = parts[1];
  const bytes = new Uint8Array(20); // Standard address length
  
  // Simple hash of the address string for MVP
  const hash = createHash('sha256');
  hash.update(data);
  const hashBytes = hash.digest();
  bytes.set(hashBytes.slice(0, 20));
  
  return bytes;
}

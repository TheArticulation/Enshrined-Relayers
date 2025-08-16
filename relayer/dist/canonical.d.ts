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
export declare function computeMessageDigest(msg: HyperlaneMessage): Uint8Array;
/**
 * Compute the canonical hash for a validator set
 */
export declare function computeValsetHash(signers: ValsetSigner[]): Uint8Array;
/**
 * Get sorted signer order for bitmap construction
 */
export declare function getSortedSignerOrder(signers: ValsetSigner[]): ValsetSigner[];
/**
 * Format route string in canonical format
 */
export declare function formatRoute(origin: string, dest: string, recipientModule: string): string;
/**
 * Encode bytes with uvarint length prefix
 */
export declare function encodeWithLength(data: Uint8Array): Uint8Array;
/**
 * Encode string with uvarint length prefix
 */
export declare function encodeStringWithLength(s: string): Uint8Array;
/**
 * Encode uvarint (same as Go's binary.PutUvarint)
 */
export declare function encodeUvarint(value: number): Uint8Array;
/**
 * Extract raw address bytes from bech32 address
 * This is a simplified implementation - in production you'd use a proper bech32 library
 */
export declare function getAddressBytes(bech32Addr: string): Uint8Array;
//# sourceMappingURL=canonical.d.ts.map
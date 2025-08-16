/**
 * Create a bitmap from a list of validator indices
 */
export declare function createBitmap(validatorIndices: number[], totalValidators: number): Uint8Array;
/**
 * Parse bitmap to extract validator indices
 */
export declare function parseBitmap(bitmap: Uint8Array, totalValidators: number): number[];
/**
 * Check if a validator index is set in the bitmap
 */
export declare function isBitSet(bitmap: Uint8Array, validatorIndex: number): boolean;
/**
 * Set a bit in the bitmap
 */
export declare function setBit(bitmap: Uint8Array, validatorIndex: number): void;
/**
 * Clear a bit in the bitmap
 */
export declare function clearBit(bitmap: Uint8Array, validatorIndex: number): void;
//# sourceMappingURL=bitmap.d.ts.map
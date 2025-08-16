/**
 * Create a bitmap from a list of validator indices
 */
export function createBitmap(validatorIndices: number[], totalValidators: number): Uint8Array {
  const bitmapSize = Math.ceil(totalValidators / 8);
  const bitmap = new Uint8Array(bitmapSize);
  
  for (const idx of validatorIndices) {
    if (idx >= 0 && idx < totalValidators) {
      const byteIdx = Math.floor(idx / 8);
      const bitPos = idx % 8;
      bitmap[byteIdx] |= (1 << bitPos);
    }
  }
  
  return bitmap;
}

/**
 * Parse bitmap to extract validator indices
 */
export function parseBitmap(bitmap: Uint8Array, totalValidators: number): number[] {
  const indices: number[] = [];
  
  for (let byteIdx = 0; byteIdx < bitmap.length; byteIdx++) {
    const bitmapByte = bitmap[byteIdx];
    
    for (let bitPos = 0; bitPos < 8; bitPos++) {
      const validatorIdx = byteIdx * 8 + bitPos;
      
      if (validatorIdx >= totalValidators) {
        break;
      }
      
      if ((bitmapByte & (1 << bitPos)) !== 0) {
        indices.push(validatorIdx);
      }
    }
  }
  
  return indices;
}

/**
 * Check if a validator index is set in the bitmap
 */
export function isBitSet(bitmap: Uint8Array, validatorIndex: number): boolean {
  const byteIdx = Math.floor(validatorIndex / 8);
  const bitPos = validatorIndex % 8;
  
  if (byteIdx >= bitmap.length) {
    return false;
  }
  
  return (bitmap[byteIdx] & (1 << bitPos)) !== 0;
}

/**
 * Set a bit in the bitmap
 */
export function setBit(bitmap: Uint8Array, validatorIndex: number): void {
  const byteIdx = Math.floor(validatorIndex / 8);
  const bitPos = validatorIndex % 8;
  
  if (byteIdx < bitmap.length) {
    bitmap[byteIdx] |= (1 << bitPos);
  }
}

/**
 * Clear a bit in the bitmap
 */
export function clearBit(bitmap: Uint8Array, validatorIndex: number): void {
  const byteIdx = Math.floor(validatorIndex / 8);
  const bitPos = validatorIndex % 8;
  
  if (byteIdx < bitmap.length) {
    bitmap[byteIdx] &= ~(1 << bitPos);
  }
}

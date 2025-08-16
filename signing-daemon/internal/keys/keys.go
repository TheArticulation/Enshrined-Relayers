package keys

import (
	"crypto/ecdsa"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"

	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/crypto/secp256k1"
)

// KeyStore represents a collection of validator keys
type KeyStore struct {
	Keys map[string]string `json:"keys"` // operator address -> private key hex
}

// LoadKeyStore loads a key store from a JSON file
func LoadKeyStore(filename string) (*KeyStore, error) {
	data, err := os.ReadFile(filename)
	if err != nil {
		return nil, fmt.Errorf("failed to read key store file: %w", err)
	}

	var ks KeyStore
	if err := json.Unmarshal(data, &ks); err != nil {
		return nil, fmt.Errorf("failed to unmarshal key store: %w", err)
	}

	return &ks, nil
}

// SaveKeyStore saves a key store to a JSON file
func (ks *KeyStore) SaveKeyStore(filename string) error {
	data, err := json.MarshalIndent(ks, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal key store: %w", err)
	}

	if err := os.WriteFile(filename, data, 0600); err != nil {
		return fmt.Errorf("failed to write key store file: %w", err)
	}

	return nil
}

// GetPrivateKey retrieves a private key for the given operator address
func (ks *KeyStore) GetPrivateKey(operatorAddr string) (*ecdsa.PrivateKey, error) {
	privateKeyHex, exists := ks.Keys[operatorAddr]
	if !exists {
		return nil, fmt.Errorf("private key not found for operator: %s", operatorAddr)
	}

	privateKeyBytes, err := hex.DecodeString(privateKeyHex)
	if err != nil {
		return nil, fmt.Errorf("invalid private key hex: %w", err)
	}

	privateKey, err := crypto.ToECDSA(privateKeyBytes)
	if err != nil {
		return nil, fmt.Errorf("failed to parse private key: %w", err)
	}

	return privateKey, nil
}

// AddKey adds a new private key for an operator
func (ks *KeyStore) AddKey(operatorAddr string, privateKeyHex string) error {
	if ks.Keys == nil {
		ks.Keys = make(map[string]string)
	}

	// Validate the private key
	_, err := hex.DecodeString(privateKeyHex)
	if err != nil {
		return fmt.Errorf("invalid private key hex: %w", err)
	}

	ks.Keys[operatorAddr] = privateKeyHex
	return nil
}

// GenerateKey generates a new secp256k1 private key
func GenerateKey() (*ecdsa.PrivateKey, error) {
	return ecdsa.GenerateKey(secp256k1.S256(), rand.Reader)
}

// PrivateKeyToHex converts a private key to hex string
func PrivateKeyToHex(privateKey *ecdsa.PrivateKey) string {
	return hex.EncodeToString(crypto.FromECDSA(privateKey))
}

// PublicKeyToBytes converts a public key to compressed bytes
func PublicKeyToBytes(publicKey *ecdsa.PublicKey) []byte {
	return crypto.CompressPubkey(publicKey)
}

// SignDigest signs a 32-byte digest with the given private key
func SignDigest(privateKey *ecdsa.PrivateKey, digest []byte) ([]byte, error) {
	if len(digest) != 32 {
		return nil, fmt.Errorf("digest must be exactly 32 bytes, got %d", len(digest))
	}

	// Sign the digest
	signature, err := crypto.Sign(digest, privateKey)
	if err != nil {
		return nil, fmt.Errorf("failed to sign digest: %w", err)
	}

	// The signature is 65 bytes: R (32) + S (32) + V (1)
	// For Ethereum compatibility, we keep the recovery ID
	return signature, nil
}

// VerifySignature verifies a signature against a digest and public key
func VerifySignature(publicKey *ecdsa.PublicKey, digest, signature []byte) bool {
	if len(signature) == 65 {
		// Remove recovery ID for verification
		signature = signature[:64]
	}

	return crypto.VerifySignature(crypto.FromECDSAPub(publicKey), digest, signature)
}

// CreateSampleKeyStore creates a sample key store with test keys
func CreateSampleKeyStore() *KeyStore {
	ks := &KeyStore{
		Keys: make(map[string]string),
	}

	// Generate some sample keys for testing
	sampleOperators := []string{
		"orgvaloper1abcdefghijklmnopqrstuvwxyz123456789",
		"orgvaloper2bcdefghijklmnopqrstuvwxyz1234567890",
		"orgvaloper3cdefghijklmnopqrstuvwxyz12345678901",
		"orgvaloper4defghijklmnopqrstuvwxyz123456789012",
	}

	for _, operator := range sampleOperators {
		privateKey, err := GenerateKey()
		if err != nil {
			continue
		}
		ks.Keys[operator] = PrivateKeyToHex(privateKey)
	}

	return ks
}

package main

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/enshrined-relayers/signing-daemon/internal/keys"
)

// SignRequest represents a request to sign a digest
type SignRequest struct {
	OperatorBech32 string `json:"operatorBech32"`
	DigestHex      string `json:"digestHex"`
}

// SignResponse represents a response containing a signature
type SignResponse struct {
	Signature string `json:"signature"`
	Error     string `json:"error,omitempty"`
}

// Server represents the signing daemon server
type Server struct {
	keyStore *keys.KeyStore
	port     string
}

// NewServer creates a new signing daemon server
func NewServer(keyStorePath, port string) (*Server, error) {
	// Try to load existing key store, create sample if not found
	keyStore, err := keys.LoadKeyStore(keyStorePath)
	if err != nil {
		if os.IsNotExist(err) {
			log.Printf("Key store not found at %s, creating sample key store", keyStorePath)
			keyStore = keys.CreateSampleKeyStore()
			if err := keyStore.SaveKeyStore(keyStorePath); err != nil {
				return nil, fmt.Errorf("failed to save sample key store: %w", err)
			}
			log.Printf("Sample key store saved to %s", keyStorePath)
		} else {
			return nil, fmt.Errorf("failed to load key store: %w", err)
		}
	}

	return &Server{
		keyStore: keyStore,
		port:     port,
	}, nil
}

// Start starts the HTTP server
func (s *Server) Start() error {
	http.HandleFunc("/sign", s.handleSign)
	http.HandleFunc("/health", s.handleHealth)
	http.HandleFunc("/pubkeys", s.handlePubKeys)

	log.Printf("Starting signing daemon on port %s", s.port)
	log.Printf("Endpoints:")
	log.Printf("  POST /sign - Sign a digest")
	log.Printf("  GET /health - Health check")
	log.Printf("  GET /pubkeys - List public keys")

	return http.ListenAndServe(":"+s.port, nil)
}

// handleSign handles signing requests
func (s *Server) handleSign(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse request
	var req SignRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendErrorResponse(w, http.StatusBadRequest, "Invalid JSON request")
		return
	}

	// Validate inputs
	if req.OperatorBech32 == "" {
		s.sendErrorResponse(w, http.StatusBadRequest, "operatorBech32 is required")
		return
	}

	if req.DigestHex == "" {
		s.sendErrorResponse(w, http.StatusBadRequest, "digestHex is required")
		return
	}

	// Decode digest
	digest, err := hex.DecodeString(req.DigestHex)
	if err != nil {
		s.sendErrorResponse(w, http.StatusBadRequest, "Invalid digestHex format")
		return
	}

	if len(digest) != 32 {
		s.sendErrorResponse(w, http.StatusBadRequest, "digest must be exactly 32 bytes")
		return
	}

	// Get private key
	privateKey, err := s.keyStore.GetPrivateKey(req.OperatorBech32)
	if err != nil {
		s.sendErrorResponse(w, http.StatusNotFound, fmt.Sprintf("Private key not found for operator: %s", req.OperatorBech32))
		return
	}

	// Sign the digest
	signature, err := keys.SignDigest(privateKey, digest)
	if err != nil {
		s.sendErrorResponse(w, http.StatusInternalServerError, fmt.Sprintf("Failed to sign digest: %v", err))
		return
	}

	// Return base64-encoded signature
	response := SignResponse{
		Signature: base64.StdEncoding.EncodeToString(signature),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)

	log.Printf("Signed digest for operator %s", req.OperatorBech32)
}

// handleHealth handles health check requests
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	response := map[string]string{
		"status":  "healthy",
		"service": "signing-daemon",
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// handlePubKeys handles requests to list public keys
func (s *Server) handlePubKeys(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	pubKeys := make(map[string]string)

	for operatorAddr := range s.keyStore.Keys {
		privateKey, err := s.keyStore.GetPrivateKey(operatorAddr)
		if err != nil {
			continue
		}

		pubKeyBytes := keys.PublicKeyToBytes(&privateKey.PublicKey)
		pubKeys[operatorAddr] = hex.EncodeToString(pubKeyBytes)
	}

	response := map[string]interface{}{
		"publicKeys": pubKeys,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// sendErrorResponse sends an error response
func (s *Server) sendErrorResponse(w http.ResponseWriter, statusCode int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)

	response := SignResponse{
		Error: message,
	}

	json.NewEncoder(w).Encode(response)
	log.Printf("Error: %s", message)
}

func main() {
	var (
		keyStorePath = flag.String("keys", "keys.json", "Path to the key store file")
		port         = flag.String("port", "8080", "Port to listen on")
		generateKeys = flag.Bool("generate", false, "Generate sample keys and exit")
	)
	flag.Parse()

	if *generateKeys {
		log.Println("Generating sample key store...")
		keyStore := keys.CreateSampleKeyStore()
		if err := keyStore.SaveKeyStore(*keyStorePath); err != nil {
			log.Fatalf("Failed to save key store: %v", err)
		}
		log.Printf("Sample key store saved to %s", *keyStorePath)

		// Print public keys for reference
		fmt.Println("\nGenerated validator keys:")
		for operatorAddr, privateKeyHex := range keyStore.Keys {
			privateKeyBytes, _ := hex.DecodeString(privateKeyHex)
			privateKey, _ := keys.GenerateKey()
			copy(privateKey.D.Bytes(), privateKeyBytes)
			pubKeyBytes := keys.PublicKeyToBytes(&privateKey.PublicKey)
			fmt.Printf("Operator: %s\n", operatorAddr)
			fmt.Printf("  Private Key: %s\n", privateKeyHex)
			fmt.Printf("  Public Key:  %s\n", hex.EncodeToString(pubKeyBytes))
			fmt.Println()
		}
		return
	}

	// Create and start server
	server, err := NewServer(*keyStorePath, *port)
	if err != nil {
		log.Fatalf("Failed to create server: %v", err)
	}

	if err := server.Start(); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

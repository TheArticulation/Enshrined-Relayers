import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { StargateClient, SigningStargateClient } from '@cosmjs/stargate';
import { Tendermint34Client } from '@cosmjs/tendermint-rpc';
import { Logger } from 'winston';
import axios from 'axios';
import { 
  HyperlaneMessage, 
  computeMessageDigest, 
  ValsetSigner, 
  getSortedSignerOrder,
  formatRoute 
} from './canonical';
import { createBitmap } from './bitmap';

export interface RelayerConfig {
  orgchainRpc: string;
  dstchainRpc: string;
  orgchainRest: string;
  dstchainRest: string;
  orgchainId: string;
  dstchainId: string;
  relayerMnemonic: string;
  validatorSigners: string[];
  pollInterval: number;
  retryInterval: number;
  logger: Logger;
}

interface HyperlaneSendEvent {
  route: string;
  nonce: string;
  valset_id: string;
  digest_hex: string;
  recipient_module: string;
}

interface ValsetSnapshot {
  id: string;
  height: string;
  hash: Uint8Array;
  signers: ValsetSigner[];
}

interface ValidatorSignature {
  operatorAddress: string;
  signature: string;
}

export class Relayer {
  private config: RelayerConfig;
  private logger: Logger;
  private running = false;
  private pollTimer?: NodeJS.Timeout;
  
  private orgchainClient?: StargateClient;
  private dstchainClient?: SigningStargateClient;
  private processedMessages = new Set<string>();

  constructor(config: RelayerConfig) {
    this.config = config;
    this.logger = config.logger.child({ component: 'Relayer' });
  }

  async start(): Promise<void> {
    this.logger.info('Starting relayer...');
    
    // Connect to chains
    await this.connectToChains();
    
    this.running = true;
    
    // Start polling for messages
    this.startPolling();
    
    this.logger.info('Relayer started successfully');
  }

  async stop(): Promise<void> {
    this.logger.info('Stopping relayer...');
    
    this.running = false;
    
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
    }
    
    // Disconnect from chains
    if (this.orgchainClient) {
      this.orgchainClient.disconnect();
    }
    
    this.logger.info('Relayer stopped');
  }

  private async connectToChains(): Promise<void> {
    this.logger.info('Connecting to chains...');
    
    // Connect to orgchain (read-only)
    const orgchainTendermint = await Tendermint34Client.connect(this.config.orgchainRpc);
    this.orgchainClient = await StargateClient.create(orgchainTendermint);
    
    // Connect to dstchain (signing client)
    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(
      this.config.relayerMnemonic,
      { prefix: 'dst' }
    );
    
    this.dstchainClient = await SigningStargateClient.connectWithSigner(
      this.config.dstchainRpc,
      wallet
    );
    
    this.logger.info('Connected to both chains');
  }

  private startPolling(): void {
    const poll = async () => {
      if (!this.running) return;
      
      try {
        await this.processNewMessages();
      } catch (error) {
        this.logger.error('Error processing messages:', error);
      }
      
      if (this.running) {
        this.pollTimer = setTimeout(poll, this.config.pollInterval);
      }
    };
    
    poll();
  }

  private async processNewMessages(): Promise<void> {
    try {
      // Query for hyperlane_send events
      const events = await this.queryHyperlaneSendEvents();
      
      for (const event of events) {
        const messageKey = `${event.route}:${event.nonce}`;
        
        if (this.processedMessages.has(messageKey)) {
          continue; // Already processed
        }
        
        this.logger.info(`Processing message: ${messageKey}`);
        
        try {
          await this.processMessage(event);
          this.processedMessages.add(messageKey);
          this.logger.info(`Successfully processed message: ${messageKey}`);
        } catch (error) {
          this.logger.error(`Failed to process message ${messageKey}:`, error);
          // Will retry on next poll
        }
      }
    } catch (error) {
      this.logger.error('Error querying for messages:', error);
    }
  }

  private async queryHyperlaneSendEvents(): Promise<HyperlaneSendEvent[]> {
    // TODO: Implement proper event querying using Tendermint RPC
    // For MVP, we'll use a placeholder that returns empty array
    // In production, you'd query the blockchain for events
    
    this.logger.debug('Querying for hyperlane_send events...');
    
    // Placeholder implementation - return empty for now
    return [];
  }

  private async processMessage(event: HyperlaneSendEvent): Promise<void> {
    this.logger.info(`Processing message for route: ${event.route}, nonce: ${event.nonce}`);
    
    // 1. Parse the route to get destination chain and recipient module
    const [origin, dest, recipientModule] = event.route.split('|');
    
    if (dest !== this.config.dstchainId) {
      this.logger.warn(`Message destination ${dest} does not match our dstchain ${this.config.dstchainId}`);
      return;
    }
    
    // 2. Get the valset snapshot
    const valset = await this.getValsetSnapshot(parseInt(event.valset_id));
    
    // 3. Build the message for signing
    const message: HyperlaneMessage = {
      originChainId: origin,
      destChainId: dest,
      nonce: parseInt(event.nonce),
      senderModule: 'hyperlane', // Assuming hyperlane module sent it
      recipientModule: recipientModule,
      body: new Uint8Array(), // TODO: Get actual body from transaction
      valsetId: parseInt(event.valset_id)
    };
    
    // 4. Compute digest
    const digest = computeMessageDigest(message);
    const digestHex = Buffer.from(digest).toString('hex');
    
    // Verify digest matches event
    if (digestHex !== event.digest_hex) {
      throw new Error(`Digest mismatch: computed ${digestHex}, expected ${event.digest_hex}`);
    }
    
    // 5. Collect signatures from validators
    const signatures = await this.collectSignatures(valset, digest);
    
    // 6. Build proof and submit to destination chain
    await this.submitToDestination(message, signatures, valset);
  }

  private async getValsetSnapshot(valsetId: number): Promise<ValsetSnapshot> {
    this.logger.debug(`Getting valset snapshot: ${valsetId}`);
    
    try {
      const response = await axios.get(
        `${this.config.orgchainRest}/enshrined-relayers/orgchain/hyperlane/v1/valset/${valsetId}`
      );
      
      const valset = response.data.valset;
      
      return {
        id: valset.id,
        height: valset.height,
        hash: new Uint8Array(Buffer.from(valset.hash, 'base64')),
        signers: valset.signers.map((s: any) => ({
          operator: s.operator,
          attestationPubkey: new Uint8Array(Buffer.from(s.attestation_pubkey, 'base64')),
          power: parseInt(s.power)
        }))
      };
    } catch (error) {
      throw new Error(`Failed to get valset snapshot ${valsetId}: ${error}`);
    }
  }

  private async collectSignatures(valset: ValsetSnapshot, digest: Uint8Array): Promise<ValidatorSignature[]> {
    this.logger.debug('Collecting signatures from validators...');
    
    const digestHex = Buffer.from(digest).toString('hex');
    const signatures: ValidatorSignature[] = [];
    
    // Request signatures from all configured signing daemons
    const signaturePromises = this.config.validatorSigners.map(async (signerUrl) => {
      try {
        // Find corresponding validator in valset
        // For MVP, we'll try to get signatures from all validators in the set
        for (const signer of valset.signers) {
          try {
            const response = await axios.post(`${signerUrl}/sign`, {
              operatorBech32: signer.operator,
              digestHex: digestHex
            }, { timeout: 5000 });
            
            if (response.data.signature) {
              signatures.push({
                operatorAddress: signer.operator,
                signature: response.data.signature
              });
              this.logger.debug(`Got signature from ${signer.operator}`);
              break; // One signature per daemon
            }
          } catch (error) {
            this.logger.debug(`Failed to get signature from ${signer.operator} at ${signerUrl}:`, error);
          }
        }
      } catch (error) {
        this.logger.warn(`Failed to contact signing daemon at ${signerUrl}:`, error);
      }
    });
    
    await Promise.allSettled(signaturePromises);
    
    this.logger.info(`Collected ${signatures.length} signatures`);
    
    if (signatures.length === 0) {
      throw new Error('Failed to collect any signatures');
    }
    
    return signatures;
  }

  private async submitToDestination(
    message: HyperlaneMessage, 
    signatures: ValidatorSignature[], 
    valset: ValsetSnapshot
  ): Promise<void> {
    this.logger.info('Submitting message to destination chain...');
    
    // Build bitmap and signatures array
    const sortedSigners = getSortedSignerOrder(valset.signers);
    const validatorIndices: number[] = [];
    const signatureBytes: Uint8Array[] = [];
    
    for (const sig of signatures) {
      const index = sortedSigners.findIndex(s => s.operator === sig.operatorAddress);
      if (index >= 0) {
        validatorIndices.push(index);
        signatureBytes.push(new Uint8Array(Buffer.from(sig.signature, 'base64')));
      }
    }
    
    const bitmap = createBitmap(validatorIndices, sortedSigners.length);
    
    // Build the deliver message
    const deliverMsg = {
      typeUrl: '/dstchain.hyperlane.v1.MsgDeliverMessage',
      value: {
        relayer: await this.getRelayerAddress(),
        message: {
          originChainId: message.originChainId,
          destChainId: message.destChainId,
          nonce: message.nonce.toString(),
          senderModule: message.senderModule,
          recipientModule: message.recipientModule,
          body: message.body,
          valsetId: message.valsetId.toString()
        },
        proof: {
          bitmap: bitmap,
          signatures: signatureBytes
        }
      }
    };
    
    // TODO: Sign and broadcast the transaction
    this.logger.info('Message delivery prepared (TODO: implement transaction signing)');
    
    // For MVP, we'll log the message instead of actually submitting
    this.logger.info('Deliver message payload:', {
      route: formatRoute(message.originChainId, message.destChainId, message.recipientModule),
      nonce: message.nonce,
      valsetId: message.valsetId,
      signatureCount: signatures.length
    });
  }

  private async getRelayerAddress(): Promise<string> {
    if (!this.dstchainClient) {
      throw new Error('Dstchain client not connected');
    }
    
    // Get the first account from the signing client
    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(
      this.config.relayerMnemonic,
      { prefix: 'dst' }
    );
    const accounts = await wallet.getAccounts();
    
    if (accounts.length === 0) {
      throw new Error('No relayer accounts available');
    }
    
    return accounts[0].address;
  }
}

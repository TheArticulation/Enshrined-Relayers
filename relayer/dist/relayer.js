"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Relayer = void 0;
const proto_signing_1 = require("@cosmjs/proto-signing");
const stargate_1 = require("@cosmjs/stargate");
const tendermint_rpc_1 = require("@cosmjs/tendermint-rpc");
const axios_1 = __importDefault(require("axios"));
const canonical_1 = require("./canonical");
const bitmap_1 = require("./bitmap");
class Relayer {
    constructor(config) {
        this.running = false;
        this.processedMessages = new Set();
        this.config = config;
        this.logger = config.logger.child({ component: 'Relayer' });
    }
    async start() {
        this.logger.info('Starting relayer...');
        // Connect to chains
        await this.connectToChains();
        this.running = true;
        // Start polling for messages
        this.startPolling();
        this.logger.info('Relayer started successfully');
    }
    async stop() {
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
    async connectToChains() {
        this.logger.info('Connecting to chains...');
        // Connect to orgchain (read-only)
        const orgchainTendermint = await tendermint_rpc_1.Tendermint34Client.connect(this.config.orgchainRpc);
        this.orgchainClient = await stargate_1.StargateClient.create(orgchainTendermint);
        // Connect to dstchain (signing client)
        const wallet = await proto_signing_1.DirectSecp256k1HdWallet.fromMnemonic(this.config.relayerMnemonic, { prefix: 'dst' });
        this.dstchainClient = await stargate_1.SigningStargateClient.connectWithSigner(this.config.dstchainRpc, wallet);
        this.logger.info('Connected to both chains');
    }
    startPolling() {
        const poll = async () => {
            if (!this.running)
                return;
            try {
                await this.processNewMessages();
            }
            catch (error) {
                this.logger.error('Error processing messages:', error);
            }
            if (this.running) {
                this.pollTimer = setTimeout(poll, this.config.pollInterval);
            }
        };
        poll();
    }
    async processNewMessages() {
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
                }
                catch (error) {
                    this.logger.error(`Failed to process message ${messageKey}:`, error);
                    // Will retry on next poll
                }
            }
        }
        catch (error) {
            this.logger.error('Error querying for messages:', error);
        }
    }
    async queryHyperlaneSendEvents() {
        // TODO: Implement proper event querying using Tendermint RPC
        // For MVP, we'll use a placeholder that returns empty array
        // In production, you'd query the blockchain for events
        this.logger.debug('Querying for hyperlane_send events...');
        // Placeholder implementation - return empty for now
        return [];
    }
    async processMessage(event) {
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
        const message = {
            originChainId: origin,
            destChainId: dest,
            nonce: parseInt(event.nonce),
            senderModule: 'hyperlane', // Assuming hyperlane module sent it
            recipientModule: recipientModule,
            body: new Uint8Array(), // TODO: Get actual body from transaction
            valsetId: parseInt(event.valset_id)
        };
        // 4. Compute digest
        const digest = (0, canonical_1.computeMessageDigest)(message);
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
    async getValsetSnapshot(valsetId) {
        this.logger.debug(`Getting valset snapshot: ${valsetId}`);
        try {
            const response = await axios_1.default.get(`${this.config.orgchainRest}/enshrined-relayers/orgchain/hyperlane/v1/valset/${valsetId}`);
            const valset = response.data.valset;
            return {
                id: valset.id,
                height: valset.height,
                hash: new Uint8Array(Buffer.from(valset.hash, 'base64')),
                signers: valset.signers.map((s) => ({
                    operator: s.operator,
                    attestationPubkey: new Uint8Array(Buffer.from(s.attestation_pubkey, 'base64')),
                    power: parseInt(s.power)
                }))
            };
        }
        catch (error) {
            throw new Error(`Failed to get valset snapshot ${valsetId}: ${error}`);
        }
    }
    async collectSignatures(valset, digest) {
        this.logger.debug('Collecting signatures from validators...');
        const digestHex = Buffer.from(digest).toString('hex');
        const signatures = [];
        // Request signatures from all configured signing daemons
        const signaturePromises = this.config.validatorSigners.map(async (signerUrl) => {
            try {
                // Find corresponding validator in valset
                // For MVP, we'll try to get signatures from all validators in the set
                for (const signer of valset.signers) {
                    try {
                        const response = await axios_1.default.post(`${signerUrl}/sign`, {
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
                    }
                    catch (error) {
                        this.logger.debug(`Failed to get signature from ${signer.operator} at ${signerUrl}:`, error);
                    }
                }
            }
            catch (error) {
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
    async submitToDestination(message, signatures, valset) {
        this.logger.info('Submitting message to destination chain...');
        // Build bitmap and signatures array
        const sortedSigners = (0, canonical_1.getSortedSignerOrder)(valset.signers);
        const validatorIndices = [];
        const signatureBytes = [];
        for (const sig of signatures) {
            const index = sortedSigners.findIndex(s => s.operator === sig.operatorAddress);
            if (index >= 0) {
                validatorIndices.push(index);
                signatureBytes.push(new Uint8Array(Buffer.from(sig.signature, 'base64')));
            }
        }
        const bitmap = (0, bitmap_1.createBitmap)(validatorIndices, sortedSigners.length);
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
            route: (0, canonical_1.formatRoute)(message.originChainId, message.destChainId, message.recipientModule),
            nonce: message.nonce,
            valsetId: message.valsetId,
            signatureCount: signatures.length
        });
    }
    async getRelayerAddress() {
        if (!this.dstchainClient) {
            throw new Error('Dstchain client not connected');
        }
        // Get the first account from the signing client
        const wallet = await proto_signing_1.DirectSecp256k1HdWallet.fromMnemonic(this.config.relayerMnemonic, { prefix: 'dst' });
        const accounts = await wallet.getAccounts();
        if (accounts.length === 0) {
            throw new Error('No relayer accounts available');
        }
        return accounts[0].address;
    }
}
exports.Relayer = Relayer;
//# sourceMappingURL=relayer.js.map
import { Logger } from 'winston';
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
export declare class Relayer {
    private config;
    private logger;
    private running;
    private pollTimer?;
    private orgchainClient?;
    private dstchainClient?;
    private processedMessages;
    constructor(config: RelayerConfig);
    start(): Promise<void>;
    stop(): Promise<void>;
    private connectToChains;
    private startPolling;
    private processNewMessages;
    private queryHyperlaneSendEvents;
    private processMessage;
    private getValsetSnapshot;
    private collectSignatures;
    private submitToDestination;
    private getRelayerAddress;
}
//# sourceMappingURL=relayer.d.ts.map
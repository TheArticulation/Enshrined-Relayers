"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const winston_1 = require("winston");
const relayer_1 = require("./relayer");
// Create logger
const logger = (0, winston_1.createLogger)({
    level: process.env.LOG_LEVEL || 'info',
    format: winston_1.format.combine(winston_1.format.timestamp(), winston_1.format.errors({ stack: true }), winston_1.format.json()),
    defaultMeta: { service: 'hyperlane-relayer' },
    transports: [
        new winston_1.transports.Console({
            format: winston_1.format.combine(winston_1.format.colorize(), winston_1.format.simple())
        })
    ]
});
async function main() {
    try {
        logger.info('Starting Hyperlane Relayer...');
        // Validate required environment variables
        const requiredEnvVars = [
            'ORGCHAIN_RPC',
            'DSTCHAIN_RPC',
            'ORGCHAIN_REST',
            'DSTCHAIN_REST',
            'ORGCHAIN_ID',
            'DSTCHAIN_ID',
            'RELAYER_MNEMONIC',
            'VALIDATOR_SIGNERS'
        ];
        for (const envVar of requiredEnvVars) {
            if (!process.env[envVar]) {
                throw new Error(`Missing required environment variable: ${envVar}`);
            }
        }
        // Create and start relayer
        const relayer = new relayer_1.Relayer({
            orgchainRpc: process.env.ORGCHAIN_RPC,
            dstchainRpc: process.env.DSTCHAIN_RPC,
            orgchainRest: process.env.ORGCHAIN_REST,
            dstchainRest: process.env.DSTCHAIN_REST,
            orgchainId: process.env.ORGCHAIN_ID,
            dstchainId: process.env.DSTCHAIN_ID,
            relayerMnemonic: process.env.RELAYER_MNEMONIC,
            validatorSigners: process.env.VALIDATOR_SIGNERS.split(','),
            pollInterval: parseInt(process.env.POLL_INTERVAL || '5000'),
            retryInterval: parseInt(process.env.RETRY_INTERVAL || '10000'),
            logger
        });
        await relayer.start();
        // Handle graceful shutdown
        process.on('SIGINT', async () => {
            logger.info('Received SIGINT, shutting down gracefully...');
            await relayer.stop();
            process.exit(0);
        });
        process.on('SIGTERM', async () => {
            logger.info('Received SIGTERM, shutting down gracefully...');
            await relayer.stop();
            process.exit(0);
        });
    }
    catch (error) {
        logger.error('Failed to start relayer:', error);
        process.exit(1);
    }
}
// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});
if (require.main === module) {
    main();
}
//# sourceMappingURL=index.js.map
import 'dotenv/config';
import { createLogger, format, transports } from 'winston';
import { Relayer } from './relayer';

// Create logger
const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.json()
  ),
  defaultMeta: { service: 'hyperlane-relayer' },
  transports: [
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.simple()
      )
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
    const relayer = new Relayer({
      orgchainRpc: process.env.ORGCHAIN_RPC!,
      dstchainRpc: process.env.DSTCHAIN_RPC!,
      orgchainRest: process.env.ORGCHAIN_REST!,
      dstchainRest: process.env.DSTCHAIN_REST!,
      orgchainId: process.env.ORGCHAIN_ID!,
      dstchainId: process.env.DSTCHAIN_ID!,
      relayerMnemonic: process.env.RELAYER_MNEMONIC!,
      validatorSigners: process.env.VALIDATOR_SIGNERS!.split(','),
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
    
  } catch (error) {
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

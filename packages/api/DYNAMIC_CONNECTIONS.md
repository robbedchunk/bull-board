# Dynamic Redis Connections for Bull Board

This enhancement adds support for dynamic Redis connections to the @bull-board/api package, allowing you to manage multiple Redis instances and add queues dynamically via API endpoints while maintaining full backward compatibility.

## Features

- **Master Redis Connection**: One primary Redis instance for storing encrypted connection configurations
- **Dynamic Connections**: Add/remove Redis connections on the fly via API endpoints  
- **Encrypted Storage**: All connection configurations are encrypted using AES-256-GCM
- **Queue Management**: Add queues to specific connections dynamically
- **Health Monitoring**: Check connection status and health
- **Backward Compatibility**: All existing functionality remains unchanged

## Usage

### Basic Setup (Backward Compatible)

```javascript
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';

// Works exactly as before - no changes needed
const serverAdapter = new ExpressAdapter();
const { addQueue, removeQueue } = createBullBoard({
  queues: [new BullMQAdapter(someQueue)],
  serverAdapter,
});
```

### Enhanced Setup with Dynamic Connections

```javascript
import { createBullBoard } from '@bull-board/api';
import { ExpressAdapter } from '@bull-board/express';
import Redis from 'ioredis';

// Create master Redis connection for storing configs
const masterRedis = new Redis('redis://localhost:6379');

const serverAdapter = new ExpressAdapter();
const { 
  addQueue, 
  removeQueue, 
  connectionManager,
  addQueueFromConnection 
} = createBullBoard({
  queues: [], // Start with no static queues
  serverAdapter,
  options: {
    encryptionKey: 'your-32-character-encryption-key-here',
    masterRedis: masterRedis,
    uiConfig: {
      boardTitle: 'Dynamic Bull Dashboard'
    }
  }
});

app.use('/admin/queues', serverAdapter.getRouter());
```

## API Endpoints

### Connection Management

#### Create Connection
```http
POST /api/connections
Content-Type: application/json

{
  "name": "Production Redis",
  "host": "redis.production.com",
  "port": 6379,
  "password": "secret",
  "db": 0
}
```

#### List Connections
```http
GET /api/connections
```

#### Get Connection Health
```http
GET /api/connections/{id}/health
```

#### Delete Connection
```http
DELETE /api/connections/{id}
```

### Queue Management

#### Add Queue to Connection
```http
POST /api/connections/{id}/queues
Content-Type: application/json

{
  "queueName": "email-processing",
  "queueType": "bullmq",
  "options": {
    "defaultJobOptions": {
      "removeOnComplete": 10
    }
  }
}
```

#### List Connection Queues
```http
GET /api/connections/{id}/queues
```

#### Remove Queue from Connection
```http
DELETE /api/connections/{id}/queues/{queueName}
```

## Programmatic Usage

```javascript
// Add a connection
const connectionConfig = {
  name: 'Staging Redis',
  host: 'staging-redis.company.com',
  port: 6379,
  password: 'staging-password'
};

// Store encrypted config
await connectionManager.storeConnection(connectionConfig);

// Create queue from connection
const queueAdapter = await addQueueFromConnection(
  connectionConfig.id,
  'user-notifications',
  'bullmq',
  { defaultJobOptions: { attempts: 3 } }
);

// Test connection health
const isHealthy = await connectionManager.testConnection(connectionConfig);
```

## Security Features

- **AES-256-GCM Encryption**: All connection configurations are encrypted before storage
- **Key Derivation**: Uses SHA-256 to derive consistent encryption keys
- **Secure Storage**: Sensitive data never stored in plaintext
- **Authentication Tags**: Ensures data integrity and authenticity

## Configuration Options

### Connection Configuration
```typescript
interface RedisConnectionConfig {
  id: string;              // Auto-generated UUID
  name: string;            // Human-readable name
  host: string;            // Redis host
  port: number;            // Redis port
  password?: string;       // Redis password
  db?: number;             // Redis database number
  username?: string;       // Redis username (Redis 6+)
  family?: 4 | 6;         // IP family
  keyPrefix?: string;      // Key prefix
  connectTimeout?: number; // Connection timeout
  lazyConnect?: boolean;   // Lazy connection
  tls?: any;              // TLS options
}
```

### Board Options
```typescript
interface DynamicBoardOptions extends BoardOptions {
  encryptionKey?: string;  // 32+ character encryption key
  masterRedis?: Redis;     // Master Redis instance
}
```

## Error Handling

The implementation includes comprehensive error handling:

- Invalid connection configurations
- Encryption/decryption failures  
- Connection timeouts
- Redis connection errors
- Missing dependencies

## Migration Guide

### From Static to Dynamic

1. **No immediate changes required** - existing code continues to work
2. **Add encryption key and master Redis** when ready to use dynamic features
3. **Gradually migrate** static queues to dynamic connections
4. **Use new API endpoints** to manage connections dynamically

### Backward Compatibility

- All existing `createBullBoard` calls work unchanged
- Original return interface preserved
- No breaking changes to existing APIs
- Static queues can coexist with dynamic queues

## Examples

See the `/examples` directory for complete implementation examples including:
- Express.js integration
- Connection management UI
- Error handling patterns
- Production deployment examples
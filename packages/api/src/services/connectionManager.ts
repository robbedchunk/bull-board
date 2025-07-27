import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { Redis } from 'ioredis';
import { BaseAdapter } from '../queueAdapters/base';
import { RedisConnectionConfig, DetectedQueue } from '../../typings/app';
import { QueueDetector } from './queueDetector';

export interface EncryptedConnectionData {
  iv: string;
  encryptedData: string;
  tag: string;
}

export const MASTER_CONNECTION_ID = '__master__';

export class ConnectionManager {
  private masterRedis: Redis;
  private connections: Map<string, Redis> = new Map();
  private encryptionKey: Buffer;
  private readonly STORAGE_PREFIX = 'bull-board:connections:';
  private readonly HASH_INDEX_KEY = 'bull-board:connection-hashes';
  private readonly MASTER_REGISTRY_KEY = 'bull-board:all-queues';

  constructor(masterRedis: Redis, encryptionKey: string) {
    this.masterRedis = masterRedis;
    this.encryptionKey = this.deriveKey(encryptionKey);
  }

  /**
   * Create connection configuration for master Redis
   */
  private createMasterConnectionConfig(): RedisConnectionConfig {
    const masterRedisOptions = this.masterRedis.options;
    
    return {
      id: MASTER_CONNECTION_ID,
      name: 'Master Redis',
      host: masterRedisOptions.host || 'localhost',
      port: masterRedisOptions.port || 6379,
      password: masterRedisOptions.password,
      db: masterRedisOptions.db || 0,
      username: masterRedisOptions.username,
      family: (masterRedisOptions.family as 4 | 6) || 4,
      keyPrefix: masterRedisOptions.keyPrefix,
      connectTimeout: masterRedisOptions.connectTimeout || 10000,
      lazyConnect: masterRedisOptions.lazyConnect !== false,
      tls: masterRedisOptions.tls,
      queueNames: [],
      hash: this.generateConnectionHash({
        host: masterRedisOptions.host || 'localhost',
        port: masterRedisOptions.port || 6379,
        db: masterRedisOptions.db || 0,
        username: masterRedisOptions.username,
        keyPrefix: masterRedisOptions.keyPrefix,
      })
    };
  }

  /**
   * Initialize master Redis as a dynamic connection
   */
  async initializeMasterConnection(): Promise<void> {
    try {
      const masterConfig = this.createMasterConnectionConfig();
      // Store master connection config (without encryption check since it uses the same Redis)
      const configJson = JSON.stringify(masterConfig);
      const encrypted = this.encrypt(configJson);
      
      await this.masterRedis.set(
        `${this.STORAGE_PREFIX}${MASTER_CONNECTION_ID}`,
        JSON.stringify(encrypted)
      );

      // Index the hash for duplicate detection  
      await this.masterRedis.hset(this.HASH_INDEX_KEY, masterConfig.hash, MASTER_CONNECTION_ID);
      
      // Add master Redis to connections map
      this.connections.set(MASTER_CONNECTION_ID, this.masterRedis);
    } catch (error) {
      console.warn('Failed to initialize master connection:', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Derive a 32-byte key from the provided encryption key
   */
  private deriveKey(key: string): Buffer {
    return createHash('sha256').update(key).digest();
  }

  /**
   * Generate a hash for connection configuration to prevent duplicates
   * Hash includes: host, port, db, username, keyPrefix
   */
  public generateConnectionHash(config: Omit<RedisConnectionConfig, 'id' | 'hash' | 'name'>): string {
    const hashData = {
      host: config.host,
      port: config.port,
      db: config.db || 0,
      username: config.username || '',
      keyPrefix: config.keyPrefix || '',
    };
    
    return createHash('sha256')
      .update(JSON.stringify(hashData))
      .digest('hex');
  }

  /**
   * Encrypt connection configuration data
   */
  private encrypt(data: string): EncryptedConnectionData {
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const tag = cipher.getAuthTag();

    return {
      iv: iv.toString('hex'),
      encryptedData: encrypted,
      tag: tag.toString('hex')
    };
  }

  /**
   * Decrypt connection configuration data
   */
  private decrypt(encryptedData: EncryptedConnectionData): string {
    const iv = Buffer.from(encryptedData.iv, 'hex');
    const tag = Buffer.from(encryptedData.tag, 'hex');
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    
    decipher.setAuthTag(tag);
    
    let decrypted = decipher.update(encryptedData.encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  /**
   * Check if a connection with the same configuration already exists
   */
  async findExistingConnection(config: Omit<RedisConnectionConfig, 'id' | 'hash' | 'name'>): Promise<RedisConnectionConfig | null> {
    const hash = this.generateConnectionHash(config);
    const existingId = await this.masterRedis.hget(this.HASH_INDEX_KEY, hash);
    
    if (existingId) {
      return await this.getConnection(existingId);
    }
    
    return null;
  }

  /**
   * Store encrypted connection configuration in master Redis
   */
  async storeConnection(config: RedisConnectionConfig): Promise<void> {
    // Check for existing connection
    const existing = await this.findExistingConnection(config);
    if (existing) {
      throw new Error(`Connection already exists with name "${existing.name}" (ID: ${existing.id})`);
    }

    // Ensure queueNames array exists
    if (!config.queueNames) {
      config.queueNames = [];
    }

    const configJson = JSON.stringify(config);
    const encrypted = this.encrypt(configJson);
    
    // Store the encrypted config
    await this.masterRedis.set(
      `${this.STORAGE_PREFIX}${config.id}`,
      JSON.stringify(encrypted)
    );

    // Index the hash for duplicate detection
    await this.masterRedis.hset(this.HASH_INDEX_KEY, config.hash, config.id);
  }

  /**
   * Update existing connection configuration without duplicate checking
   */
  private async updateConnection(config: RedisConnectionConfig): Promise<void> {
    // Ensure queueNames array exists
    if (!config.queueNames) {
      config.queueNames = [];
    }

    const configJson = JSON.stringify(config);
    const encrypted = this.encrypt(configJson);
    
    // Store the encrypted config
    await this.masterRedis.set(
      `${this.STORAGE_PREFIX}${config.id}`,
      JSON.stringify(encrypted)
    );
  }

  /**
   * Retrieve and decrypt connection configuration from master Redis
   */
  async getConnection(id: string): Promise<RedisConnectionConfig | null> {
    const encryptedString = await this.masterRedis.get(`${this.STORAGE_PREFIX}${id}`);
    
    if (!encryptedString) {
      return null;
    }

    try {
      const encrypted: EncryptedConnectionData = JSON.parse(encryptedString);
      const decryptedJson = this.decrypt(encrypted);
      return JSON.parse(decryptedJson) as RedisConnectionConfig;
    } catch (error) {
      throw new Error(`Failed to decrypt connection config for ${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * List all stored connection IDs
   */
  async listConnections(): Promise<string[]> {
    const keys = await this.masterRedis.keys(`${this.STORAGE_PREFIX}*`);
    return keys.map(key => key.replace(this.STORAGE_PREFIX, ''));
  }

  /**
   * Remove stored connection configuration
   */
  async removeConnection(id: string): Promise<boolean> {
    // Protect master connection from deletion
    if (id === MASTER_CONNECTION_ID) {
      throw new Error('Master connection cannot be deleted as it is required for system operation');
    }

    // Get the connection config to remove hash index
    const config = await this.getConnection(id);
    
    // Close active connection if exists
    const activeConnection = this.connections.get(id);
    if (activeConnection) {
      await activeConnection.quit();
      this.connections.delete(id);
    }

    // Remove from storage
    const result = await this.masterRedis.del(`${this.STORAGE_PREFIX}${id}`);
    
    // Remove from hash index if config exists
    if (config) {
      await this.masterRedis.hdel(this.HASH_INDEX_KEY, config.hash);
    }
    
    // Note: Queue mappings are automatically cleaned up when connection config is deleted
    // since they're stored within the connection configuration
    
    return result > 0;
  }

  /**
   * Create and cache a Redis connection from configuration
   */
  async createConnection(config: RedisConnectionConfig): Promise<Redis> {
    // Check if connection already exists
    if (this.connections.has(config.id)) {
      return this.connections.get(config.id)!;
    }

    // Special handling for master Redis connection
    if (config.id === MASTER_CONNECTION_ID) {
      this.connections.set(MASTER_CONNECTION_ID, this.masterRedis);
      return this.masterRedis;
    }

    const redis = new Redis({
      host: config.host,
      port: config.port,
      password: config.password,
      db: config.db || 0,
      username: config.username,
      family: config.family || 4,
      keyPrefix: config.keyPrefix,
      connectTimeout: config.connectTimeout || 10000,
      lazyConnect: config.lazyConnect !== false,
      tls: config.tls,
      maxRetriesPerRequest: null,
    });

    // Test connection
    await redis.ping();
    
    this.connections.set(config.id, redis);
    return redis;
  }

  /**
   * Get active Redis connection by ID
   */
  getActiveConnection(id: string): Redis | null {
    return this.connections.get(id) || null;
  }

  /**
   * Add queue to connection mapping
   */
  async addQueueToConnection(connectionId: string, queueName: string): Promise<void> {
    const config = await this.getConnection(connectionId);
    if (!config) {
      throw new Error(`Connection ${connectionId} not found`);
    }

    if (!config.queueNames) {
      config.queueNames = [];
    }

    // Add queue name if not already present
    if (!config.queueNames.includes(queueName)) {
      config.queueNames.push(queueName);
      await this.updateConnection(config);
    }
  }

  /**
   * Remove queue from connection mapping
   */
  async removeQueueFromConnection(connectionId: string, queueName: string): Promise<void> {
    const config = await this.getConnection(connectionId);
    if (!config) {
      return; // Connection doesn't exist, nothing to remove
    }

    if (config.queueNames) {
      const index = config.queueNames.indexOf(queueName);
      if (index > -1) {
        config.queueNames.splice(index, 1);
        await this.updateConnection(config);
      }
    }
  }

  /**
   * Get all queue names for a specific connection
   */
  async getQueuesForConnection(connectionId: string): Promise<string[]> {
    const config = await this.getConnection(connectionId);
    return config?.queueNames || [];
  }

  /**
   * Get connection ID that owns a specific queue
   */
  async getConnectionForQueue(queueName: string): Promise<string | null> {
    const connections = await this.getAllConnections();
    
    for (const connection of connections) {
      if (connection.queueNames && connection.queueNames.includes(queueName)) {
        return connection.id;
      }
    }
    
    return null;
  }

  /**
   * Add queue to master registry with composite key to handle name overlaps
   */
  async addQueueToMasterRegistry(queueName: string, connectionId: string, queueType: 'bull' | 'bullmq' = 'bullmq', options: any = {}): Promise<void> {
    const compositeKey = `${connectionId}:${queueName}`;
    const queueData = {
      connectionId,
      queueType,
      lastSeen: Date.now(),
      options
    };
    await this.masterRedis.hset(this.MASTER_REGISTRY_KEY, compositeKey, JSON.stringify(queueData));
  }

  /**
   * Remove queue from master registry
   */
  async removeQueueFromMasterRegistry(queueName: string, connectionId: string): Promise<void> {
    const compositeKey = `${connectionId}:${queueName}`;
    await this.masterRedis.hdel(this.MASTER_REGISTRY_KEY, compositeKey);
  }

  /**
   * Get all queues from master registry
   */
  async getAllQueuesFromMasterRegistry(): Promise<Record<string, string>> {
    return await this.masterRedis.hgetall(this.MASTER_REGISTRY_KEY);
  }

  /**
   * Get queues for a specific connection from master registry
   */
  async getQueuesForConnectionFromRegistry(connectionId: string): Promise<string[]> {
    const allQueues = await this.getAllQueuesFromMasterRegistry();
    const prefix = `${connectionId}:`;
    
    return Object.keys(allQueues)
      .filter(key => key.startsWith(prefix))
      .map(key => key.substring(prefix.length));
  }

  /**
   * Load and recreate all queues from master registry on startup
   */
  async loadQueuesFromMasterRegistry(): Promise<Map<string, BaseAdapter>> {
    const reconstructedQueues = new Map<string, BaseAdapter>();
    
    console.log('🔄 Starting queue reconstruction from master registry...');
    
    try {
      const allQueues = await this.getAllQueuesFromMasterRegistry();
      console.log(`📋 Found ${Object.keys(allQueues).length} queue entries in master registry:`, Object.keys(allQueues));
      
      for (const [compositeKey, storedValue] of Object.entries(allQueues)) {
        console.log(`🔍 Processing registry entry: ${compositeKey} -> data: ${storedValue}`);
        
        try {
          // Parse composite key: "connectionId:queueName"
          const colonIndex = compositeKey.indexOf(':');
          if (colonIndex === -1) {
            console.warn(`⚠️  Invalid composite key format: ${compositeKey} (missing colon separator)`);
            continue;
          }
          
          const queueName = compositeKey.substring(colonIndex + 1);
          
          // Parse stored queue data (backward compatibility with old format)
          let queueData: any;
          try {
            queueData = JSON.parse(storedValue);
            console.log(`📤 Attempting to recreate queue: "${queueName}" with type: ${queueData.queueType} on connection: ${queueData.connectionId}`);
          } catch (parseError) {
            // Backward compatibility: treat as old format (just connectionId)
            queueData = {
              connectionId: storedValue,
              queueType: 'bullmq', // Default assumption
              options: {}
            };
            console.log(`📤 Legacy format detected. Attempting to recreate queue: "${queueName}" with default type: bullmq on connection: ${storedValue}`);
          }
          
          // Check if connection exists before attempting recreation
          const config = await this.getConnection(queueData.connectionId);
          if (!config) {
            console.warn(`⚠️  Connection ${queueData.connectionId} not found, skipping queue ${queueName}`);
            continue;
          }
          
          // Recreate queue adapter with stored type and options
          const adapter = await this.createQueueAdapter(
            queueData.connectionId, 
            queueName, 
            queueData.queueType || 'bullmq',
            queueData.options || {}
          );
          reconstructedQueues.set(adapter.getName(), adapter);
          console.log(`✅ Successfully recreated queue: "${adapter.getName()}" from registry`);
        } catch (error) {
          console.error(`❌ Failed to recreate queue from registry: ${compositeKey}`, {
            error: error instanceof Error ? error.message : String(error),
            storedValue,
            queueName: compositeKey.includes(':') ? compositeKey.substring(compositeKey.indexOf(':') + 1) : 'unknown'
          });
        }
      }
      
      console.log(`🎉 Registry reconstruction complete. Successfully loaded ${reconstructedQueues.size} queues`);
    } catch (error) {
      console.error('💥 Critical failure loading queues from master registry:', error instanceof Error ? error.message : String(error));
    }
    
    return reconstructedQueues;
  }

  /**
   * Create queue adapter from connection configuration
   */
  async createQueueAdapter(
    connectionId: string, 
    queueName: string, 
    queueType: 'bull' | 'bullmq' = 'bullmq',
    options: any = {}
  ): Promise<BaseAdapter> {
    const config = await this.getConnection(connectionId);
    if (!config) {
      throw new Error(`Connection configuration not found for ${connectionId}`);
    }

    const redis = await this.createConnection(config);
    let adapter: BaseAdapter;

    if (queueType === 'bullmq') {
      // Import bullmq and adapter dynamically to avoid dependency issues
      const { Queue } = require('bullmq');
      const { BullMQAdapter } = require('../queueAdapters/bullMQ');
      const queue = new Queue(queueName, { 
        connection: redis,
        ...options 
      });
      adapter = new BullMQAdapter(queue);
    } else {
      // Import bull and adapter dynamically to avoid dependency issues  
      const Queue = require('bull');
      const { BullAdapter } = require('../queueAdapters/bull');
      const queue = new Queue(queueName, { 
        redis: {
          host: config.host,
          port: config.port,
          password: config.password,
          db: config.db || 0,
          username: config.username,
          family: config.family || 4,
        },
        ...options 
      });
      adapter = new BullAdapter(queue);
    }

    // Register the queue-to-connection mapping
    const adapterName = adapter.getName();
    await this.addQueueToConnection(connectionId, adapterName);
    
    // Also register in master registry with type and options
    await this.addQueueToMasterRegistry(queueName, connectionId, queueType, options);

    return adapter;
  }

  /**
   * Detect queues on a specific connection
   */
  async detectQueuesForConnection(connectionId: string): Promise<DetectedQueue[]> {
    const config = await this.getConnection(connectionId);
    if (!config) {
      throw new Error(`Connection ${connectionId} not found`);
    }

    const redis = await this.createConnection(config);
    const detector = new QueueDetector(redis);
    
    try {
      const detectedQueues = await detector.detectAllQueues();
      
      // Add connection info to detected queues
      return detectedQueues.map(queue => ({
        ...queue,
        connectionId: config.id,
        connectionName: config.name
      }));
    } catch (error) {
      console.error(`Failed to detect queues for connection ${config.name}:`, error);
      return [];
    }
  }

  /**
   * Detect queues on all connections
   */
  async detectQueuesOnAllConnections(): Promise<DetectedQueue[]> {
    const allDetectedQueues: DetectedQueue[] = [];

    // Detect queues on all dynamic connections (including master)
    try {
      const connections = await this.getAllConnections();
      
      for (const connection of connections) {
        try {
          const connectionQueues = await this.detectQueuesForConnection(connection.id);
          allDetectedQueues.push(...connectionQueues);
        } catch (error) {
          console.warn(`Failed to detect queues for connection ${connection.name}:`, error);
        }
      }
    } catch (error) {
      console.warn('Failed to get connections for queue detection:', error);
    }

    return allDetectedQueues;
  }

  /**
   * Get all stored connection configurations (decrypted)
   */
  async getAllConnections(): Promise<RedisConnectionConfig[]> {
    const connectionIds = await this.listConnections();
    const connections: RedisConnectionConfig[] = [];

    for (const id of connectionIds) {
      const config = await this.getConnection(id);
      if (config) {
        connections.push(config);
      }
    }

    return connections;
  }

  /**
   * Close all active connections
   */
  async closeAllConnections(): Promise<void> {
    const promises = Array.from(this.connections.values()).map(redis => redis.quit());
    await Promise.all(promises);
    this.connections.clear();
  }

  /**
   * Health check for a specific connection
   */
  async testConnection(config: RedisConnectionConfig): Promise<boolean> {
    try {
      const redis = new Redis({
        host: config.host,
        port: config.port,
        password: config.password,
        db: config.db || 0,
        username: config.username,
        family: config.family || 4,
        connectTimeout: 5000,
        lazyConnect: true,
      });

      await redis.ping();
      await redis.quit();
      return true;
    } catch (error) {
      return false;
    }
  }
}
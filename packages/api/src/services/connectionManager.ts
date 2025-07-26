import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { Redis } from 'ioredis';
import { BullMQAdapter } from '../queueAdapters/bullMQ';
import { BullAdapter } from '../queueAdapters/bull';
import { BaseAdapter } from '../queueAdapters/base';

export interface RedisConnectionConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  password?: string;
  db?: number;
  username?: string;
  family?: 4 | 6;
  keyPrefix?: string;
  connectTimeout?: number;
  lazyConnect?: boolean;
  tls?: any;
}

export interface EncryptedConnectionData {
  iv: string;
  encryptedData: string;
  tag: string;
}

export class ConnectionManager {
  private masterRedis: Redis;
  private connections: Map<string, Redis> = new Map();
  private encryptionKey: Buffer;
  private readonly STORAGE_PREFIX = 'bull-board:connections:';

  constructor(masterRedis: Redis, encryptionKey: string) {
    this.masterRedis = masterRedis;
    this.encryptionKey = this.deriveKey(encryptionKey);
  }

  /**
   * Derive a 32-byte key from the provided encryption key
   */
  private deriveKey(key: string): Buffer {
    return createHash('sha256').update(key).digest();
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
   * Store encrypted connection configuration in master Redis
   */
  async storeConnection(config: RedisConnectionConfig): Promise<void> {
    const configJson = JSON.stringify(config);
    const encrypted = this.encrypt(configJson);
    
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
    // Close active connection if exists
    const activeConnection = this.connections.get(id);
    if (activeConnection) {
      await activeConnection.quit();
      this.connections.delete(id);
    }

    // Remove from storage
    const result = await this.masterRedis.del(`${this.STORAGE_PREFIX}${id}`);
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

    if (queueType === 'bullmq') {
      // Import bullmq dynamically to avoid dependency issues
      const { Queue } = require('bullmq');
      const queue = new Queue(queueName, { 
        connection: redis,
        ...options 
      });
      return new BullMQAdapter(queue);
    } else {
      // Import bull dynamically to avoid dependency issues  
      const Queue = require('bull');
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
      return new BullAdapter(queue);
    }
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
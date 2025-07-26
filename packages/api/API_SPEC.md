# Bull Board API Specification

## Overview

The Bull Board API provides endpoints for managing Bull and BullMQ queues, including dynamic Redis connections with encrypted configuration storage.

**Base URL:** `/api`

## Authentication

No authentication required for queue operations. Dynamic connection management requires a master Redis instance and encryption key configured during initialization.

## Standard Queue Management Endpoints

### Redis Statistics

#### Get Redis Statistics
```
GET /api/redis/stats
```

**Response:**
```json
{
  "version": "7.0.0",
  "mode": "standalone",
  "port": 6379,
  "os": "Linux",
  "uptime": 12345,
  "memory": {
    "total": 1073741824,
    "used": 536870912,
    "fragmentationRatio": 1.2,
    "peak": 671088640
  },
  "clients": {
    "connected": 5,
    "blocked": 0
  }
}
```

### Queue Operations

#### List All Queues
```
GET /api/queues
```

**Query Parameters:**
- `activeQueue` (string): Name of the active queue to get detailed info
- `status` (string): Filter jobs by status (`latest`, `active`, `waiting`, `completed`, `failed`, `delayed`, `paused`)
- `page` (number): Page number for pagination (default: 1)
- `jobsPerPage` (number): Number of jobs per page (default: 10)

**Response:**
```json
{
  "queues": [
    {
      "name": "email-queue",
      "displayName": "Email Processing Queue",
      "description": "Handles email sending operations",
      "connectionName": "Master Redis",
      "connectionId": "__master__",
      "statuses": ["waiting", "active", "completed", "failed"],
      "counts": {
        "waiting": 15,
        "active": 2,
        "completed": 1250,
        "failed": 3
      },
      "jobs": [...],
      "pagination": {
        "pageCount": 5,
        "range": {
          "start": 0,
          "end": 9
        }
      },
      "readOnlyMode": false,
      "allowRetries": true,
      "allowCompletedRetries": false,
      "isPaused": false,
      "type": "bullmq",
      "delimiter": ":"
    },
    {
      "name": "notification-queue",
      "displayName": "Push Notifications",
      "description": "Handles push notification delivery",
      "connectionName": "Production Redis",
      "connectionId": "660e8400-e29b-41d4-a716-446655440001",
      "statuses": ["waiting", "active", "completed", "failed"],
      "counts": {
        "waiting": 8,
        "active": 1,
        "completed": 542,
        "failed": 1
      },
      "jobs": [...],
      "pagination": {
        "pageCount": 3,
        "range": {
          "start": 0,
          "end": 9
        }
      },
      "readOnlyMode": false,
      "allowRetries": true,
      "allowCompletedRetries": false,
      "isPaused": false,
      "type": "bullmq",
      "delimiter": ":"
    }
  ]
}
```

**Note:** Queue connection information is provided through two fields:
- `connectionName`: Human-readable name of the Redis connection
- `connectionId`: Unique identifier for the connection (UUID)

All queues must belong to a dynamic connection. Static/unassigned queues are not supported.

#### Pause All Queues
```
PUT /api/queues/pause
```

**Response:**
```json
{
  "message": "All queues paused successfully"
}
```

#### Resume All Queues
```
PUT /api/queues/resume
```

**Response:**
```json
{
  "message": "All queues resumed successfully"
}
```

### Individual Queue Operations

#### Pause Queue
```
PUT /api/queues/{queueName}/pause
```

#### Resume Queue
```
PUT /api/queues/{queueName}/resume
```

#### Empty Queue
```
PUT /api/queues/{queueName}/empty
```

#### Add Job to Queue
```
POST /api/queues/{queueName}/add
```

**Request Body:**
```json
{
  "name": "send-welcome-email",
  "data": {
    "userId": 12345,
    "email": "user@example.com",
    "template": "welcome"
  },
  "options": {
    "delay": 5000,
    "attempts": 3
  }
}
```

#### Retry All Failed Jobs
```
PUT /api/queues/{queueName}/retry/{queueStatus}
```

**Path Parameters:**
- `queueStatus`: `failed` or `completed`

#### Promote All Delayed Jobs
```
PUT /api/queues/{queueName}/promote
```

#### Clean Jobs by Status
```
PUT /api/queues/{queueName}/clean/{queueStatus}
```

**Path Parameters:**
- `queueStatus`: `completed`, `wait`, `active`, `delayed`, or `failed`

**Query Parameters:**
- `graceTime` (number): Grace time in milliseconds (default: 0)

### Individual Job Operations

#### Get Job Details
```
GET /api/queues/{queueName}/{jobId}
```

**Response:**
```json
{
  "id": "123",
  "name": "send-email",
  "timestamp": 1643723400000,
  "processedOn": 1643723405000,
  "processedBy": "worker-1",
  "finishedOn": 1643723407000,
  "progress": 100,
  "attempts": 1,
  "failedReason": null,
  "stacktrace": [],
  "delay": 0,
  "opts": {
    "attempts": 3,
    "delay": 0
  },
  "data": {
    "email": "user@example.com"
  },
  "returnValue": "Email sent successfully",
  "isFailed": false
}
```

#### Get Job Logs
```
GET /api/queues/{queueName}/{jobId}/logs
```

**Query Parameters:**
- `start` (number): Start index for logs
- `end` (number): End index for logs

**Response:**
```json
{
  "logs": [
    "2024-01-01T10:00:00.000Z - Processing started",
    "2024-01-01T10:00:05.000Z - Email sent successfully"
  ]
}
```

#### Retry Job
```
PUT /api/queues/{queueName}/{jobId}/retry/{queueStatus}
```

#### Clean Job
```
PUT /api/queues/{queueName}/{jobId}/clean
```

#### Promote Job
```
PUT /api/queues/{queueName}/{jobId}/promote
```

#### Update Job Data
```
PATCH /api/queues/{queueName}/{jobId}/update-data
```

**Request Body:**
```json
{
  "data": {
    "email": "newemail@example.com",
    "priority": "high"
  }
}
```

## Dynamic Connection Management Endpoints

### Connection Management

#### Create New Redis Connection
```
POST /api/connections
```

**Request Body:**
```json
{
  "name": "Production Redis",
  "host": "redis.production.com",
  "port": 6379,
  "password": "secret-password",
  "db": 0,
  "username": "redis-user",
  "family": 4,
  "keyPrefix": "bull:",
  "connectTimeout": 10000,
  "lazyConnect": true,
  "tls": {
    "rejectUnauthorized": false
  }
}
```

**Response:**
```json
{
  "message": "Connection created successfully",
  "connection": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Production Redis",
    "host": "redis.production.com",
    "port": 6379,
    "db": 0,
    "username": "redis-user",
    "family": 4,
    "keyPrefix": "bull:",
    "connectTimeout": 10000,
    "lazyConnect": true,
    "tls": {
      "rejectUnauthorized": false
    }
  }
}
```

**Error Response for Duplicate Connection:**
```json
{
  "error": "Connection already exists with name \"Production Redis\" (ID: 550e8400-e29b-41d4-a716-446655440000)",
  "existingConnection": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Production Redis",
    "host": "redis.production.com",
    "port": 6379
  }
}
```

**Note:** Connection deduplication is performed using SHA-256 hashing of connection parameters (host, port, db, username, keyPrefix). Duplicate connections cannot be created.

#### List All Connections
```
GET /api/connections
```

**Response:**
```json
{
  "connections": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Production Redis",
      "host": "redis.production.com",
      "port": 6379,
      "db": 0,
      "username": "redis-user",
      "family": 4,
      "keyPrefix": "bull:",
      "connectTimeout": 10000,
      "lazyConnect": true
    }
  ]
}
```

#### Get Connection Health Status
```
GET /api/connections/{connectionId}/health
```

**Response:**
```json
{
  "health": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Production Redis",
    "status": "connected",
    "lastChecked": 1643723400000,
    "error": null
  }
}
```

#### Delete Connection
```
DELETE /api/connections/{connectionId}
```

**Response:** `204 No Content`

### Queue Management for Specific Connections

#### Add Queue to Connection
```
POST /api/connections/{connectionId}/queues
```

**Request Body:**
```json
{
  "queueName": "user-notifications",
  "queueType": "bullmq",
  "options": {
    "defaultJobOptions": {
      "removeOnComplete": 10,
      "removeOnFail": 5,
      "attempts": 3
    },
    "settings": {
      "stalledInterval": 30000,
      "maxStalledCount": 1
    }
  }
}
```

**Response:**
```json
{
  "message": "Queue added successfully",
  "queueName": "bull:user-notifications",
  "connectionId": "550e8400-e29b-41d4-a716-446655440000",
  "connectionName": "Production Redis"
}
```

#### List Queues for Connection
```
GET /api/connections/{connectionId}/queues
```

**Response:**
```json
{
  "connectionId": "550e8400-e29b-41d4-a716-446655440000",
  "connectionName": "Production Redis",
  "queues": [
    "bull:user-notifications",
    "bull:email-processing"
  ]
}
```

#### Remove Queue from Connection
```
DELETE /api/connections/{connectionId}/queues/{queueName}
```

**Response:** `204 No Content`

### Queue Detection

#### Detect Queues Across All Connections
```
POST /api/queues/detect
```

**Query Parameters:**
- `autoRegister` (boolean): Automatically register detected queues (default: false)

**Response (Discovery Only):**
```json
{
  "success": true,
  "discovered": 2,
  "queues": [
    {
      "name": "email-queue",
      "type": "bullmq",
      "connectionId": "550e8400-e29b-41d4-a716-446655440000",
      "connectionName": "Production Redis"
    },
    {
      "name": "notification-queue",
      "type": "bullmq",
      "connectionId": "master",
      "connectionName": "Master Redis"
    }
  ]
}
```

**Response (With Auto-Registration):**
```json
{
  "success": true,
  "discovered": 2,
  "registered": 1,
  "failed": [
    {
      "queueName": "notification-queue",
      "connectionName": "Master Redis",
      "error": "Master Redis queues require manual configuration"
    }
  ],
  "queues": [
    {
      "name": "email-queue",
      "type": "bullmq",
      "connectionId": "550e8400-e29b-41d4-a716-446655440000",
      "connectionName": "Production Redis"
    },
    {
      "name": "notification-queue",
      "type": "bullmq",
      "connectionId": "master",
      "connectionName": "Master Redis"
    }
  ]
}
```

#### Detect Queues for Specific Connection
```
POST /api/connections/{connectionId}/detect
```

**Query Parameters:**
- `autoRegister` (boolean): Automatically register detected queues (default: false)

**Response:**
```json
{
  "success": true,
  "discovered": 1,
  "queues": [
    {
      "name": "user-queue",
      "type": "bullmq",
      "connectionId": "550e8400-e29b-41d4-a716-446655440000",
      "connectionName": "Production Redis"
    }
  ]
}
```

## Error Responses

All endpoints may return the following error responses:

### 400 Bad Request
```json
{
  "error": "Missing required fields: name, host, port"
}
```

### 404 Not Found
```json
{
  "error": "Connection not found"
}
```

### 500 Internal Server Error
```json
{
  "error": "Failed to connect to Redis with provided configuration"
}
```

## Status Codes

- `200` - Success
- `201` - Created
- `204` - No Content
- `400` - Bad Request
- `404` - Not Found
- `500` - Internal Server Error

## Data Types

### Queue Types
- `bull` - Bull queue (legacy)
- `bullmq` - BullMQ queue (recommended)

### Job Statuses
- `waiting` - Job is waiting to be processed
- `active` - Job is currently being processed
- `completed` - Job completed successfully
- `failed` - Job failed during processing
- `delayed` - Job is delayed and will be processed later
- `paused` - Job is in a paused queue
- `prioritized` - Job has priority (BullMQ only)
- `waiting-children` - Job is waiting for child jobs (BullMQ only)

### Connection Status
- `connected` - Connection is active and healthy
- `disconnected` - Connection is not active
- `error` - Connection has errors

## Features

### Connection Deduplication (v1.1.0+)
- Connections are deduplicated using SHA-256 hashing of key parameters
- Hash includes: host, port, db, username, keyPrefix
- Prevents duplicate connections to the same Redis instance
- O(1) duplicate detection using Redis hash indexing

### Enhanced Queue Listing (v1.2.0+)
- Main queues endpoint (`GET /api/queues`) shows queues from all dynamic connections
- Each queue includes both `connectionName` and `connectionId` fields for connection identification
- `connectionName` provides human-readable connection names
- `connectionId` provides unique identifiers for programmatic operations
- Only dynamic connections are supported - static/unassigned queues are not registered

### Queue-to-Connection Mapping (v1.3.0+)
- **Fixed queue duplication issue** where queues appeared multiple times across connections
- Implemented proper queue-to-connection mapping system using persistent storage
- Each queue appears exactly once with its correct connection name and ID
- Queue mappings are automatically managed when queues are added/removed
- All queues must belong to dynamic connections (including master Redis)
- Queue mappings are stored encrypted alongside connection configurations

### Automatic Queue Detection (v1.4.0+)
- **Scan all connections** for existing Bull and BullMQ queues automatically
- Detect queues across multiple Redis connections simultaneously
- **Support for both queue types**: Detects both Bull (legacy) and BullMQ queues
- **Auto-registration option**: Optionally register detected queues automatically
- **Connection-aware detection**: Shows which connection each detected queue belongs to
- **Focus on new discoveries**: Only returns unregistered queues, not already known ones

### Enhanced Queue Detection (v1.5.0+)
- **Discovery-focused results**: Returns only NEW/unregistered queues for actionable insights
- **Better error reporting**: Detailed failure information when auto-registration fails
- **Cleaner response structure**: Removed confusing `alreadyRegistered` field
- **Registration feedback**: Clear separation between discovery and registration results
- **Master Redis handling**: Proper error messages for queues requiring manual configuration

### Master Redis as Dynamic Connection (v1.5.1+)
- **Unified queue handling**: Master Redis is now automatically initialized as a dynamic connection
- **Consistent API behavior**: All queue operations (including master Redis) work through the same dynamic connection system
- **Eliminated duplicate logic**: Removed special case handling for master Redis queue detection
- **Improved user experience**: Users can now add queues to master Redis without issues
- **Connection ID support**: Master Redis queues now include proper `connectionId` in API responses
- **Cleaner architecture**: Master Redis serves only storage/state management, queue operations use dynamic connections

### Dynamic-Only Queue Architecture (v1.5.2+)
- **Removed static queue support**: All queues must now belong to a dynamic connection
- **Eliminated fallback logic**: No more "Default" or "Unassigned" queue categories
- **Simplified codebase**: Removed duplicate handling between static and dynamic queues
- **Consistent API responses**: All queues now have proper `connectionId` and `connectionName`
- **Clear system boundaries**: Only registered dynamic connections can have queues

## Security

- Connection configurations are encrypted using AES-256-GCM before storage
- Sensitive data (passwords, connection strings) are never returned in API responses
- All connection management requires a valid encryption key configured at startup
- Connection hashes are stored for deduplication but do not expose sensitive information
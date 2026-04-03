const { nanoid } = require('nanoid');
const { EventEmitter } = require('events');

const operations = new Map();
const OPERATION_TTL_MS = 6 * 60 * 60 * 1000;
const operationEvents = new EventEmitter();
operationEvents.setMaxListeners(0);

function cleanupOperations() {
  const now = Date.now();
  for (const [id, operation] of operations.entries()) {
    const updatedAt = operation?.updatedAt ? new Date(operation.updatedAt).getTime() : 0;
    if (!updatedAt || now - updatedAt > OPERATION_TTL_MS) {
      operations.delete(id);
    }
  }
}

function cloneOperation(operation) {
  if (!operation) return null;
  return JSON.parse(JSON.stringify(operation));
}

function emitOperationUpdate(operationId) {
  const key = String(operationId || '').trim();
  if (!key) return;
  const operation = operations.get(key);
  if (!operation) return;
  operationEvents.emit(key, cloneOperation(operation));
}

function createBackupOperation({ guildId, action = 'create', label = '', startedBy = '' } = {}) {
  cleanupOperations();
  const now = new Date().toISOString();
  const operation = {
    operationId: nanoid(12),
    guildId: String(guildId || '').trim(),
    action: String(action || '').trim() || 'create',
    label: String(label || '').trim(),
    startedBy: String(startedBy || '').trim(),
    status: 'running',
    progress: 0,
    message: 'Queued',
    error: '',
    result: null,
    startedAt: now,
    updatedAt: now,
    completedAt: null
  };
  operations.set(operation.operationId, operation);
  emitOperationUpdate(operation.operationId);
  return cloneOperation(operation);
}

function updateBackupOperation(operationId, updates = {}) {
  cleanupOperations();
  const key = String(operationId || '').trim();
  if (!key || !operations.has(key)) return null;

  const operation = operations.get(key);
  if (typeof updates.progress === 'number' && Number.isFinite(updates.progress)) {
    operation.progress = Math.max(0, Math.min(100, Math.floor(updates.progress)));
  }
  if (updates.message !== undefined) {
    operation.message = String(updates.message || '').trim();
  }
  if (updates.error !== undefined) {
    operation.error = String(updates.error || '').trim();
  }
  if (updates.result !== undefined) {
    operation.result = updates.result;
  }
  if (updates.status) {
    operation.status = String(updates.status).trim();
  }
  operation.updatedAt = new Date().toISOString();
  operations.set(key, operation);
  emitOperationUpdate(key);
  return cloneOperation(operation);
}

function completeBackupOperation(operationId, { message = '', result = null } = {}) {
  cleanupOperations();
  const key = String(operationId || '').trim();
  if (!key || !operations.has(key)) return null;

  const now = new Date().toISOString();
  const operation = operations.get(key);
  operation.status = 'completed';
  operation.progress = 100;
  if (message) operation.message = String(message).trim();
  operation.error = '';
  operation.result = result;
  operation.updatedAt = now;
  operation.completedAt = now;
  operations.set(key, operation);
  emitOperationUpdate(key);
  return cloneOperation(operation);
}

function failBackupOperation(operationId, { message = '', error = '', result = null } = {}) {
  cleanupOperations();
  const key = String(operationId || '').trim();
  if (!key || !operations.has(key)) return null;

  const now = new Date().toISOString();
  const operation = operations.get(key);
  operation.status = 'failed';
  operation.progress = 100;
  if (message) operation.message = String(message).trim();
  operation.error = String(error || message || '').trim();
  operation.result = result;
  operation.updatedAt = now;
  operation.completedAt = now;
  operations.set(key, operation);
  emitOperationUpdate(key);
  return cloneOperation(operation);
}

function getBackupOperation(operationId) {
  cleanupOperations();
  const key = String(operationId || '').trim();
  if (!key) return null;
  return cloneOperation(operations.get(key) || null);
}

function subscribeBackupOperation(operationId, listener) {
  const key = String(operationId || '').trim();
  if (!key || typeof listener !== 'function') return () => {};
  operationEvents.on(key, listener);
  return () => {
    operationEvents.off(key, listener);
  };
}

module.exports = {
  createBackupOperation,
  updateBackupOperation,
  completeBackupOperation,
  failBackupOperation,
  getBackupOperation,
  subscribeBackupOperation
};

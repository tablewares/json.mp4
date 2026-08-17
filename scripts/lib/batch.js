'use strict';

const fs = require('fs');
const { CliError } = require('./errors');
const state = require('./state');
const { Workspace } = require('./workspace');
const ops = require('./ops');

function fieldsToPairs(fields, label) {
  if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
    throw new CliError('BadArguments', `"${label}" must be an object of {field: value}.`, { received: fields });
  }
  return Object.entries(fields);
}

function runOne(ws, item, index, pendingUnlinks) {
  if (!item || typeof item !== 'object' || !item.type) {
    throw new CliError('BadArguments', `Batch item ${index} is missing a "type".`, { index, item });
  }
  switch (item.type) {
    case 'scene.create':
      return ops.sceneCreate(ws, item.sceneId, item.value);
    case 'scene.delete': {
      const scenePath = ws.getScenePath(item.sceneId);
      const result = ops.sceneDelete(ws, item.sceneId);
      pendingUnlinks.push(scenePath);
      return result;
    }
    case 'scene.setFields':
      return ops.sceneSetFields(ws, item.sceneId, fieldsToPairs(item.fields, `batch[${index}].fields`));
    case 'asset.create':
      return ops.assetCreate(ws, item.sceneId, item.assetId, item.value);
    case 'asset.delete':
      return ops.assetDelete(ws, item.assetId, item.scene);
    case 'asset.setFields':
      return ops.assetSetFields(ws, item.assetId, fieldsToPairs(item.fields, `batch[${index}].fields`), item.scene);
    case 'styles.setFields':
      return ops.stylesSetFields(ws, fieldsToPairs(item.fields, `batch[${index}].fields`), !!item.replace);
    case 'config.set':
      return ops.configSet(ws, item.value);
    default:
      throw new CliError('UnknownBatchCommand', `Batch item ${index} has unknown type "${item.type}".`, {
        index,
        type: item.type,
        allowedTypes: [
          'scene.create',
          'scene.delete',
          'scene.setFields',
          'asset.create',
          'asset.delete',
          'asset.setFields',
          'styles.setFields',
          'config.set',
        ],
      });
  }
}

function runBatch(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new CliError('BadArguments', 'batch requires a non-empty JSON array of commands.', { received: items });
  }

  const projectId = state.requireProjectId();
  const ws = new Workspace(projectId);
  const pendingUnlinks = [];
  const results = [];

  // Validation/application phase: nothing is written to disk yet. Any
  // failure here throws, and since ws.commit() is never reached, the
  // filesystem is left exactly as it was.
  items.forEach((item, index) => {
    try {
      const result = runOne(ws, item, index, pendingUnlinks);
      results.push({ index, type: item.type, ...result });
    } catch (e) {
      if (e instanceof CliError) {
        throw new CliError(e.code, `Batch item ${index} (${item.type}) failed: ${e.message}`, {
          ...e.extra,
          batchIndex: index,
          batchItem: item,
        });
      }
      throw e;
    }
  });

  const filesWritten = ws.commit();
  for (const p of pendingUnlinks) {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  return { projectId, itemCount: items.length, results, filesWritten };
}

module.exports = { runBatch };

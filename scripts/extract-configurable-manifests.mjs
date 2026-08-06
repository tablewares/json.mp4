#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function toDisplayName(value) {
  return value ? String(value) : 'unknown';
}

function schemaProperties(schema) {
  if (!schema || typeof schema !== 'object') return [];
  const properties = schema.properties || {};
  const required = new Set(schema.required || []);
  return Object.entries(properties).map(([name, definition]) => {
    const field = {
      name,
      type: definition?.type || 'unknown',
      required: required.has(name)
    };
    if (definition?.enum) field.enum = definition.enum;
    if (definition?.description) field.description = definition.description;
    return field;
  });
}

function collectConfigurableEntries(resolved) {
  const entries = [];

  for (const scene of resolved.scenes || []) {
    for (const asset of scene.assets || []) {
      const configurable = {};
      const contentSchema = asset.componentManifest?.contentOverrideSchema;
      const styleSchema = asset.componentManifest?.styleOverrideSchema;
      if (contentSchema) configurable.content = schemaProperties(contentSchema);
      if (styleSchema) configurable.style = schemaProperties(styleSchema);
      if (asset.componentManifest?.params) {
        configurable.params = Object.entries(asset.componentManifest.params).map(([name, definition]) => {
          const param = {
            name,
            type: definition?.type || 'unknown'
          };
          if (definition?.description) param.description = definition.description;
          return param;
        });
      }

      entries.push({
        sceneId: scene.id,
        name: asset.id,
        kind: 'asset',
        assetType: asset.assetType,
        componentPath: asset.componentPath,
        agentHint: 'Use content overrides for the asset’s core payload and style overrides for presentation/layout knobs.',
        configurable
      });
    }

    for (const transitionKey of ['transitionIn', 'transitionOut']) {
      const transition = scene[transitionKey];
      if (!transition) continue;

      const configurable = {};
      if (transition.componentManifest?.params) {
        configurable.params = Object.entries(transition.componentManifest.params).map(([name, definition]) => ({
          name,
          type: definition?.type || 'unknown',
          description: definition?.description
        }));
      }

      entries.push({
        sceneId: scene.id,
        name: transition.type || transitionKey,
        kind: 'transition',
        transitionType: transition.type,
        componentPath: transition.componentPath,
        agentHint: 'Use transition params to control how the transition carries state across the cut.',
        configurable
      });
    }
  }

  return entries;
}

function formatProps(props, indent = '      ') {
  if (!props || props.length === 0) return `${indent}(none)\n`;
  return props.map(p => {
    let line = `${indent}- ${p.name} (${p.type}${p.required ? ', required' : ''})`;
    if (p.enum) line += ` [enum: ${p.enum.join(', ')}]`;
    if (p.description) line += ` - ${p.description}`;
    return line;
  }).join('\n') + '\n';
}

function formatConfigurableSummary(entries) {
  if (!entries || entries.length === 0) {
    return 'Generated from: componentManifest\nNo configurable entries found.\n';
  }

  let lines = ['Generated from: componentManifest\n' + '='.repeat(35) + '\n'];

  entries.forEach((entry, idx) => {
    lines.push(`[${idx + 1}] ${entry.kind.toUpperCase()}: ${toDisplayName(entry.name)}`);
    lines.push(`  Scene ID: ${toDisplayName(entry.sceneId)}`);
    if (entry.assetType) lines.push(`  Asset Type: ${entry.assetType}`);
    if (entry.transitionType) lines.push(`  Transition Type: ${entry.transitionType}`);
    if (entry.componentPath) lines.push(`  Component Path: ${entry.componentPath}`);
    if (entry.agentHint) lines.push(`  Agent Hint: ${entry.agentHint}`);
    
    lines.push('  Configurable Settings:');
    
    if (entry.configurable.content) {
      lines.push('    Content Overrides:');
      lines.push(formatProps(entry.configurable.content));
    }
    if (entry.configurable.style) {
      lines.push('    Style Overrides:');
      lines.push(formatProps(entry.configurable.style));
    }
    if (entry.configurable.params) {
      lines.push('    Parameters:');
      lines.push(formatProps(entry.configurable.params));
    }

    lines.push('-'.repeat(35));
  });

  return lines.join('\n');
}

function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('Usage: node scripts/extract-configurable-manifests.mjs <resolved.json>');
    process.exit(1);
  }

  const resolvedPath = path.resolve(process.cwd(), inputPath);
  const raw = fs.readFileSync(resolvedPath, 'utf8');
  const resolved = JSON.parse(raw);
  const entries = collectConfigurableEntries(resolved);
  console.log(formatConfigurableSummary(entries));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { collectConfigurableEntries, formatConfigurableSummary };
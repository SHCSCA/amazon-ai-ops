import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import registry from './package-ui-module-registry.js';

export function packageUiImplementationSources() {
  return registry.runnerSourcePaths.map((filePath) => ({
    path: filePath,
    source: readFileSync(filePath, 'utf8'),
  }));
}

export function packageUiFunctionSource(moduleName, functionName) {
  const filePath = registry.runnerSourcePaths.find((candidate) => path.basename(candidate) === moduleName);
  if (!filePath) throw new Error(`未注册的包界面证据模块：${moduleName}`);
  const source = ts.createSourceFile(filePath, readFileSync(filePath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const matches = [];
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === functionName) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (matches.length !== 1) throw new Error(`职责函数必须唯一：${moduleName}/${functionName}`);
  return matches[0].getText(source);
}

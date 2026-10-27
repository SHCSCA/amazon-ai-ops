import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const directory = path.dirname(fileURLToPath(import.meta.url));
const functionSources = new Map<string, { file: string; text: string }>();

function contractText(text: string): string {
  // 仅归一化同一运行上下文的命名空间，原调用、分支及事务文本原样参与断言。
  return text.replace(/\r\n/g, '\n')
    .replace(/\n  const mainRuntimeContext = getMainRuntimeContext\(\);/g, '')
    .replace(/\bmainRuntimeContext\./g, '');
}

export function mainRuntimeModuleContract(file: string): string {
  if (path.basename(file) !== file) throw new Error('MAIN_CONTRACT_SOURCE_PATH_INVALID');
  return contractText(readFileSync(path.join(directory, file), 'utf8'));
}

export function mainRuntimeModuleContracts(): Array<{ file: string; source: string }> {
  return readdirSync(directory)
    .filter((file) => /^main-.+-runtime\.ts$/.test(file) || ['main-runtime-context.ts', 'main-runtime-contracts.ts', 'index.ts'].includes(file))
    .map((file) => ({ file, source: mainRuntimeModuleContract(file) }));
}

export function mainRuntimeFunctionContract(name: string): string {
  if (functionSources.size === 0) {
    for (const file of readdirSync(directory).filter((entry) => /^main-.+-runtime\.ts$/.test(entry))) {
      const source = ts.createSourceFile(file, readFileSync(path.join(directory, file), 'utf8'), ts.ScriptTarget.Latest, true);
      for (const declaration of source.statements.filter(ts.isFunctionDeclaration)) {
        if (!declaration.name) continue;
        const key = declaration.name.text;
        if (functionSources.has(key)) throw new Error(`MAIN_CONTRACT_FUNCTION_NOT_UNIQUE:${key}`);
        functionSources.set(key, { file, text: declaration.getText(source) });
      }
    }
  }
  const found = functionSources.get(name);
  if (!found) throw new Error(`MAIN_CONTRACT_FUNCTION_MISSING:${name}`);
  return contractText(found.text);
}

export function mainRuntimeVariableContract(name: string): string {
  const file = 'main-runtime-context.ts';
  const source = ts.createSourceFile(file, readFileSync(path.join(directory, file), 'utf8'), ts.ScriptTarget.Latest, true);
  const matches: ts.VariableDeclaration[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (matches.length !== 1) throw new Error(`MAIN_CONTRACT_VARIABLE_NOT_UNIQUE:${name}`);
  return `const ${contractText(matches[0].getText(source))};`;
}

export function mainRuntimeSectionContract(startMarker: string, endMarker: string): string {
  const functionName = startMarker.match(/\bfunction\s+([A-Za-z_$][\w$]*)/)?.[1];
  if (functionName) return mainRuntimeFunctionContract(functionName);
  const variableName = startMarker.match(/^(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/)?.[1];
  if (variableName) return mainRuntimeVariableContract(variableName);
  const matches: string[] = [];
  for (const file of readdirSync(directory).filter((entry) => /^main-.+-runtime\.ts$/.test(entry) || entry === 'main-runtime-context.ts' || entry === 'index.ts')) {
    const source = mainRuntimeModuleContract(file);
    const start = source.indexOf(startMarker);
    if (start < 0) continue;
    const end = source.indexOf(endMarker, start + startMarker.length);
    if (end > start) matches.push(source.slice(start, end));
  }
  if (matches.length !== 1) throw new Error(`MAIN_CONTRACT_SECTION_NOT_UNIQUE:${startMarker}`);
  return matches[0];
}

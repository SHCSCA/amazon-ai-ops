import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { build } = require('../apps/desktop/node_modules/esbuild');

export async function buildNativeListingOperationsFixture() {
  const result = await build({
    stdin: { sourcefile: 'native-listing-operations.tsx', loader: 'tsx', resolveDir: path.resolve('apps/desktop/src/renderer'), contents: `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { StoreScopedListingContentPanel } from './mission-control/workspaces/store-scoped-listing-content-panel';
const root = createRoot(document.getElementById('root'));
window.calls = { list: [], create: [], update: [], remove: [], versions: [], logs: [] };
window.waiting = { list: [], create: [], update: [], remove: [], versions: [] };
window.epoch = 0;
window.rowFor = (id, title = 'listing-' + id) => ({ id:1, storeId:id, storeName:'same-name-store',marketplace:'US',currency:'USD',asin:'B012345678',asinValid:true,title,bullets:['one'],description:'description',aPlus:'',imageCopy:'',backendTerms:'terms',source:'manual',versionLabel:'v1',changeSummary:'original',createdAt:'2026-10-16T00:00:00Z',updatedAt:'2026-10-16T00:00:00Z',revision:'revision-' + id + '-1' });
window.versionsFor = (id, offset = 0, count = 1, title = 'VERSION') => Array.from({length:count}, (_, i) => ({ ...window.rowFor(id,title),id:offset+i+1,listingContentId:1,versionLabel:'v'+(offset+i+1) }));
const defer = (kind, context, input) => { window.calls[kind].push({context:structuredClone(context),input:structuredClone(input)}); return new Promise((resolve,reject)=>window.waiting[kind].push({resolve,reject})); };
window.api = {
  listStoreListingContent: async (context,input) => {
    if(window.deferList) return defer('list',context,input);
    window.calls.list.push({context:structuredClone(context),input:structuredClone(input)});
    return window.deleted ? [] : [window.rowFor(context.storeId)];
  },
  createStoreListingContent:(context,input)=>defer('create',context,input),
  updateStoreListingContent:(context,input)=>defer('update',context,input),
  deleteStoreListingContent:(context,input)=>defer('remove',context,input),
  listStoreListingContentVersions:(context,input)=>defer('versions',context,input),
};
window.electronAPI = { reportRuntimeLog: async value => { window.calls.logs.push(value); } };
window.resolveFixture = (kind,index,result) => window.waiting[kind][index].resolve(result);
window.rejectFixture = (kind,index,message) => window.waiting[kind][index].reject(new Error(message));
window.invokeTwice = selector => { const button=document.querySelector(selector); const props=button[Object.keys(button).find(key=>key.startsWith('__reactProps'))]; props.onClick({}); props.onClick({}); };
window.bind = (id, options = {}) => {
 window.epoch++;
 window.context = {storeId:id,browserProfileId:'profile-'+id,marketplace:'US',currency:'USD',businessTimezone:'America/Los_Angeles',businessDate:'2026-10-16',sessionGeneration:options.sessionGeneration??1};
 window.provider = {phase:options.phase??'ready',authorityKey:id,contextEpoch:window.epoch,authoritativeContext:window.context};
 root.render(<StoreScopedListingContentPanel storeContext={window.context} api={window.api}/>);
};
window.disposeFixture = () => root.unmount();
` },
    plugins: [{ name: 'native-listing-authority', setup(builder) {
      builder.onResolve({ filter: /(?:^|\/)store-context$/ }, () => ({ path: 'authority', namespace: 'listing-fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'listing-fixture' }, () => ({ loader: 'ts', contents: 'export const useOptionalMissionControlStoreContext = () => window.provider;' }));
    } }],
    bundle: true, write: false, format: 'iife', platform: 'browser',
    define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty' },
  });
  return result.outputFiles[0].text;
}

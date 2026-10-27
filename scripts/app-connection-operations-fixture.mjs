import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { build } = require('../apps/desktop/node_modules/esbuild');

export async function buildAppConnectionOperationsFixture() {
  const result = await build({
    stdin: { sourcefile: 'app-connection-operations.tsx', loader: 'tsx', resolveDir: path.resolve('apps/desktop/src/renderer'), contents: `
import React, { useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { normalizeLingxingCollectionStoreName } from '@amazon-ai-ops/shared-types';
import { useStoreConnectionWorkbench } from './app-store-connection-controller';
import { StoreConnectionWorkbenchView } from './app-store-connection-view';
import { useStore } from './app-login-state';
const root = createRoot(document.getElementById('root'));
window.calls = { login: [], logout: [], bind: [], unbind: [], confirm: [], logs: [] };
window.waiting = { login: [], logout: [], bind: [], unbind: [], confirm: [] };
window.epoch = 0;
const defer = (kind,input) => { window.calls[kind].push(structuredClone(input)); return new Promise((resolve,reject)=>window.waiting[kind].push({resolve,reject})); };
window.api = {
  getActiveStoreWorkspaceView: async () => structuredClone(window.store.activeView),
  browserLogin: input => defer('login',input), browserLogout: () => defer('logout',{}),
  confirmBrowserLoginAdsIdentity: input => defer('confirm',input),
  getSavedLoginCredentialStatus: async () => ({ storeId:window.store.activeStore.storeId,username:'operator',passwordAvailable:!window.options.encryptionUnavailable,credentialState:window.options.encryptionUnavailable?'encryption_unavailable':'encrypted_ready',rememberPassword:true,packageUiEvidenceMode:Boolean(window.options.packageUiEvidenceMode) }),
  reportRuntimeLog: async value => { window.calls.logs.push(value); },
};
window.electronAPI = window.api;
window.resolveFixture = (kind,index,result) => window.waiting[kind][index].resolve(result);
window.rejectFixture = (kind,index,message) => window.waiting[kind][index].reject(new Error(message));
window.invokeTwice = selector => { const button=document.querySelector(selector); const props=button[Object.keys(button).find(key=>key.startsWith('__reactProps'))]; props.onClick({}); props.onClick({}); };
function Fixture() {
  const [credentialDraft,setCredentialDraft] = useState(window.seedDraft);
  const [loginAction,setLoginAction] = useState('initial');
  const [loginAttemptPending,setLoginAttemptPending] = useState(false);
  const [loginAttemptError,setLoginAttemptError] = useState(window.options.reset?'当前领星会话身份未经本次凭证验证':'');
  const [loginAttemptSequence,setLoginAttemptSequence] = useState(0);
  useLayoutEffect(() => { setCredentialDraft(window.seedDraft); setLoginAttemptError(window.options.reset?'当前领星会话身份未经本次凭证验证':''); },[window.store.contextEpoch]);
  const view=useStoreConnectionWorkbench({credentialDraft,setCredentialDraft,loginAction,setLoginAction,loginAttemptPending,setLoginAttemptPending,loginAttemptError,setLoginAttemptError,loginAttemptSequence,setLoginAttemptSequence});
  window.view=view;
  return <><output aria-label="夹具店铺">{window.store.activeStore.storeId}</output><StoreConnectionWorkbenchView {...view}/></>;
}
window.bind = (id, options={}) => {
  window.options=options; window.epoch++;
  const context={storeId:id,browserProfileId:'profile-'+id,marketplace:'US',currency:'USD',businessTimezone:'America/Los_Angeles',businessDate:'2026-10-16',sessionGeneration:1};
  const store={...context,displayName:'same-name-store'};
  const erp={id:'erp-'+id,storeId:id,provider:'lingxing',accountLabel:'operator',externalAccountId:'erp-id-'+id,collectionStoreName:'ERP '+id,normalizedCollectionStoreName:normalizeLingxingCollectionStoreName('ERP '+id)};
  const ads={id:'ads-'+id,storeId:id,provider:'amazon_ads',externalAccountId:'ads-id-'+id,normalizedExternalAccountId:'ads-id-'+id,accountLabel:'Ads '+id};
  const connections=options.missing?[]:options.withAds?[erp,ads]:[erp];
  window.store={phase:options.phase??'ready',authorityKey:id+'|profile-'+id+'|1',contextEpoch:window.epoch,authoritativeContext:context,activeStore:store,activeView:{context,store,connections},bindLingxingConnection:(username,shop)=>defer('bind',{username,shop,storeId:id}),unbindStoreConnection:connection=>defer('unbind',connection)};
  window.seedDraft={storeId:id,username:options.blankUsername?'':'operator',password:options.saved?'':'fixture-password',rememberPassword:true,credentialSource:options.saved?'saved':'typed',resetLingxingSessionForEnrollment:false,dirty:true,hydrated:true};
  const session=options.candidate?{erpSessionReady:true,adsSessionReady:false,sessionIdentityVerified:true,credentialPersistence:'saved',adsIdentityCandidate:{confirmationToken:'candidate-'+id,detectedAccountLabel:'Ads '+id}}:options.retry?{erpSessionReady:true,adsSessionReady:false,sessionIdentityVerified:true,credentialPersistence:'saved'}:null;
  useStore.getState().setLoginState(Boolean(session),'same-name-store',session);
  root.render(<Fixture/>);
};
window.sessionFor = id => ({currentStore:'same-name-store',erpSessionReady:true,adsSessionReady:true,sessionIdentityVerified:true,credentialPersistence:'saved'});
window.advanceEpoch = () => { window.store.contextEpoch++; root.render(<Fixture/>); };
window.disposeFixture=()=>root.unmount();
` },
    plugins: [{ name: 'connection-fixture-ports', setup(builder) {
      builder.onResolve({ filter: /(?:^|\/)app-bootstrap$/ }, () => ({ path: 'bootstrap', namespace: 'connection-fixture' }));
      builder.onResolve({ filter: /(?:^|\/)mission-control\/store-context$/ }, () => ({ path: 'authority', namespace: 'connection-fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'connection-fixture' }, args => ({ loader: 'ts', contents: args.path === 'bootstrap'
        ? 'export const appElectronApi=()=>window.api; export const browserPreviewBootstrap={enabled:false};'
        : 'export const useMissionControlStoreContext=()=>window.store;' }));
    } }],
    bundle: true, write: false, format: 'iife', platform: 'browser',
    define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty' },
  });
  return result.outputFiles[0].text;
}

// Node 24 fallback for hosts where tsx cannot read the OS user profile.
import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,nextResolve){try{return nextResolve(specifier,context);}catch(error){if(error.code==='ERR_MODULE_NOT_FOUND'&&/^(\.\/|\.\.\/)/.test(specifier)&&! /\.[a-z0-9]+$/i.test(specifier))return nextResolve(specifier+'.ts',context);throw error;}},load(url,context,nextLoad){return nextLoad(url,url.endsWith('.json')?{...context,importAttributes:{type:'json'}}:context);}});

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBackground, backgroundImage, backgroundPresets, readBackground, saveBackground } from '../frontend/src/lib/backgroundCatalog';
test('background choices and blur ranges reject arbitrary URLs, paths and malformed storage',()=>{
  for(const input of [null,{},'bad',{mode:'preset',presetId:'../../evil'},{mode:'custom',customVersion:'https://evil.test'}])assert.equal(normalizeBackground(input).mode,'none');
  assert.equal(normalizeBackground({mode:'blur',blur:200}).blur,24);assert.equal(normalizeBackground({mode:'blur',blur:-5}).blur,4);
  assert.equal(backgroundImage(normalizeBackground({mode:'preset',presetId:'office'})),'/assets/backgrounds/office.webp');
  assert.equal(backgroundImage({mode:'none',blur:12}),undefined);assert.equal(new Set(backgroundPresets.map(p=>p.id)).size,4);
});
test('an active selection survives prejoin handoff even when persistent browser storage is blocked',()=>{
  const storage=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),browser=Object.getOwnPropertyDescriptor(globalThis,'window');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}}});
  Object.defineProperty(globalThis,'window',{configurable:true,value:{dispatchEvent(){return true;}}});
  try{saveBackground('storage-blocked-fixture',{mode:'blur',blur:18});assert.deepEqual(readBackground('storage-blocked-fixture'),{mode:'blur',blur:18});assert.equal(readBackground('different-account').mode,'none');}
  finally{if(storage)Object.defineProperty(globalThis,'localStorage',storage);else delete(globalThis as any).localStorage;if(browser)Object.defineProperty(globalThis,'window',browser);else delete(globalThis as any).window;}
});

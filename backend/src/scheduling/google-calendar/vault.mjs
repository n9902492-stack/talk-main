import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
export function tokenVault(key){
 if(typeof key!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(key)||Buffer.from(key,'base64url').length!==32)throw new Error('Calendar encryption key is unavailable.');
 const bytes=Buffer.from(key,'base64url');
 return {
  seal(value,purpose){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',bytes,iv);cipher.setAAD(Buffer.from(purpose));const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),encrypted.toString('base64url')].join('.');},
  open(value,purpose){try{if(typeof value!=='string'||value.length>65536)throw 0;const [v,iv,tag,body,...extra]=value.split('.');if(v!=='v1'||extra.length)throw 0;const decipher=createDecipheriv('aes-256-gcm',bytes,Buffer.from(iv,'base64url'));decipher.setAAD(Buffer.from(purpose));decipher.setAuthTag(Buffer.from(tag,'base64url'));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body,'base64url')),decipher.final()]).toString('utf8'));}catch{throw new Error('Calendar credentials could not be opened. Reconnect the calendar.');}}
 };
}

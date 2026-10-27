export type BoardElement = {
  id:string;type:string;version?:number;x:number;y:number;width:number;height:number;rotation:number;
  stroke:string;fill:string;strokeWidth:number;opacity:number;fontSize:number;text:string;points:number[];imageId:string|null;
};
export type BoardEdit = {kind:'create'|'patch'|'delete';id:string;expectedVersion?:number;element?:BoardElement;patch?:Partial<BoardElement>};
export type BoardChange = {id:string;element:BoardElement|null};
export type BoardState = {
  board:{id:string;title:string;revision:number;locked:boolean;defaultEdit:boolean;updatedAt:number;expiresAt:number};
  canEdit:boolean;canManage:boolean;isOwner:boolean;ended:boolean;csrfToken:string;
  members:{id:string;name:string;role:string;override:number|null}[];
  cursors:{accountId:string;name:string;x:number;y:number;color:string}[];
  elements?:BoardElement[];operations?:{revision:number;changes:BoardChange[]}[];
};
export class BoardError extends Error {constructor(message:string,public status:number){super(message);}}
export async function boardRequest(path:string,body?:unknown,csrf?:string,signal?:AbortSignal) {
  const response=await fetch(path,{credentials:'same-origin',cache:'no-store',signal:signal||AbortSignal.timeout(15000),
    ...(body!==undefined?{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf||''},body:JSON.stringify(body)}:{})});
  const value=await response.json();if(!response.ok)throw new BoardError(value.message||'Whiteboard is unavailable.',response.status);return value;
}
export const boardBase=(id:string)=>`/api/auth/meetings/${encodeURIComponent(id)}/whiteboard`;
export const objectId=()=>crypto.randomUUID();
export function applyBoardChanges(elements:BoardElement[],changes:BoardChange[]) {
  const next=new Map(elements.map(element=>[element.id,element]));
  for(const change of changes)if(change.element)next.set(change.id,change.element);else next.delete(change.id);
  return [...next.values()];
}

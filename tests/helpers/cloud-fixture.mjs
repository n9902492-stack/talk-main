import {createCloudWhiteboardProvider} from '../../backend/src/whiteboard-cloud-provider.mjs';
export const cloudSettings={enabled:true,operatorApproved:true,provider:'openai-compatible',model:'synthetic-model',baseUrl:'https://llm.example.com/v1',allowlist:['https://llm.example.com/v1'],apiKey:'synthetic-private-key-not-real',maxInputTokens:16000};
export const diagram={schemaVersion:1,title:'Synthetic plan',layout:'horizontal',nodes:[{id:'start',type:'rectangle',text:'Review'},{id:'end',type:'ellipse',text:'Approve'}],edges:[{from:'start',to:'end',type:'arrow'}]};
export const response=(output=diagram)=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150}});
export function cloudFixture(options={},implementation){
  const calls=[];
  const provider=createCloudWhiteboardProvider({...cloudSettings,...options},async request=>{await request.beforeSend();calls.push(JSON.parse(request.body));return implementation?implementation(request):response();});
  return {provider,calls};
}

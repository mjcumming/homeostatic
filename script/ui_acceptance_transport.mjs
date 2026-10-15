/** Browser-only transport fault injection; independent HA reads remain untouched. */
export async function installTransport(page) {
  const transport={mode:null,holdMode:null,release:null,refreshFailure:false,responses:new Map(),saveRequests:0,configurationRequests:0,requestCounts:{},requestLog:[],commandModes:new Map(),connections:new Set(),interceptRequest:null,transformResponse:null};
  await page.routeWebSocket("**/api/websocket",route=>{
    const server=route.connectToServer(),requests=new Map(),queued=[];let held=false;transport.connections.add({route,server});
    const receive=(message,count=true)=>{
      let request;try{request=JSON.parse(String(message));}catch{server.send(message);return;}
      if(request.id)requests.set(request.id,request);
      if(count){
        transport.requestCounts[request.type]=(transport.requestCounts[request.type]??0)+1;
        if(request.type?.startsWith("homeostatic/"))transport.requestLog.push(structuredClone(request));
        if(request.type==="homeostatic/configuration")transport.configurationRequests++;
        if(request.type==="homeostatic/save_settings")transport.saveRequests++;
      }
      if(held){queued.push(message);return;}
      if(transport.interceptRequest?.(request,route,server))return;
      if(request.type==="homeostatic/configuration"&&transport.refreshFailure){transport.refreshFailure=false;route.send(JSON.stringify({id:request.id,type:"result",success:false,error:{code:"acceptance_refresh_failure",message:"Acceptance transport could not refresh saved settings"}}));return;}
      const mode=request.type==="homeostatic/save_settings"?transport.mode:transport.commandModes.get(request.type);
      if(request.type==="homeostatic/save_settings")transport.mode=null;else transport.commandModes.delete(request.type);
      const send=chosen=>{
        if(chosen==="reject"){route.send(JSON.stringify({id:request.id,type:"result",success:false,error:{code:"save_failed",message:"Acceptance transport rejected this save or read"}}));return;}
        if(chosen)transport.responses.set(request.id,chosen);
        server.send(message);
      };
      if(mode==="hold"){held=true;transport.release=override=>{transport.release=null;held=false;const chosen=override??transport.holdMode;transport.holdMode=null;send(chosen);while(!held&&queued.length)receive(queued.shift(),false);};return;}
      send(mode);
    };
    route.onMessage(message=>receive(message));
    server.onMessage(message=>{
      let packet;try{packet=JSON.parse(String(message));}catch{route.send(message);return;}
      const transform=result=>{
        const mode=transport.responses.get(result.id);
        if(mode&&result.type==="result"){
          transport.responses.delete(result.id);
          if(result.success&&mode==="uncertain")return {id:result.id,type:"result",success:false,error:{message:"Acceptance transport lost the successful save response"}};
          if(result.success&&mode==="refresh-fail")transport.refreshFailure=true;
        }
        return transport.transformResponse?transport.transformResponse(result,requests.get(result.id)):result;
      };
      const result=Array.isArray(packet)?packet.map(transform).filter(Boolean):transform(packet);
      if(result)route.send(JSON.stringify(result));
    });
  });
  return transport;
}

const ROUTES = [
  ["root", "/", "GET"],
  ["get-session", "/get-session", "GET"],
  ["api-auth-get-session", "/api/auth/get-session", "GET"],
  ["auth-get-session", "/auth/get-session", "GET"],
  ["token", "/token", "GET"],
  ["api-auth-token", "/api/auth/token", "GET"]
];
export default async function handler(req,res) {
  res.setHeader("Cache-Control","no-store");
  res.setHeader("X-Content-Type-Options","nosniff");
  if(req.method!=="GET"){res.setHeader("Allow","GET");return res.status(405).json({ok:false,code:"METHOD_NOT_ALLOWED"});}
  const base=String(process.env.NEON_AUTH_BASE_URL||"").replace(/\/+$/,"");
  if(!base)return res.status(503).json({ok:false,code:"AUTH_NOT_CONFIGURED"});
  const results=[];
  for(const [name,path,method] of ROUTES){
    try{
      const response=await fetch(base+path,{method,headers:{Accept:"application/json",Origin:"https://zafa-orcin.vercel.app"},redirect:"manual",cache:"no-store"});
      const contentType=response.headers.get("content-type")||"";
      const raw=await response.text();
      let parsed={};try{parsed=JSON.parse(raw);}catch{}
      results.push({name,method,path,status:response.status,contentType,code:typeof parsed.code==="string"?parsed.code:null,message:typeof parsed.message==="string"?parsed.message.slice(0,120):null});
    }catch(error){
      const e=error&&typeof error==="object"?error:null;
      results.push({name,method,path,status:0,code:"NETWORK_ERROR",message:typeof e?.message==="string"?e.message.slice(0,100):null});
    }
  }
  return res.status(200).json({ok:true,basePath:new URL(base).pathname,results});
}
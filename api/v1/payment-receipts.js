import Busboy from "busboy";
import { createHash, randomUUID } from "node:crypto";
import { getPool } from "../../lib/db.js";
import { requireProfile, sendApiError, ApiError } from "../../lib/auth.js";
import { putPrivateReceipt, deletePrivateReceipt } from "../../lib/storage.js";
export const config = { api: { bodyParser: false } };
const MAX_BYTES = 3 * 1024 * 1024;

function parseUpload(req) {
  return new Promise((resolve,reject)=>{
    let parser;
    try { parser=Busboy({headers:req.headers,limits:{files:1,fields:2,fileSize:MAX_BYTES}}); }
    catch { reject(new ApiError(400,"INVALID_MULTIPART_REQUEST")); return; }
    const fields={}; let fileBuffer=null; let fileInfo=null; let tooLarge=false;
    parser.on("field",(name,value)=>{if(name==="paymentId")fields.paymentId=value;});
    parser.on("file",(name,stream,info)=>{
      if(name!=="receipt"){stream.resume();return;}
      fileInfo=info; const chunks=[];
      stream.on("data",chunk=>chunks.push(chunk));
      stream.on("limit",()=>{tooLarge=true;});
      stream.on("end",()=>{fileBuffer=Buffer.concat(chunks);});
    });
    parser.on("filesLimit",()=>{tooLarge=true;});
    parser.on("fieldsLimit",()=>reject(new ApiError(400,"TOO_MANY_FIELDS")));
    parser.on("error",()=>reject(new ApiError(400,"INVALID_MULTIPART_REQUEST")));
    parser.on("close",()=>{
      if(tooLarge)return reject(new ApiError(413,"RECEIPT_TOO_LARGE"));
      if(!fileInfo||!fileBuffer?.length)return reject(new ApiError(400,"RECEIPT_REQUIRED"));
      resolve({fields,fileBuffer,fileInfo});
    });
    req.pipe(parser);
  });
}
function detectImageType(b) {
  if(b.length>=3&&b[0]===0xff&&b[1]===0xd8&&b[2]===0xff)return "image/jpeg";
  if(b.length>=8&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return "image/png";
  if(b.length>=12&&b.toString("ascii",0,4)==="RIFF"&&b.toString("ascii",8,12)==="WEBP")return "image/webp";
  return null;
}
function safeFilename(value) {
  return String(value||"receipt").split(/[\\\\/]/).pop().replace(/[^a-zA-Z0-9._-]/g,"_").slice(0,100)||"receipt";
}
export default async function handler(req,res) {
  res.setHeader("Cache-Control","no-store");
  res.setHeader("X-Content-Type-Options","nosniff");
  if(req.method!=="POST"){res.setHeader("Allow","POST");return res.status(405).json({ok:false,code:"METHOD_NOT_ALLOWED"});}
  try {
    const profile=await requireProfile(req);
    const upload=await parseUpload(req);
    const paymentId=String(upload.fields.paymentId||"");
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(paymentId))throw new ApiError(400,"INVALID_PAYMENT_ID");
    const contentType=detectImageType(upload.fileBuffer);
    if(!contentType)throw new ApiError(415,"UNSUPPORTED_RECEIPT_IMAGE");
    const pool=getPool();
    const found=await pool.query(
      `SELECT p.id,p.booking_id,p.provider,p.status,p.payment_kind,b.customer_id,ps.instapay_recipient
         FROM public.payments p JOIN public.bookings b ON b.id=p.booking_id
         LEFT JOIN public.payment_settings ps ON ps.id=1
        WHERE p.id=$1 AND b.customer_id=$2 LIMIT 1`,
      [paymentId,profile.id]
    );
    const payment=found.rows[0];
    if(!payment||payment.provider!=="instapay"||payment.payment_kind!=="deposit")throw new ApiError(404,"PAYMENT_NOT_FOUND");
    if(payment.status!=="pending")throw new ApiError(409,"PAYMENT_NOT_AWAITING_RECEIPT");
    if(!payment.instapay_recipient)throw new ApiError(409,"INSTAPAY_NOT_CONFIGURED");
    const open=await pool.query("SELECT id FROM public.payment_receipts WHERE payment_id=$1 AND status IN ('upload_pending','pending_review') LIMIT 1",[paymentId]);
    if(open.rows.length)throw new ApiError(409,"RECEIPT_ALREADY_SUBMITTED");
    const sha256=createHash("sha256").update(upload.fileBuffer).digest("hex");
    const ext=contentType==="image/jpeg"?"jpg":contentType==="image/png"?"png":"webp";
    const objectKey=`receipts/${paymentId}/${randomUUID()}.${ext}`;
    await putPrivateReceipt(objectKey,upload.fileBuffer,contentType,sha256);
    try {
      const {rows}=await pool.query(
        `INSERT INTO public.payment_receipts
          (payment_id,booking_id,object_key,original_filename,content_type,size_bytes,sha256,status,submitted_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'pending_review',$8) RETURNING id,status,created_at`,
        [payment.id,payment.booking_id,objectKey,safeFilename(upload.fileInfo.filename),contentType,upload.fileBuffer.length,sha256,profile.id]
      );
      return res.status(201).json({ok:true,receipt:{id:rows[0].id,status:rows[0].status,submittedAt:rows[0].created_at},paymentStatus:"pending",message:"تم استلام الإيصال للمراجعة. لم يتم تأكيد الدفع بعد."});
    } catch(error) { await deletePrivateReceipt(objectKey).catch(()=>{}); throw error; }
  } catch(error) { return sendApiError(res,error,"RECEIPT_UPLOAD_FAILED"); }
}

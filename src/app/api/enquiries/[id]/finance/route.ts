import { requireActor } from '@/lib/auth';
import { handle,json } from '@/lib/http';
import { withActor } from '@/lib/db';
import { requirePermission } from '@/lib/operations';
import { z } from 'zod';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){return handle(async()=>{
 const actor=await requireActor(request);const id=z.uuid().parse((await context.params).id);
 return json(await withActor(actor.id,async db=>{await requirePermission(db,'finance.view');const row=(await db.query('SELECT f.buying_cost AS "buyingCost",s.selling_price AS "sellingPrice",s.currency,s.unit,s.quantity FROM shipment_finance f JOIN shipments s ON s.id=f.shipment_id WHERE s.enquiry_id=$1',[id])).rows[0];return row?{buyingCost:Number(row.buyingCost),sellingPrice:Number(row.sellingPrice),margin:Number(row.sellingPrice)-Number(row.buyingCost),currency:row.currency,unit:row.unit,quantity:Number(row.quantity)}:null;}));
});}

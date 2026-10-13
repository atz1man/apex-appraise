import { beforeAll, expect, it, vi } from 'vitest';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';
let tenant: Tenant;
beforeAll(async () => { resetDatabase(); tenant = await makeTenant('Field cost reviews'); });
const base = { units: [{ label: 'Homes', count: 2, area: 750, cap: 400 }], efficiency: 85, trades: [{ label: 'Build', rate: 110 }], profFeePct: 11, contingencyPct: 5, otherCosts: [], finance: { ltcPct: 60, ratePct: 7.5, periodMonths: 18, salesMonths: 4, arrangementFeePct: 1.5, spendProfile: 'scurve' }, site: { mode: 'residual', landFixed: 0, acqPct: 6.8 }, disposal: { agentPct: 1.5, legalPct: 0.5 }, targetProfitOnGdvPct: 20 };
const cost = { label: 'Structural investigation', amount: 1250 };
async function fixture() {
 tenant = await makeTenant('Field review fixture');
 const c=callerFor(tenant.principal);
 const task=await c.tasks.create({dealId:tenant.dealId,title:'Review entrance crack',aspect:'Field inspection'});
 const t=(await c.tasks.list({dealId:tenant.dealId})).find(t=>t.id===task.id)!;
 await c.appraisal.save({dealId:tenant.dealId,input:base,source:'ai',asNewVersion:true,fieldTasks:[{id:t.id,version:t.evidenceVersion}]} as never);
 const saved=(await c.appraisal.getCurrent(tenant.dealId))!;
 const request={dealId:tenant.dealId,input:{...saved.input,otherCosts:[...saved.input.otherCosts,cost]},asNewVersion:true,expectedUpdatedAt:saved.updatedAt,fieldCost:{taskId:t.id,cost,reason:'Engineer investigation allowance pending quotation',accepted:true}};
 return {c,saved,t,request};
}
it('creates a new version with server-owned source and reviewer; marks later cost edits stale and restores history',async()=>{
 const {c,saved,t,request}=await fixture();
 const result=await c.appraisal.save({...request,fieldCost:{...request.fieldCost,reviewerName:'forged',task:{title:'forged'}}} as never);
 let current=(await c.appraisal.getCurrent(tenant.dealId))!;
 expect(current.id).not.toBe(saved.id);
 expect(current.source).toBe('ai');
 expect(current.fieldCostReviews?.[0]).toMatchObject({sourceVersionId:saved.id,task:{id:t.id,title:'Review entrance crack'},cost,costUnchanged:true,reviewerId:tenant.principal.userId});
 expect(current.fieldCostReviews?.[0].reviewerName).not.toBe('forged');
 expect(current.fieldSnapshot).toEqual(saved.fieldSnapshot);
 expect(current.input.otherCosts).toEqual([cost]);
 expect((await prisma.appraisal.findUniqueOrThrow({where:{id:saved.id}})).fieldCostReviews).toBeNull();
 await c.appraisal.save({dealId:tenant.dealId,input:{...current.input,otherCosts:[{...cost,amount:2000}]},expectedUpdatedAt:current.updatedAt} as never);
 current=(await c.appraisal.getCurrent(tenant.dealId))!;
 expect(current.fieldCostReviews?.[0]).toMatchObject({cost,costUnchanged:false});
 await c.appraisal.save({dealId:tenant.dealId,input:base,asNewVersion:true} as never);
 await c.appraisal.restore({dealId:tenant.dealId,versionId:result.id});
 expect((await c.appraisal.getCurrent(tenant.dealId))?.fieldCostReviews?.[0].cost).toEqual(cost);
});
it('refuses stale sources, foreign tasks, unrelated edits, missing acceptance and ordinary-save application',async()=>{
 const {c,saved,request}=await fixture();
 const before=await prisma.appraisal.count();
 for(const change of [{asNewVersion:false},{expectedUpdatedAt:new Date(0)},{fieldCost:{...request.fieldCost,taskId:'foreign'}},{fieldCost:{...request.fieldCost,accepted:false}},{input:{...request.input,efficiency:70}},{input:{...request.input,otherCosts:[{...cost,amount:3}]}},{fieldCost:{...request.fieldCost,cost:{...cost,amount:-1}}}]) {
  await expect(c.appraisal.save({...request,...change} as never)).rejects.toBeDefined();
 }
 const foreign=await makeTenant('Foreign field cost');
 await expect(callerFor(foreign.principal).appraisal.save({...request,dealId:foreign.dealId} as never)).rejects.toBeDefined();
 expect(await prisma.appraisal.count()).toBe(before);
 await prisma.appraisal.update({where:{id:saved.id},data:{fieldCostReviews:'{broken'}});
 const broken=(await c.appraisal.getCurrent(tenant.dealId))!;
 expect(broken).toMatchObject({fieldCostReviews:null,fieldCostReviewsState:'unreadable'});
 await expect(c.appraisal.save({...request,expectedUpdatedAt:broken.updatedAt} as never)).rejects.toMatchObject({code:'PRECONDITION_FAILED'});
});

it('does not duplicate a committed allowance on retry or accept an edit racing its version transaction', async () => {
 const { c, saved, request } = await fixture();
 const transaction = prisma.$transaction.bind(prisma);
 const intercept = vi.spyOn(prisma, '$transaction').mockImplementationOnce((async (work: unknown, options: unknown) => {
  await prisma.appraisal.update({ where: { id: saved.id }, data: { updatedAt: new Date(saved.updatedAt.getTime() + 1000) } });
  return transaction(work as never, options as never);
 }) as typeof prisma.$transaction);
 const before = await prisma.appraisal.count();
 try { await expect(c.appraisal.save(request as never)).rejects.toMatchObject({ code: 'CONFLICT' }); }
 finally { intercept.mockRestore(); }
 expect(await prisma.appraisal.count()).toBe(before);
 const fresh = (await c.appraisal.getCurrent(tenant.dealId))!;
 const submission = { ...request, expectedUpdatedAt: fresh.updatedAt };
 await c.appraisal.save(submission as never);
 await expect(c.appraisal.save(submission as never)).rejects.toMatchObject({ code: 'CONFLICT' });
 expect(await prisma.appraisal.count()).toBe(before + 1);
 expect((await c.appraisal.getCurrent(tenant.dealId))?.input.otherCosts).toEqual([cost]);
});

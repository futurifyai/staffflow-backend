import { Router } from "express";
import { requireAuth, type AuthRequest } from "../lib/auth";
import { db } from "@workspace/db";
import { leavesTable, leaveBalancesTable, employeesTable } from "@workspace/db/schema";
import { eq, and, gte, lte, desc, inArray } from "drizzle-orm";

const router = Router();

async function ensureLeaveBalance(employeeId: number, year: number) {
  const [existing] = await db.select().from(leaveBalancesTable)
    .where(and(eq(leaveBalancesTable.employeeId, employeeId), eq(leaveBalancesTable.year, year)));
  if (!existing) {
    const [created] = await db.insert(leaveBalancesTable).values({ employeeId, year }).returning();
    return created;
  }
  return existing;
}

router.get("/leaves", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const adminId = req.user!.adminId;
  const { employeeId, status, year } = req.query;

  const employees = await db.select({ id: employeesTable.id })
    .from(employeesTable).where(eq(employeesTable.adminId, adminId));
  const empIds = employees.map(e => e.id);

  if (!empIds.length) { res.json([]); return; }

  let query = db.select({
    id: leavesTable.id,
    employeeId: leavesTable.employeeId,
    employeeName: employeesTable.name,
    type: leavesTable.type,
    startDate: leavesTable.startDate,
    endDate: leavesTable.endDate,
    days: leavesTable.days,
    reason: leavesTable.reason,
    status: leavesTable.status,
    approverNote: leavesTable.approverNote,
    createdAt: leavesTable.createdAt,
  }).from(leavesTable)
    .innerJoin(employeesTable, eq(leavesTable.employeeId, employeesTable.id))
    .where(
      inArray(leavesTable.employeeId, empIds)
    ).orderBy(desc(leavesTable.createdAt));

  const leaves = await query;

  let filtered = leaves;
  if (employeeId) filtered = filtered.filter(l => l.employeeId === Number(employeeId));
  if (status) filtered = filtered.filter(l => l.status === status);
  if (year) {
    const y = Number(year);
    filtered = filtered.filter(l => new Date(l.startDate).getFullYear() === y);
  }

  res.json(filtered);
});

router.post("/leaves", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const adminId = req.user!.adminId;
  const { employeeId, type, startDate, endDate, reason } = req.body;

  if (!employeeId || !type || !startDate || !endDate) {
    res.status(400).json({ error: "employeeId, type, startDate, endDate are required" });
    return;
  }

  const [emp] = await db.select().from(employeesTable)
    .where(and(eq(employeesTable.id, employeeId), eq(employeesTable.adminId, adminId)));
  if (!emp) { res.status(404).json({ error: "Employee not found" }); return; }

  const msPerDay = 1000 * 60 * 60 * 24;
  const days = Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / msPerDay) + 1;
  const year = new Date(startDate).getFullYear();

  await ensureLeaveBalance(employeeId, year);

  const [leave] = await db.insert(leavesTable).values({
    employeeId,
    type,
    startDate,
    endDate,
    days,
    reason: reason || null,
    status: "pending",
  }).returning();

  res.status(201).json(leave);
});

router.patch("/leaves/:id/approve", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const adminId = req.user!.adminId;
  const { id } = req.params;
  const { approverNote } = req.body;

  const [leave] = await db.select().from(leavesTable).where(eq(leavesTable.id, Number(id)));
  if (!leave) { res.status(404).json({ error: "Leave not found" }); return; }

  const [emp] = await db.select().from(employeesTable)
    .where(and(eq(employeesTable.id, leave.employeeId), eq(employeesTable.adminId, adminId)));
  if (!emp) { res.status(403).json({ error: "Forbidden" }); return; }

  const [updated] = await db.update(leavesTable).set({
    status: "approved",
    approvedBy: req.user!.userId,
    approverNote: approverNote || null,
    updatedAt: new Date(),
  }).where(eq(leavesTable.id, Number(id))).returning();

  const year = new Date(leave.startDate).getFullYear();
  const balance = await ensureLeaveBalance(leave.employeeId, year);
  const typeKey = leave.type.toLowerCase() as "casual" | "sick" | "earned";
  const usedKey = `${typeKey}Used` as "casualUsed" | "sickUsed" | "earnedUsed";
  if (usedKey in balance) {
    await db.update(leaveBalancesTable).set({
      [usedKey]: (balance[usedKey] || 0) + leave.days,
      updatedAt: new Date(),
    }).where(and(
      eq(leaveBalancesTable.employeeId, leave.employeeId),
      eq(leaveBalancesTable.year, year)
    ));
  }

  res.json(updated);
});

router.patch("/leaves/:id/reject", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const adminId = req.user!.adminId;
  const { id } = req.params;
  const { approverNote } = req.body;

  const [leave] = await db.select().from(leavesTable).where(eq(leavesTable.id, Number(id)));
  if (!leave) { res.status(404).json({ error: "Leave not found" }); return; }

  const [emp] = await db.select().from(employeesTable)
    .where(and(eq(employeesTable.id, leave.employeeId), eq(employeesTable.adminId, adminId)));
  if (!emp) { res.status(403).json({ error: "Forbidden" }); return; }

  const [updated] = await db.update(leavesTable).set({
    status: "rejected",
    approvedBy: req.user!.userId,
    approverNote: approverNote || null,
    updatedAt: new Date(),
  }).where(eq(leavesTable.id, Number(id))).returning();

  res.json(updated);
});

router.delete("/leaves/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const adminId = req.user!.adminId;
  const { id } = req.params;

  const [leave] = await db.select().from(leavesTable).where(eq(leavesTable.id, Number(id)));
  if (!leave) { res.status(404).json({ error: "Leave not found" }); return; }

  const [emp] = await db.select().from(employeesTable)
    .where(and(eq(employeesTable.id, leave.employeeId), eq(employeesTable.adminId, adminId)));
  if (!emp) { res.status(403).json({ error: "Forbidden" }); return; }

  await db.delete(leavesTable).where(eq(leavesTable.id, Number(id)));
  res.status(204).send();
});

router.get("/leaves/balances", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const adminId = req.user!.adminId;
  const year = Number(req.query.year) || new Date().getFullYear();

  const employees = await db.select().from(employeesTable)
    .where(eq(employeesTable.adminId, adminId));

  const balances = await Promise.all(employees.map(async emp => {
    const balance = await ensureLeaveBalance(emp.id, year);
    return {
      employeeId: emp.id,
      employeeName: emp.name,
      year,
      casual: balance.casual,
      sick: balance.sick,
      earned: balance.earned,
      casualUsed: balance.casualUsed,
      sickUsed: balance.sickUsed,
      earnedUsed: balance.earnedUsed,
      casualRemaining: balance.casual - balance.casualUsed,
      sickRemaining: balance.sick - balance.sickUsed,
      earnedRemaining: balance.earned - balance.earnedUsed,
    };
  }));

  res.json(balances);
});

export default router;

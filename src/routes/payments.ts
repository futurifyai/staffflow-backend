import { Router } from "express";
import { db, paymentsTable, employeesTable, attendanceTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import {
  CreatePaymentBody,
  UpdatePaymentBody,
  UpdatePaymentParams,
  DeletePaymentParams,
  ListPaymentsQueryParams,
  GetSalarySummaryQueryParams,
} from "@workspace/api-zod";

const router = Router();

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

router.get("/payments/salary-summary", requireAuth, async (req, res): Promise<void> => {
  const { adminId } = (req as any).user;
  const queryParams = GetSalarySummaryQueryParams.safeParse(req.query);
  if (!queryParams.success) {
    res.status(400).json({ error: queryParams.error.message });
    return;
  }

  const { month, year } = queryParams.data;

  const adminEmployees = await db.select().from(employeesTable).where(eq(employeesTable.adminId, adminId));
  if (adminEmployees.length === 0) {
    res.json([]);
    return;
  }

  const employeeIds = adminEmployees.map(e => e.id);
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = `${year}-${String(month).padStart(2, "0")}-${getDaysInMonth(year, month)}`;

  const allAttendance = await db.select().from(attendanceTable)
    .where(inArray(attendanceTable.employeeId, employeeIds));
  const monthAttendance = allAttendance.filter(a => a.date >= startDate && a.date <= endDate);

  const allPayments = await db.select().from(paymentsTable)
    .where(inArray(paymentsTable.employeeId, employeeIds));
  const monthPayments = allPayments.filter(p => p.month === month && p.year === year);

  const workingDays = getDaysInMonth(year, month);

  const summaries = adminEmployees.map(emp => {
    const empAttendance = monthAttendance.filter(a => a.employeeId === emp.id);
    const presentDays = empAttendance.filter(a => a.status === "present").length;
    const halfDays = empAttendance.filter(a => a.status === "half_day").length;
    const overtime = empAttendance.reduce((sum, a) => sum + (a.overtimeHours || 0), 0);

    const baseSalary = Number(emp.salary);
    let netSalary: number;

    if (emp.salaryType === "daily") {
      netSalary = baseSalary * (presentDays + halfDays * 0.5);
    } else {
      const perDay = baseSalary / workingDays;
      netSalary = perDay * (presentDays + halfDays * 0.5);
    }

    const overtimePay = overtime * (baseSalary / workingDays / 8);

    const empPayments = monthPayments.filter(p => p.employeeId === emp.id);
    const deductions = empPayments
      .filter(p => p.type === "deduction")
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const advances = empPayments
      .filter(p => p.type === "advance")
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const paid = empPayments
      .filter(p => p.type === "salary" && p.status === "paid")
      .reduce((sum, p) => sum + Number(p.amount), 0);

    const finalSalary = netSalary + overtimePay - deductions - advances;
    const pending = Math.max(0, finalSalary - paid);

    return {
      employeeId: emp.id,
      employeeName: emp.name,
      baseSalary,
      salaryType: emp.salaryType,
      workingDays,
      presentDays,
      halfDays,
      overtimeHours: overtime,
      overtimePay,
      deductions,
      advances,
      netSalary: finalSalary,
      paid,
      pending,
    };
  });

  res.json(summaries);
});

router.get("/payments", requireAuth, async (req, res): Promise<void> => {
  const { adminId } = (req as any).user;
  const queryParams = ListPaymentsQueryParams.safeParse(req.query);

  const adminEmployees = await db.select().from(employeesTable).where(eq(employeesTable.adminId, adminId));
  const employeeIds = adminEmployees.map(e => e.id);
  const employeeMap = new Map(adminEmployees.map(e => [e.id, e.name]));

  if (employeeIds.length === 0) {
    res.json([]);
    return;
  }

  const allPayments = await db.select().from(paymentsTable)
    .where(inArray(paymentsTable.employeeId, employeeIds));

  let filtered = allPayments;
  if (queryParams.success) {
    const { employeeId, month, year, type } = queryParams.data;
    if (employeeId) filtered = filtered.filter(p => p.employeeId === employeeId);
    if (month) filtered = filtered.filter(p => p.month === month);
    if (year) filtered = filtered.filter(p => p.year === year);
    if (type) filtered = filtered.filter(p => p.type === type);
  }

  res.json(filtered.map(p => ({
    ...p,
    amount: Number(p.amount),
    employeeName: employeeMap.get(p.employeeId) || "Unknown",
    paidAt: p.paidAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
  })));
});

router.post("/payments", requireAuth, async (req, res): Promise<void> => {
  const { adminId } = (req as any).user;
  const parsed = CreatePaymentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const adminEmployees = await db.select().from(employeesTable).where(eq(employeesTable.adminId, adminId));
  const employee = adminEmployees.find(e => e.id === parsed.data.employeeId);
  if (!employee) {
    res.status(404).json({ error: "Employee not found" });
    return;
  }

  const [payment] = await db.insert(paymentsTable).values({
    ...parsed.data,
    amount: String(parsed.data.amount),
    paidAt: parsed.data.status === "paid" ? new Date() : null,
  }).returning();

  res.status(201).json({
    ...payment,
    amount: Number(payment.amount),
    employeeName: employee.name,
    paidAt: payment.paidAt?.toISOString() ?? null,
    createdAt: payment.createdAt.toISOString(),
  });
});

router.patch("/payments/:id", requireAuth, async (req, res): Promise<void> => {
  const params = UpdatePaymentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdatePaymentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: any = { ...parsed.data };
  if (updateData.amount !== undefined) updateData.amount = String(updateData.amount);
  if (updateData.status === "paid") updateData.paidAt = new Date();

  const [payment] = await db.update(paymentsTable)
    .set(updateData)
    .where(eq(paymentsTable.id, params.data.id))
    .returning();

  if (!payment) {
    res.status(404).json({ error: "Payment not found" });
    return;
  }

  const { adminId } = (req as any).user;
  const adminEmployees = await db.select().from(employeesTable).where(eq(employeesTable.adminId, adminId));
  const employeeMap = new Map(adminEmployees.map(e => [e.id, e.name]));

  res.json({
    ...payment,
    amount: Number(payment.amount),
    employeeName: employeeMap.get(payment.employeeId) || "Unknown",
    paidAt: payment.paidAt?.toISOString() ?? null,
    createdAt: payment.createdAt.toISOString(),
  });
});

router.delete("/payments/:id", requireAuth, async (req, res): Promise<void> => {
  const params = DeletePaymentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [payment] = await db.delete(paymentsTable)
    .where(eq(paymentsTable.id, params.data.id))
    .returning();

  if (!payment) {
    res.status(404).json({ error: "Payment not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;

import { Router } from "express";
import { db, employeesTable, attendanceTable, paymentsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { GetMonthlyReportQueryParams } from "@workspace/api-zod";

const router = Router();

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

router.get("/reports/monthly", requireAuth, async (req, res): Promise<void> => {
  const { adminId } = (req as any).user;
  const queryParams = GetMonthlyReportQueryParams.safeParse(req.query);
  if (!queryParams.success) {
    res.status(400).json({ error: queryParams.error.message });
    return;
  }

  const { month, year } = queryParams.data;

  const adminEmployees = await db.select().from(employeesTable).where(eq(employeesTable.adminId, adminId));
  if (adminEmployees.length === 0) {
    res.json({
      month, year, totalEmployees: 0, totalWorkingDays: getDaysInMonth(year, month),
      totalSalaryPaid: 0, totalPending: 0, attendanceRate: 0, employees: [],
    });
    return;
  }

  const employeeIds = adminEmployees.map(e => e.id);
  const workingDays = getDaysInMonth(year, month);
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = `${year}-${String(month).padStart(2, "0")}-${workingDays}`;

  const allAttendance = await db.select().from(attendanceTable)
    .where(inArray(attendanceTable.employeeId, employeeIds));
  const monthAttendance = allAttendance.filter(a => a.date >= startDate && a.date <= endDate);

  const allPayments = await db.select().from(paymentsTable)
    .where(inArray(paymentsTable.employeeId, employeeIds));
  const monthPayments = allPayments.filter(p => p.month === month && p.year === year);

  let totalSalaryPaid = 0;
  let totalPending = 0;
  let totalAttendancePoints = 0;
  const employees = [];

  for (const emp of adminEmployees) {
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
    const deductions = empPayments.filter(p => p.type === "deduction").reduce((sum, p) => sum + Number(p.amount), 0);
    const advances = empPayments.filter(p => p.type === "advance").reduce((sum, p) => sum + Number(p.amount), 0);
    const paid = empPayments.filter(p => p.type === "salary" && p.status === "paid").reduce((sum, p) => sum + Number(p.amount), 0);

    const finalSalary = netSalary + overtimePay - deductions - advances;
    const pending = Math.max(0, finalSalary - paid);

    totalSalaryPaid += paid;
    totalPending += pending;
    totalAttendancePoints += (presentDays + halfDays * 0.5);

    employees.push({
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
    });
  }

  const attendanceRate = adminEmployees.length > 0
    ? Math.round((totalAttendancePoints / (adminEmployees.length * workingDays)) * 100)
    : 0;

  res.json({
    month,
    year,
    totalEmployees: adminEmployees.length,
    totalWorkingDays: workingDays,
    totalSalaryPaid,
    totalPending,
    attendanceRate,
    employees,
  });
});

export default router;

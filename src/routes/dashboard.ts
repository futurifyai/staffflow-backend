import { Router } from "express";
import { db, employeesTable, attendanceTable, paymentsTable, tasksTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

const router = Router();

router.get("/dashboard/stats", requireAuth, async (req, res): Promise<void> => {
  const { adminId } = (req as any).user;

  const adminEmployees = await db.select().from(employeesTable)
    .where(and(eq(employeesTable.adminId, adminId), eq(employeesTable.status, "active")));
  const employeeIds = adminEmployees.map(e => e.id);

  const today = new Date().toISOString().split("T")[0];
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  let presentToday = 0;
  let absentToday = 0;
  let halfDayToday = 0;

  if (employeeIds.length > 0) {
    const todayAttendance = await db.select().from(attendanceTable)
      .where(and(
        inArray(attendanceTable.employeeId, employeeIds),
        eq(attendanceTable.date, today)
      ));

    presentToday = todayAttendance.filter(a => a.status === "present").length;
    absentToday = todayAttendance.filter(a => a.status === "absent").length;
    halfDayToday = todayAttendance.filter(a => a.status === "half_day").length;
  }

  let totalSalaryThisMonth = 0;
  let totalPaidThisMonth = 0;
  let pendingDues = 0;
  let activeTasks = 0;

  if (employeeIds.length > 0) {
    const monthPayments = await db.select().from(paymentsTable)
      .where(inArray(paymentsTable.employeeId, employeeIds));

    const thisMonthPayments = monthPayments.filter(p => p.month === month && p.year === year);
    totalSalaryThisMonth = adminEmployees.reduce((sum, e) => sum + Number(e.salary), 0);
    totalPaidThisMonth = thisMonthPayments
      .filter(p => p.type === "salary" && p.status === "paid")
      .reduce((sum, p) => sum + Number(p.amount), 0);
    pendingDues = thisMonthPayments
      .filter(p => p.status === "pending")
      .reduce((sum, p) => sum + Number(p.amount), 0);

    const tasks = await db.select().from(tasksTable)
      .where(inArray(tasksTable.employeeId, employeeIds));
    activeTasks = tasks.filter(t => t.status !== "done").length;
  }

  res.json({
    totalEmployees: adminEmployees.length,
    presentToday,
    absentToday,
    halfDayToday,
    totalSalaryThisMonth,
    totalPaidThisMonth,
    pendingDues,
    activeTasks,
  });
});

router.get("/dashboard/insights", requireAuth, async (req, res): Promise<void> => {
  const { adminId } = (req as any).user;

  const adminEmployees = await db.select().from(employeesTable)
    .where(and(eq(employeesTable.adminId, adminId), eq(employeesTable.status, "active")));
  const employeeIds = adminEmployees.map(e => e.id);

  const insights = [];

  if (employeeIds.length === 0) {
    res.json([{ id: "no-employees", type: "info", message: "Add your first employee to get started", metric: null }]);
    return;
  }

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const daysInMonth = new Date(year, month, 0).getDate();
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const today = now.toISOString().split("T")[0];

  const allAttendance = await db.select().from(attendanceTable)
    .where(inArray(attendanceTable.employeeId, employeeIds));

  const monthAttendance = allAttendance.filter(a => a.date >= startDate && a.date <= today);

  const absentCounts = new Map<number, number>();
  monthAttendance.filter(a => a.status === "absent").forEach(a => {
    absentCounts.set(a.employeeId, (absentCounts.get(a.employeeId) || 0) + 1);
  });

  const frequentAbsentees = [...absentCounts.entries()]
    .filter(([_, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1]);

  if (frequentAbsentees.length > 0) {
    insights.push({
      id: "frequent-absent",
      type: "warning",
      message: `${frequentAbsentees.length} employee${frequentAbsentees.length > 1 ? "s" : ""} frequently absent this month`,
      metric: `${frequentAbsentees.length} employees`,
    });
  }

  const totalPresent = monthAttendance.filter(a => a.status === "present").length;
  const totalHalf = monthAttendance.filter(a => a.status === "half_day").length;
  const totalExpected = employeeIds.length * Math.min(now.getDate(), daysInMonth);
  const attendanceRate = totalExpected > 0
    ? Math.round(((totalPresent + totalHalf * 0.5) / totalExpected) * 100)
    : 0;

  if (attendanceRate >= 90) {
    insights.push({
      id: "high-attendance",
      type: "success",
      message: `Excellent attendance this month — ${attendanceRate}% rate`,
      metric: `${attendanceRate}%`,
    });
  } else if (attendanceRate < 70) {
    insights.push({
      id: "low-attendance",
      type: "alert",
      message: `Attendance rate is below average at ${attendanceRate}%`,
      metric: `${attendanceRate}%`,
    });
  }

  const monthPayments = await db.select().from(paymentsTable)
    .where(inArray(paymentsTable.employeeId, employeeIds));
  const thisMonthPayments = monthPayments.filter(p => p.month === month && p.year === year);
  const pendingPayments = thisMonthPayments.filter(p => p.status === "pending");

  if (pendingPayments.length > 0) {
    const pendingAmount = pendingPayments.reduce((sum, p) => sum + Number(p.amount), 0);
    insights.push({
      id: "pending-payments",
      type: "warning",
      message: `${pendingPayments.length} pending payment${pendingPayments.length > 1 ? "s" : ""} totaling ₹${pendingAmount.toLocaleString("en-IN")}`,
      metric: `₹${pendingAmount.toLocaleString("en-IN")}`,
    });
  }

  const tasks = await db.select().from(tasksTable)
    .where(inArray(tasksTable.employeeId, employeeIds));
  const overdueTasks = tasks.filter(t => {
    if (t.status === "done" || !t.dueDate) return false;
    return t.dueDate < today;
  });

  if (overdueTasks.length > 0) {
    insights.push({
      id: "overdue-tasks",
      type: "alert",
      message: `${overdueTasks.length} overdue task${overdueTasks.length > 1 ? "s" : ""} need attention`,
      metric: `${overdueTasks.length} tasks`,
    });
  }

  if (insights.length === 0) {
    insights.push({
      id: "all-good",
      type: "success",
      message: "Everything looks great! Team is performing well this month.",
      metric: null,
    });
  }

  res.json(insights);
});

router.get("/dashboard/attendance-trend", requireAuth, async (req, res): Promise<void> => {
  const { adminId } = (req as any).user;

  const adminEmployees = await db.select().from(employeesTable)
    .where(and(eq(employeesTable.adminId, adminId), eq(employeesTable.status, "active")));
  const employeeIds = adminEmployees.map(e => e.id);

  const trend = [];
  const now = new Date();

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const dateStr = d.toISOString().split("T")[0];

    let present = 0, absent = 0, halfDay = 0;

    if (employeeIds.length > 0) {
      const dayAttendance = await db.select().from(attendanceTable)
        .where(and(
          inArray(attendanceTable.employeeId, employeeIds),
          eq(attendanceTable.date, dateStr)
        ));

      present = dayAttendance.filter(a => a.status === "present").length;
      absent = dayAttendance.filter(a => a.status === "absent").length;
      halfDay = dayAttendance.filter(a => a.status === "half_day").length;
    }

    trend.push({ date: dateStr, present, absent, halfDay });
  }

  res.json(trend);
});

export default router;

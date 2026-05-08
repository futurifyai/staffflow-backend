import { Router } from "express";
import { db, attendanceTable, employeesTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import {
  MarkAttendanceBody,
  UpdateAttendanceBody,
  UpdateAttendanceParams,
  ListAttendanceQueryParams,
  GetAttendanceSummaryQueryParams,
} from "@workspace/api-zod";

const router = Router();

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

router.get("/attendance/summary", requireAuth, async (req, res): Promise<void> => {
  const { adminId } = (req as any).user;
  const queryParams = GetAttendanceSummaryQueryParams.safeParse(req.query);
  if (!queryParams.success) {
    res.status(400).json({ error: queryParams.error.message });
    return;
  }

  const { month, year, employeeId } = queryParams.data;

  const adminEmployees = await db.select().from(employeesTable).where(eq(employeesTable.adminId, adminId));
  const employeeIds = adminEmployees.map(e => e.id);

  if (employeeIds.length === 0) {
    res.json([]);
    return;
  }

  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = `${year}-${String(month).padStart(2, "0")}-${getDaysInMonth(year, month)}`;

  let attendanceQuery = db.select().from(attendanceTable)
    .where(and(
      inArray(attendanceTable.employeeId, employeeIds),
    ));

  const allAttendance = await attendanceQuery;
  const monthAttendance = allAttendance.filter(a => a.date >= startDate && a.date <= endDate);

  const workingDays = getDaysInMonth(year, month);

  const employeeFilter = employeeId ? adminEmployees.filter(e => e.id === employeeId) : adminEmployees;

  const summaries = employeeFilter.map(emp => {
    const empAttendance = monthAttendance.filter(a => a.employeeId === emp.id);
    const present = empAttendance.filter(a => a.status === "present").length;
    const absent = empAttendance.filter(a => a.status === "absent").length;
    const halfDay = empAttendance.filter(a => a.status === "half_day").length;
    const overtime = empAttendance.reduce((sum, a) => sum + (a.overtimeHours || 0), 0);
    const percentage = workingDays > 0 ? Math.round(((present + halfDay * 0.5) / workingDays) * 100) : 0;

    return {
      employeeId: emp.id,
      employeeName: emp.name,
      present,
      absent,
      halfDay,
      overtime,
      workingDays,
      percentage,
    };
  });

  res.json(summaries);
});

router.get("/attendance", requireAuth, async (req, res): Promise<void> => {
  const { adminId } = (req as any).user;
  const queryParams = ListAttendanceQueryParams.safeParse(req.query);

  const adminEmployees = await db.select().from(employeesTable).where(eq(employeesTable.adminId, adminId));
  const employeeIds = adminEmployees.map(e => e.id);

  if (employeeIds.length === 0) {
    res.json([]);
    return;
  }

  const allAttendance = await db.select().from(attendanceTable)
    .where(inArray(attendanceTable.employeeId, employeeIds));

  let filtered = allAttendance;

  if (queryParams.success) {
    const { employeeId, month, year, date } = queryParams.data;
    if (employeeId) filtered = filtered.filter(a => a.employeeId === employeeId);
    if (date) filtered = filtered.filter(a => a.date === date);
    if (month && year) {
      const prefix = `${year}-${String(month).padStart(2, "0")}`;
      filtered = filtered.filter(a => a.date.startsWith(prefix));
    }
  }

  const employeeMap = new Map(adminEmployees.map(e => [e.id, e.name]));

  const sorted = [...filtered].sort((a, b) => {
    if (b.date !== a.date) return b.date.localeCompare(a.date);
    return (employeeMap.get(a.employeeId) ?? "").localeCompare(employeeMap.get(b.employeeId) ?? "");
  });

  res.json(sorted.map(a => ({
    ...a,
    employeeName: employeeMap.get(a.employeeId) || "Unknown",
    createdAt: a.createdAt.toISOString(),
  })));
});

router.post("/attendance", requireAuth, async (req, res): Promise<void> => {
  const { adminId } = (req as any).user;
  const parsed = MarkAttendanceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const adminEmployees = await db.select().from(employeesTable).where(eq(employeesTable.adminId, adminId));
  const employeeMap = new Map(adminEmployees.map(e => [e.id, e.name]));

  const results = [];
  for (const record of parsed.data.records) {
    if (!employeeMap.has(record.employeeId)) continue;

    const existing = await db.select().from(attendanceTable)
      .where(and(
        eq(attendanceTable.employeeId, record.employeeId),
        eq(attendanceTable.date, record.date)
      )).limit(1);

    let att;
    if (existing.length > 0) {
      [att] = await db.update(attendanceTable)
        .set({
          status: record.status,
          checkIn: record.checkIn ?? null,
          checkOut: record.checkOut ?? null,
          note: record.note ?? null,
          overtimeHours: record.overtimeHours ?? null,
          latitude: record.latitude ?? null,
          longitude: record.longitude ?? null,
        })
        .where(eq(attendanceTable.id, existing[0].id))
        .returning();
    } else {
      [att] = await db.insert(attendanceTable).values({
        employeeId: record.employeeId,
        date: record.date,
        status: record.status,
        checkIn: record.checkIn ?? null,
        checkOut: record.checkOut ?? null,
        note: record.note ?? null,
        overtimeHours: record.overtimeHours ?? null,
        latitude: record.latitude ?? null,
        longitude: record.longitude ?? null,
      }).returning();
    }

    results.push({
      ...att,
      employeeName: employeeMap.get(att.employeeId) || "Unknown",
      createdAt: att.createdAt.toISOString(),
    });
  }

  res.json(results);
});

router.patch("/attendance/:id", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateAttendanceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateAttendanceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [att] = await db.update(attendanceTable)
    .set(parsed.data)
    .where(eq(attendanceTable.id, params.data.id))
    .returning();

  if (!att) {
    res.status(404).json({ error: "Attendance record not found" });
    return;
  }

  const { adminId } = (req as any).user;
  const adminEmployees = await db.select().from(employeesTable).where(eq(employeesTable.adminId, adminId));
  const employeeMap = new Map(adminEmployees.map(e => [e.id, e.name]));

  res.json({
    ...att,
    employeeName: employeeMap.get(att.employeeId) || "Unknown",
    createdAt: att.createdAt.toISOString(),
  });
});

// ─── Today's check-in/out status for a single employee ─────────────────────
router.get("/attendance/today-status", requireAuth, async (req, res): Promise<void> => {
  const { adminId } = (req as any).user;
  const employeeId = parseInt(req.query.employeeId as string, 10);

  if (!employeeId || isNaN(employeeId)) {
    res.status(400).json({ error: "employeeId query param is required" });
    return;
  }

  // Ensure the employee belongs to this admin
  const [employee] = await db
    .select()
    .from(employeesTable)
    .where(and(eq(employeesTable.id, employeeId), eq(employeesTable.adminId, adminId)));

  if (!employee) {
    res.status(404).json({ error: "Employee not found" });
    return;
  }

  const today = new Date().toISOString().slice(0, 10);

  const records = await db
    .select()
    .from(attendanceTable)
    .where(and(eq(attendanceTable.employeeId, employeeId), eq(attendanceTable.date, today)));

  const present = records.find((r) => r.status === "present");

  if (!present) {
    res.json({ hasRecord: false, status: null, checkIn: null, checkOut: null, expectedAction: "check_in" });
    return;
  }

  const expectedAction = present.checkOut ? "already_checked_out" : "check_out";

  res.json({
    hasRecord: true,
    status: present.status,
    checkIn: present.checkIn ?? null,
    checkOut: present.checkOut ?? null,
    expectedAction,
  });
});

export default router;

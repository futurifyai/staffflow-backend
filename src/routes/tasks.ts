import { Router } from "express";
import { db, tasksTable, employeesTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import {
  CreateTaskBody,
  UpdateTaskBody,
  UpdateTaskParams,
  DeleteTaskParams,
  ListTasksQueryParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/tasks", requireAuth, async (req, res): Promise<void> => {
  const { adminId } = (req as any).user;
  const queryParams = ListTasksQueryParams.safeParse(req.query);

  const adminEmployees = await db.select().from(employeesTable).where(eq(employeesTable.adminId, adminId));
  const employeeIds = adminEmployees.map(e => e.id);
  const employeeMap = new Map(adminEmployees.map(e => [e.id, e.name]));

  if (employeeIds.length === 0) {
    res.json([]);
    return;
  }

  const allTasks = await db.select().from(tasksTable).where(inArray(tasksTable.employeeId, employeeIds));

  let filtered = allTasks;
  if (queryParams.success) {
    const { employeeId, status } = queryParams.data;
    if (employeeId) filtered = filtered.filter(t => t.employeeId === employeeId);
    if (status) filtered = filtered.filter(t => t.status === status);
  }

  res.json(filtered.map(t => ({
    ...t,
    employeeName: employeeMap.get(t.employeeId) || "Unknown",
    createdAt: t.createdAt.toISOString(),
  })));
});

router.post("/tasks", requireAuth, async (req, res): Promise<void> => {
  const { adminId } = (req as any).user;
  const parsed = CreateTaskBody.safeParse(req.body);
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

  const [task] = await db.insert(tasksTable).values({
    ...parsed.data,
    status: "pending",
  }).returning();

  res.status(201).json({
    ...task,
    employeeName: employee.name,
    createdAt: task.createdAt.toISOString(),
  });
});

router.patch("/tasks/:id", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [task] = await db.update(tasksTable)
    .set(parsed.data)
    .where(eq(tasksTable.id, params.data.id))
    .returning();

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const { adminId } = (req as any).user;
  const adminEmployees = await db.select().from(employeesTable).where(eq(employeesTable.adminId, adminId));
  const employeeMap = new Map(adminEmployees.map(e => [e.id, e.name]));

  res.json({
    ...task,
    employeeName: employeeMap.get(task.employeeId) || "Unknown",
    createdAt: task.createdAt.toISOString(),
  });
});

router.delete("/tasks/:id", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [task] = await db.delete(tasksTable)
    .where(eq(tasksTable.id, params.data.id))
    .returning();

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;

import { Router } from "express";
import { db, employeesTable } from "@workspace/db";
import { eq, and, ilike, or } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import {
  CreateEmployeeBody,
  UpdateEmployeeBody,
  GetEmployeeParams,
  UpdateEmployeeParams,
  DeleteEmployeeParams,
  ListEmployeesQueryParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/employees", requireAuth, async (req, res): Promise<void> => {
  const { adminId } = (req as any).user;
  const queryParams = ListEmployeesQueryParams.safeParse(req.query);
  const search = queryParams.success ? queryParams.data.search : undefined;
  const role = queryParams.success ? queryParams.data.role : undefined;

  let employees = await db.select().from(employeesTable).where(eq(employeesTable.adminId, adminId));

  if (search) {
    employees = employees.filter(e =>
      e.name.toLowerCase().includes(search.toLowerCase()) ||
      e.phone.includes(search)
    );
  }
  if (role) {
    employees = employees.filter(e => e.role === role);
  }

  res.json(employees.map(e => ({
    ...e,
    salary: Number(e.salary),
    createdAt: e.createdAt.toISOString(),
  })));
});

router.post("/employees", requireAuth, async (req, res): Promise<void> => {
  const { adminId } = (req as any).user;
  const parsed = CreateEmployeeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [employee] = await db.insert(employeesTable).values({
    ...parsed.data,
    adminId,
    salary: String(parsed.data.salary),
  }).returning();

  res.status(201).json({
    ...employee,
    salary: Number(employee.salary),
    createdAt: employee.createdAt.toISOString(),
  });
});

router.get("/employees/:id", requireAuth, async (req, res): Promise<void> => {
  const { adminId } = (req as any).user;
  const params = GetEmployeeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [employee] = await db.select().from(employeesTable)
    .where(and(eq(employeesTable.id, params.data.id), eq(employeesTable.adminId, adminId)));
  if (!employee) {
    res.status(404).json({ error: "Employee not found" });
    return;
  }

  res.json({
    ...employee,
    salary: Number(employee.salary),
    createdAt: employee.createdAt.toISOString(),
  });
});

router.patch("/employees/:id", requireAuth, async (req, res): Promise<void> => {
  const { adminId } = (req as any).user;
  const params = UpdateEmployeeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateEmployeeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: any = { ...parsed.data };
  if (updateData.salary !== undefined) {
    updateData.salary = String(updateData.salary);
  }

  const [employee] = await db.update(employeesTable)
    .set(updateData)
    .where(and(eq(employeesTable.id, params.data.id), eq(employeesTable.adminId, adminId)))
    .returning();

  if (!employee) {
    res.status(404).json({ error: "Employee not found" });
    return;
  }

  res.json({
    ...employee,
    salary: Number(employee.salary),
    createdAt: employee.createdAt.toISOString(),
  });
});

router.delete("/employees/:id", requireAuth, async (req, res): Promise<void> => {
  const { adminId } = (req as any).user;
  const params = DeleteEmployeeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [employee] = await db.delete(employeesTable)
    .where(and(eq(employeesTable.id, params.data.id), eq(employeesTable.adminId, adminId)))
    .returning();

  if (!employee) {
    res.status(404).json({ error: "Employee not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;

import { pgTable, text, serial, timestamp, integer, numeric, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const employeesTable = pgTable("employees", {
  id: serial("id").primaryKey(),
  adminId: integer("admin_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  email: text("email"),
  role: text("role").notNull(),
  department: text("department"),
  salary: numeric("salary", { precision: 12, scale: 2 }).notNull(),
  salaryType: text("salary_type").notNull().default("monthly"),
  joiningDate: text("joining_date").notNull(),
  status: text("status").notNull().default("active"),
  faceDescriptor: jsonb("face_descriptor").$type<number[]>(),
  facePhotoUrl: text("face_photo_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertEmployeeSchema = createInsertSchema(employeesTable).omit({ id: true, createdAt: true });
export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;
export type Employee = typeof employeesTable.$inferSelect;

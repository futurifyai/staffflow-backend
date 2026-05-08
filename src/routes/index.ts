import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import employeesRouter from "./employees";
import attendanceRouter from "./attendance";
import paymentsRouter from "./payments";
import tasksRouter from "./tasks";
import dashboardRouter from "./dashboard";
import reportsRouter from "./reports";
import leavesRouter from "./leaves";
import faceRouter from "./face";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(employeesRouter);
router.use(attendanceRouter);
router.use(paymentsRouter);
router.use(tasksRouter);
router.use(dashboardRouter);
router.use(reportsRouter);
router.use(leavesRouter);
router.use(faceRouter);

export default router;

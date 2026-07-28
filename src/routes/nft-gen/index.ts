import { Router } from "express";
import collectionsRouter from "./collections";
import layersRouter     from "./layers";
import traitsRouter     from "./traits";
import jobsRouter       from "./jobs";
import uploadRouter     from "./upload";
import exportRouter     from "./export";

const router = Router();

router.use("/collections",    collectionsRouter);
router.use("/layers",         layersRouter);
router.use("/traits",         traitsRouter);
router.use("/jobs",           jobsRouter);
router.use("/upload-batches", uploadRouter);
router.use("/export",         exportRouter);

export default router;

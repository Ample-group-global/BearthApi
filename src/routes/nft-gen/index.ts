import { Router } from "express";
import collectionsRouter from "./collections";
import layersRouter     from "./layers";
import traitsRouter     from "./traits";
import jobsRouter       from "./jobs";
import uploadRouter     from "./upload";

const router = Router();

router.use("/collections",    collectionsRouter);
router.use("/layers",         layersRouter);
router.use("/traits",         traitsRouter);
router.use("/jobs",           jobsRouter);
router.use("/upload-batches", uploadRouter);

export default router;

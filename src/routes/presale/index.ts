import { Router } from "express";
import customersRouter      from "./customers";
import referrersRouter      from "./referrers";
import productsRouter       from "./products";
import nftRouter            from "./nft";
import ordersRouter         from "./orders";
import reconciliationRouter from "./reconciliation";
import usersRouter          from "./users";
import masterRouter         from "./master";
import reportsRouter        from "./reports";

const router = Router();

router.use("/customers",      customersRouter);
router.use("/referrers",      referrersRouter);
router.use("/products",       productsRouter);
router.use("/nft",            nftRouter);
router.use("/orders",         ordersRouter);
router.use("/reconciliation", reconciliationRouter);
router.use("/users",          usersRouter);
router.use("/master",         masterRouter);
router.use("/reports",        reportsRouter);

export default router;

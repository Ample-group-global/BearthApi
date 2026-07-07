import { Router } from "express";
import customersRouter      from "./customers";
import referrersRouter      from "./referrers";
import productsRouter       from "./products";
import nftRouter            from "./nft";
import wavesRouter          from "./waves";
import ordersRouter         from "./orders";
import reconciliationRouter from "./reconciliation";
import usersRouter          from "./users";
import masterRouter         from "./master";
import reportsRouter        from "./reports";
import inventoryRouter      from "./inventory";
import fulfillmentRouter    from "./fulfillment";
import catalogRouter         from "./catalog";
import paymentMethodsRouter  from "./payment-methods";
import { requireRole }       from "../../presaleAuth";

const router = Router();

router.use("/customers",      customersRouter);
router.use("/referrers",      referrersRouter);
router.use("/products",       productsRouter);
router.use("/nft",            nftRouter);
router.use("/waves",          wavesRouter);
router.use("/orders",         ordersRouter);
router.use("/reconciliation", reconciliationRouter);
router.use("/users",          usersRouter);
router.use("/master",         masterRouter);
router.use("/reports",        reportsRouter);
router.use("/inventory",      inventoryRouter);
router.use("/fulfillment",    fulfillmentRouter);
router.use("/catalog",         catalogRouter);
router.use("/payment-methods", paymentMethodsRouter);

// ── Current session info ────────────────────────────────────────────────────
router.get("/me", (req, res, next) => {
  try {
    const { role, userId } = requireRole(req);
    res.json({ role, userId });
  } catch (e) { next(e); }
});

export default router;

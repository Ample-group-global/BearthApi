import { Request, Response, NextFunction } from "express";
import { HttpError } from "./errors";

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) return;
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  const e = err as { code?: string; message?: string };
  if (e.code === "P0001") { res.status(400).json({ error: e.message }); return; }
  if (e.code === "P0002") { res.status(404).json({ error: e.message }); return; }
  if (e.code === "23505") { res.status(409).json({ error: "Duplicate entry — " + e.message }); return; }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
}

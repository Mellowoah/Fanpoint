/** Short content hash for the call log: lets two baseline runs tell whether Qloo returned the same data, without storing it. */
import { createHash } from "node:crypto";
export const responseHash = (body: string): string => createHash("sha256").update(body).digest("hex").slice(0, 16);
